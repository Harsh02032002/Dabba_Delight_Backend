const { DeliveryPartner, WalletTransaction, Notification } = require('../models/Others');
const Order = require('../models/Order');
const User = require('../models/User');
const Seller = require('../models/Seller');
const { handleDeliveryResponse, assignOrderToRider } = require('../services/delivery-assignment.service');
const { computeDeliveryPricing, getDeliverySlabsFromDB } = require('../utils/deliveryPricing');
const { SERVICE_RADIUS_KM, haversineKm, isValidCoords, getEffectiveSellerCoords } = require('../utils/sellerGeo');
const {
  RIDER_ELIGIBLE_STATUSES,
  TERMINAL_STATUSES,
  MAX_ACTIVE_ORDERS_PER_RIDER,
  validateRiderTransition,
  validateDeliveryCompletion,
  getRiderPayout,
} = require('../services/order-lifecycle.service');
const pushNotification = require('../utils/pushNotification.service');

/** DeliveryPartner profile of the authenticated rider */
const getPartnerForUser = (user) => DeliveryPartner.findOne({ userId: user._id });

/** Push a status change to everyone watching the order */
const emitOrderUpdate = (io, order, extra = {}) => {
  if (!io || !order) return;
  const payload = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    deliveryStatus: order.deliveryStatus || null,
    timestamp: new Date(),
    ...extra,
  };
  const userId = order.userId?._id || order.userId;
  const sellerId = order.sellerId?._id || order.sellerId;
  io.to(`order_${order._id}`).emit('order_status_update', payload);
  io.to(`order_${order._id}`).emit('delivery_status_update', payload);
  io.to(`user_${userId}`).emit('order_status_update', payload);
  io.to(`user_${userId}`).emit('delivery_status_update', payload);
  io.to(`seller_${sellerId}`).emit('order_status_update', payload);
  if (order.status === 'delivered') {
    io.to(`order_${order._id}`).emit('order_delivered', payload);
    io.to(`user_${userId}`).emit('order_delivered', payload);
  }
};

/**
 * Mark an order delivered exactly once and credit the rider exactly once.
 * Safe against retries, double taps and concurrent requests.
 * @returns {{ ok: boolean, code?: number, message: string, order?: object, alreadyDelivered?: boolean }}
 */
async function completeDelivery({ orderId, partner, io, updatedBy }) {
  const order = await Order.findById(orderId);
  if (!order) return { ok: false, code: 404, message: 'Order not found' };
  if (!order.deliveryPartnerId || String(order.deliveryPartnerId) !== String(partner._id)) {
    return { ok: false, code: 403, message: 'This order is not assigned to you' };
  }
  const check = validateDeliveryCompletion(order);
  if (!check.ok) {
    if (check.idempotent) return { ok: true, alreadyDelivered: true, message: check.message, order };
    return { ok: false, code: 409, message: check.message };
  }

  const now = new Date();
  const set = { status: 'delivered', deliveryStatus: 'delivered', actualDelivery: now };
  if (order.paymentMethod === 'cod') set.paymentStatus = 'paid';
  const delivered = await Order.findOneAndUpdate(
    { _id: order._id, deliveryPartnerId: partner._id, status: { $nin: TERMINAL_STATUSES } },
    { $set: set, $push: { statusHistory: { status: 'delivered', timestamp: now, updatedBy: updatedBy || partner._id } } },
    { new: true },
  );
  if (!delivered) {
    const latest = await Order.findById(order._id);
    if (latest?.status === 'delivered') return { ok: true, alreadyDelivered: true, message: 'Order is already delivered', order: latest };
    return { ok: false, code: 409, message: `Order is ${latest?.status || 'unavailable'}` };
  }

  await creditRiderDeliveryFee(partner, delivered);

  emitOrderUpdate(io, delivered, { message: 'Your order has been delivered successfully!' });
  try {
    const customer = await User.findById(delivered.userId).select('pushToken fcmToken');
    await pushNotification.notifyOrderDelivered({ order: delivered, customer, rider: partner, io });
  } catch (e) {
    console.warn('notifyOrderDelivered error:', e.message);
  }
  return { ok: true, message: 'Order delivered', order: delivered };
}

/** [lng, lat] the 12 km rider rule is measured from: customer drop, else seller */
const getOrderReferencePoint = (order) => {
  const raw = order?.deliveryAddress?.location?.coordinates;
  if (Array.isArray(raw)) {
    const p = [Number(raw[0]), Number(raw[1])];
    if (isValidCoords(p)) return p;
  }
  const seller = order?.sellerId && typeof order.sellerId === 'object' ? order.sellerId : null;
  return seller ? getEffectiveSellerCoords(seller.toObject ? seller.toObject() : seller).coords : null;
};

const getPartnerPoint = (partner) => {
  const c = partner?.currentLocation?.coordinates;
  if (!Array.isArray(c)) return null;
  const p = [Number(c[0]), Number(c[1])];
  return isValidCoords(p) ? p : null;
};

/**
 * Credit the rider payout for a delivered order — at most once per order.
 * The order-level `riderPayoutCreditedAt` flag is claimed atomically before any money moves.
 */
async function creditRiderDeliveryFee(partner, order) {
  try {
    const claim = await Order.findOneAndUpdate(
      { _id: order._id, riderPayoutCreditedAt: null },
      { $set: { riderPayoutCreditedAt: new Date() } },
      { new: true },
    );
    if (!claim) {
      console.log(`ℹ️ Rider payout for order ${order.orderNumber} already credited`);
      return null;
    }

    const riderFee = getRiderPayout(order);
    const updated = await DeliveryPartner.findByIdAndUpdate(
      partner._id,
      {
        $inc: {
          totalDeliveries: 1,
          todayDeliveries: 1,
          earnings: riderFee,
          todayEarnings: riderFee,
          weekEarnings: riderFee,
          wallet: riderFee,
        },
      },
      { new: true },
    );
    if (!updated) return null;

    // Free the rider for the next order (only if this order still holds the slot)
    await DeliveryPartner.updateOne(
      { _id: updated._id, $or: [{ activeOrderId: order._id }, { activeOrderId: null }] },
      { $set: { activeOrderId: null, isAvailable: !!updated.isOnline } },
    );

    await WalletTransaction.create({
      deliveryPartnerId: updated._id,
      userId: updated.userId,
      type: 'credit',
      amount: riderFee,
      description: `Delivery payout for Order #${order.orderNumber || order._id}`,
      referenceId: order._id.toString(),
      referenceType: 'delivery_payout',
      balance: updated.wallet,
    }).catch(e => console.error('WalletTransaction create error:', e.message));

    console.log(`💰 Credited ₹${riderFee} to rider ${updated.name}. Total Earnings: ₹${updated.earnings}`);
    return updated;
  } catch (err) {
    console.error('Error crediting rider delivery fee:', err);
    return null;
  }
}

const { generateCode } = require('../utils/email.service');
const { buildIdentifierQuery, sendDualOTP } = require('../utils/sms.service');

async function resolvePartnerAccount(rawInput) {
  const idQuery = buildIdentifierQuery(rawInput);

  // 1. Try finding DeliveryPartner directly by phone or email
  let partner = await DeliveryPartner.findOne(idQuery);
  let user = null;
  if (partner && partner.userId) {
    user = await User.findById(partner.userId).select('+password');
  }

  // 2. Try finding a User with role: 'delivery' matching this identifier
  if (!user) {
    user = await User.findOne({ ...idQuery, role: 'delivery' }).select('+password');
    if (user && !partner) {
      partner = await DeliveryPartner.findOne({ userId: user._id });
    }
  }

  // 3. Search all matching users to find any that has a DeliveryPartner profile or role: 'delivery'
  if (!user) {
    const matchingUsers = await User.find(idQuery).select('+password');
    for (const cand of matchingUsers) {
      if (cand.role === 'delivery') {
        user = cand;
        partner = await DeliveryPartner.findOne({ userId: cand._id });
        break;
      }
      const existingPartner = await DeliveryPartner.findOne({ userId: cand._id });
      if (existingPartner) {
        user = cand;
        partner = existingPartner;
        if (user.role !== 'delivery' && user.role !== 'admin') {
          user.role = 'delivery';
          await user.save();
        }
        break;
      }
    }
  }

  // 4. Fallback: single user match
  if (!user) {
    user = await User.findOne(idQuery).select('+password');
    if (user) {
      partner = await DeliveryPartner.findOne({ userId: user._id });
      if (partner) {
        if (user.role !== 'delivery' && user.role !== 'admin') {
          user.role = 'delivery';
          await user.save();
        }
      } else if (user.role !== 'delivery' && user.role !== 'admin') {
        return { error: { code: 403, message: 'This phone number belongs to a customer/seller account. Please register as a Rider Partner or use your registered Rider phone number.' } };
      }
    }
  }

  if (!user) {
    return { error: { code: 404, message: 'No Rider account found with this Email or Phone Number. Please check the number or register.' } };
  }

  if (user.isBlocked) {
    return { error: { code: 403, message: 'Account is blocked' } };
  }

  if (!partner) {
    partner = await DeliveryPartner.create({
      userId: user._id,
      name: user.name || 'Partner',
      phone: user.phone || user.email,
      email: user.email,
      currentLocation: { type: 'Point', coordinates: [0, 0] },
    });
  }

  if (!user.phone && partner.phone) {
    user.phone = partner.phone;
  }

  return { user, partner };
}

exports.sendPartnerLoginOtp = async (req, res) => {
  try {
    const { email, phone, identifier, password } = req.body;
    const rawId = (identifier || email || phone || '').trim();
    if (!rawId) {
      return res.status(400).json({ success: false, message: 'Please enter your Email or Phone Number' });
    }

    const { user, partner, error } = await resolvePartnerAccount(rawId);
    if (error) return res.status(error.code).json({ success: false, message: error.message });

    if (password !== undefined && password !== '') {
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({ success: false, message: 'Invalid password' });
      }
    }

    const otp = generateCode();
    user.loginOtp = otp;
    user.loginOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const { maskedEmail, maskedPhone } = await sendDualOTP({
      user: {
        name: user.name || partner.name,
        email: user.email || partner.email,
        phone: user.phone || partner.phone,
      },
      otp,
      purpose: 'Rider Login Verification',
    });

    console.log(`🛵 [Rider Login OTP] Partner: ${user.email} (${user.phone || partner.phone}) | OTP: ${otp}`);

    res.json({
      success: true,
      otpRequired: true,
      identifier: rawId,
      email: user.email,
      phone: user.phone || partner.phone,
      maskedEmail,
      maskedPhone,
      message: `OTP sent to ${[maskedEmail, maskedPhone].filter(Boolean).join(' and ')}`,
    });
  } catch (err) {
    console.error('Partner send OTP error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.verifyPartnerLoginOtp = async (req, res) => {
  try {
    const { email, phone, identifier, otp, code } = req.body;
    const rawId = (identifier || email || phone || '').trim();
    const submittedOtp = String(otp || code || '').trim();

    if (!rawId || !submittedOtp) {
      return res.status(400).json({ success: false, message: 'Email/Phone and 6-digit OTP are required' });
    }

    const { user, partner, error } = await resolvePartnerAccount(rawId);
    if (error) return res.status(error.code).json({ success: false, message: error.message });

    const now = new Date();
    const validLoginOtp =
      user.loginOtp &&
      user.loginOtp === submittedOtp &&
      user.loginOtpExpires &&
      user.loginOtpExpires >= now;

    if (!validLoginOtp) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Please try again.' });
    }

    user.isVerified = true;
    user.loginOtp = undefined;
    user.loginOtpExpires = undefined;
    await user.save();

    const token = user.generateJWT();
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
      partner,
    });
  } catch (err) {
    console.error('Partner verify OTP error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.loginPartner = async (req, res) => {
  try {
    const { email, phone, identifier, password, otp, requireOtp } = req.body;
    const rawId = (identifier || email || phone || '').trim();

    if (otp) {
      return exports.verifyPartnerLoginOtp(req, res);
    }

    if (requireOtp || (!password && rawId)) {
      return exports.sendPartnerLoginOtp(req, res);
    }

    if (!rawId || !password) {
      return res.status(400).json({ success: false, message: 'Email/Phone and password required' });
    }

    const { user, partner, error } = await resolvePartnerAccount(rawId);
    if (error) return res.status(error.code).json({ success: false, message: error.message });

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = user.generateJWT();
    res.json({ 
      success: true, 
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      partner 
    });
  } catch (err) { 
    console.error('Partner login error:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

exports.getPartnerProfile = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    res.json({ success: true, partner });
  } catch (err) { 
    res.status(500).json({ success: false, message: err.message }); 
  }
};

exports.getOrderHistory = async (req, res) => {
  try {
    let partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) partner = await DeliveryPartner.findById(req.user._id);
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });

    const orders = await Order.find({ deliveryPartnerId: partner._id })
      .populate('userId', 'name phone')
      .populate('sellerId', 'businessName address phone')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const formatted = (orders || []).map(o => ({
      ...o,
      customerName: o.userId?.name || o.customerName || 'Customer',
      customerPhone: o.userId?.phone || o.customerPhone || '',
      restaurantName: o.sellerId?.businessName || o.restaurantName || 'Restaurant',
      pickupAddress: o.sellerId?.address?.fullAddress || o.pickupAddress || 'Restaurant Address',
    }));

    res.json({ success: true, orders: formatted });
  } catch (err) { 
    res.status(500).json({ success: false, message: err.message }); 
  }
};

exports.registerPartner = async (req, res) => {
  try {
    const { name, phone, email, password, vehicleType, vehicleNumber, licenseNumber } = req.body;
    
    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ success: false, message: 'Email already registered' });
    
    // Check if phone already registered
    const existingPartner = await DeliveryPartner.findOne({ phone });
    if (existingPartner) return res.status(400).json({ success: false, message: 'Phone already registered' });
    
    // Create user account with delivery role
    user = await User.create({
      name,
      email,
      phone,
      password,
      role: 'delivery',
      isVerified: true
    });
    
    // Create delivery partner profile
    const partner = await DeliveryPartner.create({ 
      userId: user._id, 
      name, 
      phone, 
      email, 
      vehicleType, 
      vehicleNumber, 
      licenseNumber,
      currentLocation: {
        type: 'Point',
        coordinates: [0, 0] // Default empty coordinates - will be updated when partner sets location
      }
    });
    
    // Generate token
    const token = user.generateJWT ? user.generateJWT() : 'dummy-token';
    
    res.status(201).json({ 
      success: true, 
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      partner 
    });
  } catch (err) { 
    console.error('Partner registration error:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

exports.goOnline = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    console.log(`🟢 Go online request from ${req.user.email}:`);
    console.log(`  - Provided coordinates: { lat: ${lat}, lng: ${lng} }`);
    
    // Find current partner first
    const currentPartner = await DeliveryPartner.findOne({ userId: req.user._id });
    
    if (!currentPartner) {
      console.log(`❌ No delivery partner found for user ID: ${req.user._id}`);
      return res.status(404).json({ success: false, message: 'Delivery partner not found' });
    }

    // Check KYC status & Admin Approval
    if (currentPartner.kycStatus !== 'verified' || !currentPartner.isApproved) {
      return res.status(403).json({
        success: false,
        message: currentPartner.kycStatus === 'submitted'
          ? 'Aapke documents verification review me hain. Admin approval ke baad aap online ja sakte hain.'
          : 'Online jaane ke liye pehle KYC verification complete karein (PAN & Aadhaar required).',
        kycStatus: currentPartner.kycStatus,
        isApproved: currentPartner.isApproved || false,
      });
    }

    console.log(`  - Current partner ID: ${currentPartner._id}`);
    console.log(`  - Current location in DB:`, currentPartner.currentLocation?.coordinates);
    console.log(`  - Current isOnline: ${currentPartner.isOnline}`);
    console.log(`  - Current isAvailable: ${currentPartner.isAvailable}`);
    
    // Smart location handling
    let updateData = { 
      isOnline: true, 
      isAvailable: true 
    };
    
    // Case 1: Coordinates provided in request
    if (lat != null && lng != null && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
      updateData.currentLocation = { 
        type: 'Point', 
        coordinates: [Number(lng), Number(lat)] 
      };
      console.log(`  - Using provided coordinates: [${lng}, ${lat}]`);
    }
    // Case 2: Existing location is valid
    else if (currentPartner.currentLocation?.coordinates && 
             Array.isArray(currentPartner.currentLocation.coordinates) &&
             currentPartner.currentLocation.coordinates[0] !== 0) {
      console.log(`  - Using existing valid location:`, currentPartner.currentLocation.coordinates);
    }
    // Case 3: No location yet - do NOT invent one (a fake default city would make the
    // rider eligible for orders in that city). Rider gets orders once GPS is shared.
    else {
      console.log(`  - No GPS location yet - rider will receive orders after first location update`);
    }
    
    console.log(`  - Final update data:`, updateData);
    
    const partner = await DeliveryPartner.findOneAndUpdate(
      { userId: req.user._id },
      updateData,
      { new: true }
    );
    
    console.log(`✅ Go online result:`, {
      partnerName: partner.name,
      isOnline: partner.isOnline,
      isAvailable: partner.isAvailable,
      finalLocation: partner.currentLocation?.coordinates
    });
    
    res.json({ success: true, partner });
  } catch (err) { 
    console.error('❌ Go online error:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

exports.goOffline = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findOneAndUpdate({ userId: req.user._id }, { isOnline: false, isAvailable: false }, { new: true });
    res.json({ success: true, partner });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateLocation = async (req, res) => {
  try {
    let lat = req.body.lat;
    let lng = req.body.lng;
    if ((lat == null || lng == null) && req.body.location?.coordinates) {
      lng = req.body.location.coordinates[0];
      lat = req.body.location.coordinates[1];
    }
    if (lat == null || lng == null || isNaN(Number(lat)) || isNaN(Number(lng))) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude required' });
    }
    lat = Number(lat);
    lng = Number(lng);
    
    console.log(`📍 Location update from ${req.user.email}:`);
    console.log(`  - Formatted for DB: [${lng}, ${lat}]`);
    console.log(`  - User ID: ${req.user._id}`);
    
    const result = await DeliveryPartner.findOneAndUpdate(
      { userId: req.user._id }, 
      { 
        currentLocation: { 
          type: 'Point', 
          coordinates: [lng, lat] 
        } 
      },
      { new: true }
    );
    
    if (!result) {
      console.log(`❌ No delivery partner found for user ID: ${req.user._id}`);
      return res.status(404).json({ success: false, message: 'Delivery partner not found' });
    }
    
    res.json({ success: true, location: result.currentLocation });
  } catch (err) { 
    console.error('❌ Location update error:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

exports.findNearbyPartners = async (req, res) => {
  try {
    const { lat, lng, radius = 5000 } = req.query;
    const maxRadius = Math.min(Number(radius) || 5000, SERVICE_RADIUS_KM * 1000);
    const partners = await DeliveryPartner.find({
      isOnline: true, isAvailable: true, activeOrderId: null,
      currentLocation: { $near: { $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }, $maxDistance: maxRadius } },
    }).limit(10);
    res.json({ success: true, partners });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/delivery/assign/:orderId — admin manual assignment to the nearest free rider
exports.assignOrder = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required' });
    const order = await Order.findById(req.params.orderId).populate('sellerId');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const refPoint = getOrderReferencePoint(order);
    if (!refPoint) return res.status(400).json({ message: 'Order has no delivery/pickup location' });
    // Nearest free rider within SERVICE_RADIUS_KM (12 km) of the customer
    const partner = await DeliveryPartner.findOne({
      isOnline: true, isAvailable: true, activeOrderId: null,
      currentLocation: { $near: { $geometry: { type: 'Point', coordinates: refPoint }, $maxDistance: SERVICE_RADIUS_KM * 1000 } },
    });
    if (!partner) return res.status(404).json({ message: `No delivery partner available within ${SERVICE_RADIUS_KM} km` });
    const result = await assignOrderToRider(order._id, partner, req.app.get('io'));
    if (!result.success) return res.status(result.code || 400).json({ success: false, message: result.message });
    res.json({ success: true, partner: result.partner || partner, order: result.order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// PATCH /api/delivery/orders/:orderId/pickup — same rules as the rider status update
exports.pickupOrder = async (req, res) => {
  req.body = { ...(req.body || {}), status: 'picked_up' };
  return exports.updateDeliveryStatus(req, res);
};

// PATCH /api/delivery/orders/:orderId/deliver — assigned rider only, after pickup
exports.deliverOrder = async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user);
    if (!partner) return res.status(404).json({ success: false, message: 'Delivery partner profile not found' });
    const result = await completeDelivery({ orderId: req.params.orderId, partner, io: req.app.get('io'), updatedBy: req.user._id });
    if (!result.ok) return res.status(result.code || 400).json({ success: false, message: result.message });
    res.json({ success: true, message: result.message, order: result.order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Update delivery partner location
exports.updateDeliveryLocation = async (req, res) => {
  try {
    let lat = req.body.lat;
    let lng = req.body.lng;
    if ((lat == null || lng == null) && req.body.location?.coordinates) {
      lng = req.body.location.coordinates[0];
      lat = req.body.location.coordinates[1];
    }
    if (lat == null || lng == null || isNaN(Number(lat)) || isNaN(Number(lng))) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude required' });
    }
    lat = Number(lat);
    lng = Number(lng);

    const partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    
    partner.currentLocation = { type: 'Point', coordinates: [lng, lat] };
    await partner.save();
    
    // Emit location update to user and order room
    const io = req.app.get('io');
    const activeOrderId = req.body.orderId || partner.activeOrderId;
    if (io && activeOrderId) {
      // Only broadcast for an order this rider is actually delivering
      const activeOrder = await Order.findOne({ _id: activeOrderId, deliveryPartnerId: partner._id }).select('userId status').lean();
      if (activeOrder && !TERMINAL_STATUSES.includes(activeOrder.status)) {
        const payload = {
          orderId: activeOrderId,
          partnerId: partner._id,
          lat,
          lng,
          address: req.body.address,
          timestamp: new Date()
        };
        io.to(`order_${activeOrderId}`).emit('delivery_location_update', payload);
        io.to(`user_${activeOrder.userId}`).emit('delivery_location_update', payload);
      }
    }
    
    res.json({ success: true, location: partner.currentLocation });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getEarnings = async (req, res) => {
  try {
    let partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) {
      partner = await DeliveryPartner.findById(req.user._id);
    }
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });

    // Fetch delivered orders for this partner to compute accurate today/week/month stats
    const deliveredOrders = await Order.find({
      deliveryPartnerId: partner._id,
      status: 'delivered',
    }).sort({ actualDelivery: -1, createdAt: -1 }).limit(100).lean();

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday start
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let calcToday = 0;
    let calcWeek = 0;
    let calcMonth = 0;
    let calcTotal = 0;
    let todayDeliveries = 0;
    const weekArr = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun

    deliveredOrders.forEach((o) => {
      const fee = getRiderPayout(o);
      calcTotal += fee;
      const d = new Date(o.actualDelivery || o.createdAt);
      if (d >= startOfToday) {
        calcToday += fee;
        todayDeliveries += 1;
      }
      if (d >= startOfWeek) {
        calcWeek += fee;
        const dayIdx = (d.getDay() + 6) % 7; // Mon = 0
        weekArr[dayIdx] += fee;
      }
      if (d >= startOfMonth) {
        calcMonth += fee;
      }
    });

    const today = calcToday > 0 ? calcToday : (partner.todayEarnings || 0);
    const week = calcWeek > 0 ? calcWeek : (partner.weekEarnings || 0);
    const total = calcTotal > 0 ? calcTotal : (partner.earnings || 0);
    const month = calcMonth > 0 ? calcMonth : total;

    res.json({
      success: true,
      earnings: total,
      todayEarnings: today,
      weekEarnings: week,
      totalDeliveries: deliveredOrders.length || partner.totalDeliveries || 0,
      todayDeliveries: todayDeliveries || partner.todayDeliveries || 0,
      wallet: partner.wallet || total,
      summary: {
        today,
        week,
        month,
        total,
        deliveries: deliveredOrders.length || partner.totalDeliveries || 0,
        ordersToday: todayDeliveries || partner.todayDeliveries || 0,
        ordersTotal: deliveredOrders.length || partner.totalDeliveries || 0,
        walletBalance: partner.wallet != null ? partner.wallet : total,
      },
      weeklyData: weekArr,
    });
  } catch (err) {
    console.error('getEarnings error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getActiveOrder = async (req, res) => {
  try {
    let partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) partner = await DeliveryPartner.findById(req.user._id);
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });

    let order = null;
    if (partner.activeOrderId) {
      order = await Order.findById(partner.activeOrderId)
        .populate('userId', 'name phone')
        .populate('sellerId', 'businessName address phone')
        .lean();
    }
    if (order && String(order.deliveryPartnerId) !== String(partner._id)) {
      order = null;
    }
    if (!order) {
      order = await Order.findOne({
        deliveryPartnerId: partner._id,
        status: { $nin: TERMINAL_STATUSES }
      })
      .populate('userId', 'name phone')
      .populate('sellerId', 'businessName address phone')
      .sort({ createdAt: -1 })
      .lean();
    }

    if (order) {
      // Check if order is already completed / delivered / cancelled
      if (['delivered', 'cancelled'].includes(order.status)) {
        if (partner.activeOrderId && partner.activeOrderId.toString() === order._id.toString()) {
          await DeliveryPartner.findByIdAndUpdate(partner._id, { activeOrderId: null });
        }
        order = null;
      }
    }

    if (order) {
      order.customerName = order.userId?.name || order.customerName || 'Customer';
      order.customerPhone = order.userId?.phone || order.customerPhone || '';
      order.restaurantName = order.sellerId?.businessName || order.restaurantName || 'Restaurant';
      order.payout = getRiderPayout(order);

      // Ensure proper full pickupAddress
      const sAddr = order.sellerId?.address;
      const formattedSellerAddr = sAddr?.fullAddress || [sAddr?.street, sAddr?.city, sAddr?.state, sAddr?.pincode].filter(Boolean).join(', ');
      order.pickupAddress = formattedSellerAddr || order.pickupAddress || 'Restaurant Address';

      // Ensure proper deliveryAddress string / fullAddress
      if (order.deliveryAddress && typeof order.deliveryAddress === 'object') {
        const dAddr = order.deliveryAddress;
        if (!dAddr.fullAddress) {
          dAddr.fullAddress = [dAddr.street, dAddr.city, dAddr.state, dAddr.pincode].filter(Boolean).join(', ');
        }
      }

      // Ensure pickupLocation uses seller's real GPS coordinates
      const sellerPin = order.sellerId?.address?.location?.coordinates;
      const sAddrText = `${formattedSellerAddr} ${order.restaurantName || ''}`.toLowerCase();
      if (sAddrText.includes('sector 41') || sAddrText.includes('buterla') || sAddrText.includes('geeta')) {
        order.pickupLocation = { type: 'Point', coordinates: [76.7410, 30.7325] };
      } else if (Array.isArray(sellerPin) && sellerPin.length === 2 && !(sellerPin[0] === 0 && sellerPin[1] === 0)) {
        order.pickupLocation = {
          type: 'Point',
          coordinates: [Number(sellerPin[0]), Number(sellerPin[1])]
        };
      } else if (order.pickupLocation?.coordinates && Math.abs(order.pickupLocation.coordinates[0] - 77.209) < 0.01) {
        order.pickupLocation = {
          type: 'Point',
          coordinates: [76.7410, 30.7325]
        };
      }

      // Ensure dropLocation uses customer's real GPS coordinates with sector precision
      const deliveryText = `${order.deliveryAddress?.street || ''} ${order.deliveryAddress?.fullAddress || ''} ${order.deliveryAddress?.city || ''}`.toLowerCase();
      const custPin = order.deliveryAddress?.location?.coordinates;

      if (deliveryText.includes('sector 40') || deliveryText.includes('sec 40') || deliveryText.includes('40-d') || deliveryText.includes('40d')) {
        order.dropLocation = { type: 'Point', coordinates: [76.7375, 30.7385] };
      } else if (deliveryText.includes('sector 41') || deliveryText.includes('sec 41') || deliveryText.includes('buterla')) {
        order.dropLocation = { type: 'Point', coordinates: [76.7410, 30.7325] };
      } else if (deliveryText.includes('sector 37') || deliveryText.includes('sec 37')) {
        order.dropLocation = { type: 'Point', coordinates: [76.7550, 30.7420] };
      } else if (deliveryText.includes('sector 35') || deliveryText.includes('sec 35')) {
        order.dropLocation = { type: 'Point', coordinates: [76.7640, 30.7240] };
      } else if (deliveryText.includes('sector 22') || deliveryText.includes('sec 22')) {
        order.dropLocation = { type: 'Point', coordinates: [76.7720, 30.7320] };
      } else if (Array.isArray(custPin) && custPin.length === 2 && !(custPin[0] === 0 && custPin[1] === 0) && Math.abs(custPin[0] - 77.209) > 0.05) {
        order.dropLocation = {
          type: 'Point',
          coordinates: [Number(custPin[0]), Number(custPin[1])]
        };
      } else if (order.dropLocation?.coordinates && Math.abs(order.dropLocation.coordinates[0] - 77.209) > 0.05) {
        // keep non-delhi coordinates
      } else if (order.pickupLocation?.coordinates) {
        order.dropLocation = {
          type: 'Point',
          coordinates: [order.pickupLocation.coordinates[0] - 0.0035, order.pickupLocation.coordinates[1] + 0.006]
        };
      }

      // Sync deliveryAddress.location to match dropLocation
      if (order.deliveryAddress && typeof order.deliveryAddress === 'object') {
        order.deliveryAddress.location = order.dropLocation;
      }
    }

    res.json({ success: true, order: order || null });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/partner/available-orders or /api/delivery/available-orders
exports.getAvailableOrders = async (req, res) => {
  try {
    let partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) partner = await DeliveryPartner.findById(req.user.deliveryPartnerId || req.user._id);
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });

    // Restrict orders if KYC is not verified or account not approved
    if (partner.kycStatus !== 'verified' || !partner.isApproved) {
      return res.json({
        success: true,
        orders: [],
        kycStatus: partner.kycStatus || 'pending',
        isApproved: !!partner.isApproved,
        message: partner.kycStatus === 'submitted'
          ? 'Aapke KYC documents review me hain. Admin approval ke baad orders dikhenge.'
          : 'Orders dekhne aur accept karne ke liye KYC documents submit karke verify karwayen.',
      });
    }

    // Orders this rider is delivering + unassigned orders the kitchen has confirmed
    const orders = await Order.find({
      $or: [
        { deliveryPartnerId: partner._id, status: { $nin: TERMINAL_STATUSES } },
        { deliveryPartnerId: null, status: { $in: RIDER_ELIGIBLE_STATUSES } }
      ]
    })
    .populate('userId', 'name phone')
    .populate('sellerId', 'businessName address phone logo')
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

    // Same eligibility as acceptOrder: unassigned orders only within SERVICE_RADIUS_KM of the rider
    const riderPoint = getPartnerPoint(partner);
    const visibleOrders = orders.filter(ord => {
      if (String(ord.deliveryPartnerId) === String(partner._id)) return true;
      const refPoint = getOrderReferencePoint(ord);
      if (!refPoint) return true;
      if (!riderPoint) return false;
      return haversineKm(riderPoint, refPoint) <= SERVICE_RADIUS_KM;
    });

    const formattedOrders = visibleOrders.map(ord => {
      const sAddr = ord.sellerId?.address;
      const pickupAddress = sAddr?.fullAddress || [sAddr?.street, sAddr?.city, sAddr?.state, sAddr?.pincode].filter(Boolean).join(', ') || 'Pickup Location';
      const dAddr = ord.deliveryAddress;
      const deliveryAddressStr = typeof dAddr === 'string' ? dAddr : (dAddr?.fullAddress || [dAddr?.street || dAddr?.address, dAddr?.city, dAddr?.pincode].filter(Boolean).join(', ') || 'Delivery Address');

      // Distance estimation
      let distanceKm = ord.deliveryDistanceKm || 2;
      const sCoords = sAddr?.location?.coordinates;
      const cCoords = dAddr?.location?.coordinates || ord.dropLocation?.coordinates;
      if (sCoords && cCoords && isValidCoords(sCoords) && isValidCoords(cCoords)) {
        distanceKm = Number(haversineKm(sCoords, cCoords).toFixed(1));
      }

      const isAssignedToMe = String(ord.deliveryPartnerId) === String(partner._id);
      const base = {
        ...ord,
        restaurantName: ord.sellerId?.businessName || 'Restaurant',
        pickupAddress,
        distance: distanceKm,
        payout: getRiderPayout(ord),
        isAssignedToMe,
      };
      if (isAssignedToMe) {
        return {
          ...base,
          customerName: ord.userId?.name || 'Customer',
          customerPhone: ord.userId?.phone || '',
          deliveryAddressStr,
        };
      }
      // Not yet accepted: share only the delivery area, never customer identity/contact/address
      const { userId, deliveryAddress, dropLocation, specialInstructions, ...rest } = base;
      return {
        ...rest,
        customerName: 'Customer',
        customerPhone: '',
        deliveryAddressStr: [dAddr?.city, dAddr?.pincode].filter(Boolean).join(' - ') || 'Delivery area',
      };
    });

    res.json({ success: true, orders: formattedOrders, maxActiveOrders: MAX_ACTIVE_ORDERS_PER_RIDER });
  } catch (err) {
    console.error('getAvailableOrders error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Wallet ─────────────────────────────────────
exports.getWalletTransactions = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findOne({ userId: req.user._id });
    const transactions = await WalletTransaction.find({ deliveryPartnerId: partner._id }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, transactions, balance: partner.wallet || 0 });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.withdrawFromWallet = async (req, res) => {
  try {
    const { amount } = req.body;
    const partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (partner.wallet < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    const updatedPartner = await DeliveryPartner.findByIdAndUpdate(
      partner._id, 
      { $inc: { wallet: -amount } }, 
      { new: true }
    );
    await WalletTransaction.create({
      deliveryPartnerId: partner._id,
      type: 'debit',
      amount,
      description: 'Wallet withdrawal',
      referenceType: 'withdrawal',
      balance: updatedPartner.wallet,
    });
    res.json({ success: true, wallet: updatedPartner.wallet });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Delivery Order Management (Step 4-6) ──────

// POST /api/delivery/orders/:orderId/accept
exports.acceptOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId || req.body.orderId;
    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID is required' });

    const partner = await getPartnerForUser(req.user);
    if (!partner) return res.status(404).json({ success: false, message: 'Delivery partner profile not found' });

    if (partner.kycStatus !== 'verified' || !partner.isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Order accept karne ke liye verified rider account zaroori hai. Pehle KYC complete karein.',
      });
    }

    // ── 12 km rule: rider must be within SERVICE_RADIUS_KM of the customer ──
    const orderForCheck = await Order.findById(orderId).populate('sellerId', 'address businessName');
    if (!orderForCheck) return res.status(404).json({ success: false, message: 'Order not found' });
    if (orderForCheck.deliveryPartnerId && String(orderForCheck.deliveryPartnerId) !== String(partner._id)) {
      return res.status(409).json({ success: false, message: 'Order already taken by another delivery partner' });
    }
    if (!orderForCheck.deliveryPartnerId) {
      const refPoint = getOrderReferencePoint(orderForCheck);
      const riderPoint = getPartnerPoint(partner);
      if (refPoint) {
        if (!riderPoint) {
          return res.status(400).json({ success: false, message: 'Please enable GPS / share your live location to accept orders' });
        }
        const km = haversineKm(riderPoint, refPoint);
        if (km > SERVICE_RADIUS_KM) {
          return res.status(403).json({
            success: false,
            message: `This order is ${km.toFixed(1)} km away. You can accept orders only within ${SERVICE_RADIUS_KM} km.`,
            distanceKm: Number(km.toFixed(1)),
            maxKm: SERVICE_RADIUS_KM,
          });
        }
      }
    }

    const result = await assignOrderToRider(orderId, partner, req.app.get('io'));
    if (!result.success) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }

    res.json({
      success: true,
      alreadyAccepted: !!result.alreadyAccepted,
      message: result.alreadyAccepted ? result.message : 'Order accepted! Head to the restaurant for pickup.',
      order: result.order,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/delivery/orders/:orderId/reject
exports.rejectOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId || req.body.orderId;
    const partner = await getPartnerForUser(req.user);
    await handleDeliveryResponse(orderId, partner?._id, 'rejected', req.app.get('io'));
    res.json({ success: true, message: 'Order rejection recorded' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Wrong delivery OTP entries allowed per order before support has to step in */
const MAX_DELIVERY_OTP_ATTEMPTS = 5;

/**
 * The customer's OTP is the only proof of handover; there is no fallback code.
 * Returns null when the delivery may be completed, else { status, message }.
 */
const checkDeliveryOtp = async (order, otp) => {
  if (order.status === 'delivered') return null; // retries stay idempotent
  if (!order.deliveryOtp) {
    order.deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
    await order.save();
    return { status: 400, message: 'Ask the customer for the delivery OTP shown in their app' };
  }
  if ((order.deliveryOtpAttempts || 0) >= MAX_DELIVERY_OTP_ATTEMPTS) {
    return { status: 429, message: 'Too many wrong OTP attempts. Please contact support to complete this delivery.' };
  }
  if (!otp || String(otp).trim() !== String(order.deliveryOtp)) {
    await Order.updateOne({ _id: order._id }, { $inc: { deliveryOtpAttempts: 1 } });
    const left = MAX_DELIVERY_OTP_ATTEMPTS - (order.deliveryOtpAttempts || 0) - 1;
    return { status: 400, message: left > 0 ? `Invalid OTP. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Invalid OTP. No attempts left, please contact support.' };
  }
  return null;
};

// PATCH /api/delivery/orders/:orderId/status  |  PUT /api/order/status-update { orderId, status }
exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { status, location } = req.body || {};
    const orderId = req.params.orderId || req.body?.orderId;
    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID is required' });
    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

    const partner = await getPartnerForUser(req.user);
    if (!partner) return res.status(404).json({ success: false, message: 'Delivery partner profile not found' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (String(order.deliveryPartnerId) !== String(partner._id)) {
      return res.status(403).json({ success: false, message: 'This order is not assigned to you' });
    }

    const io = req.app.get('io');

    // Delivery completion goes through the same exactly-once path as OTP confirmation
    if (status === 'delivered') {
      const otpError = await checkDeliveryOtp(order, req.body?.otp);
      if (otpError) return res.status(otpError.status).json({ success: false, message: otpError.message });
      const result = await completeDelivery({ orderId, partner, io, updatedBy: req.user._id });
      if (!result.ok) return res.status(result.code || 400).json({ success: false, message: result.message });
      return res.json({ success: true, message: 'Delivery status updated successfully', order: result.order });
    }

    const check = validateRiderTransition(order, status);
    if (!check.ok) {
      if (check.idempotent) return res.json({ success: true, message: check.message, order });
      return res.status(409).json({ success: false, message: check.message });
    }
    const next = check.next;
    const now = new Date();

    const set = { deliveryStatus: next };
    const history = [{ status: next, timestamp: now, updatedBy: partner._id }];
    if (next === 'picked_up') {
      set.status = 'out_for_delivery';
      set.pickedUpAt = now;
      history.push({ status: 'out_for_delivery', timestamp: now, updatedBy: partner._id });
    }
    if (location && location.lat != null && location.lng != null) {
      set.deliveryLocation = { lat: Number(location.lat), lng: Number(location.lng) };
    }

    // Conditional update: only applies if nobody changed the order in the meantime
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, deliveryPartnerId: partner._id, status: order.status, deliveryStatus: order.deliveryStatus || null },
      { $set: set, $push: { statusHistory: { $each: history } } },
      { new: true },
    );
    if (!updated) {
      return res.status(409).json({ success: false, message: 'Order was updated by someone else. Please refresh.' });
    }

    if (set.deliveryLocation) {
      await DeliveryPartner.updateOne(
        { _id: partner._id },
        { currentLocation: { type: 'Point', coordinates: [set.deliveryLocation.lng, set.deliveryLocation.lat] } },
      );
    }

    if (next === 'arrived_at_restaurant') {
      const seller = await Seller.findById(updated.sellerId).select('userId').lean();
      if (seller?.userId) {
        await pushNotification.createAndSendNotification({
          userId: seller.userId,
          title: '🏃 Delivery Partner Arrived',
          message: `Delivery partner ${partner.name} has arrived for order #${updated.orderNumber}`,
          type: 'delivery_update',
          orderId: updated._id,
          io,
          dedupeKey: `${updated._id}:arrived:${seller.userId}`,
        });
      }
      emitOrderUpdate(io, updated, { message: 'Delivery partner arrived at restaurant' });
    }

    if (next === 'picked_up') {
      emitOrderUpdate(io, updated, { message: 'Order picked up, on the way to you', location });
      try {
        const customer = await User.findById(updated.userId).select('pushToken fcmToken');
        await pushNotification.notifyOutForDelivery({ order: updated, customer, riderName: partner.name, io });
      } catch (e) {
        console.warn('notifyOutForDelivery error:', e.message);
      }
    }

    res.json({ success: true, message: 'Delivery status updated successfully', order: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.confirmDeliveryOTP = async (req, res) => {
  try {
    const orderId = req.params.orderId || req.body.orderId;
    const { otp } = req.body;

    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID is required' });

    const partner = await getPartnerForUser(req.user);
    if (!partner) return res.status(404).json({ success: false, message: 'Delivery partner profile not found' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (String(order.deliveryPartnerId) !== String(partner._id)) {
      return res.status(403).json({ success: false, message: 'This order is not assigned to you' });
    }

    const otpError = await checkDeliveryOtp(order, otp);
    if (otpError) return res.status(otpError.status).json({ success: false, message: otpError.message });

    const result = await completeDelivery({ orderId, partner, io: req.app.get('io'), updatedBy: req.user._id });
    if (!result.ok) return res.status(result.code || 400).json({ success: false, message: result.message });

    res.json({
      success: true,
      alreadyDelivered: !!result.alreadyDelivered,
      message: result.alreadyDelivered ? result.message : 'Delivery OTP confirmed successfully',
      order: result.order,
      payout: getRiderPayout(result.order),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/delivery/partner/location/:partnerId
exports.getPartnerLocation = async (req, res) => {
  try {
    const { partnerId } = req.params;
    
    const partner = await DeliveryPartner.findById(partnerId)
      .select('currentLocation name rating totalDeliveries');
    
    if (!partner) {
      return res.status(404).json({ success: false, message: 'Delivery partner not found' });
    }

    res.json({ 
      success: true, 
      location: partner.currentLocation,
      partner: {
        name: partner.name,
        rating: partner.rating,
        totalDeliveries: partner.totalDeliveries
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/delivery/orders/active
exports.getActiveOrders = async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user);
    if (!partner) return res.status(404).json({ success: false, message: 'Delivery partner profile not found' });

    const orders = await Order.find({
      deliveryPartnerId: partner._id,
      status: { $nin: TERMINAL_STATUSES }
    })
    .populate('userId', 'name phone')
    .populate('sellerId', 'businessName address phone')
    .sort({ createdAt: -1 });

    res.json({ success: true, orders });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/delivery/calculate-fee?sellerId=...&customerLng=...&customerLat=...
// OR: ?sellerLng=...&sellerLat=...&customerLng=...&customerLat=...
exports.calculateDeliveryFee = async (req, res) => {
  try {
    const { sellerId, sellerLng, sellerLat, customerLng, customerLat } = req.query;

    let sellerCoords;

    if (sellerId) {
      const seller = await Seller.findById(sellerId).select('address');
      if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });
      sellerCoords = seller.address?.location?.coordinates; // [lng, lat]
    } else if (sellerLng != null && sellerLat != null) {
      sellerCoords = [Number(sellerLng), Number(sellerLat)];
    }

    if (!sellerCoords || sellerCoords.length < 2) {
      return res.status(400).json({ success: false, message: 'Seller coordinates required (sellerId or sellerLng/sellerLat)' });
    }

    if (customerLng == null || customerLat == null) {
      return res.status(400).json({ success: false, message: 'Customer coordinates required (customerLng, customerLat)' });
    }

    const customerCoords = [Number(customerLng), Number(customerLat)];

    // Fetch dynamic slabs from Admin Panel config
    const { slabs, maxKm, maxCap } = await getDeliverySlabsFromDB();
    const pricing = computeDeliveryPricing(sellerCoords, customerCoords, slabs, maxKm, maxCap);

    console.log(`📏 Fee Calc API | dist: ${pricing.distanceKm} km | fee: ₹${pricing.customerFee} | payout: ₹${pricing.riderPayout} | maxKm: ${maxKm} | maxCap: ₹${maxCap}`);

    return res.json({
      success: true,
      distanceKm: pricing.distanceKm,
      customerFee: pricing.customerFee,      // null if not serviceable
      riderPayout: pricing.riderPayout,
      serviceable: pricing.serviceable,
      maxKm,
      slabs,  // Return slabs so mobile app can display them
      message: pricing.serviceable
        ? `Delivery available at ₹${pricing.customerFee} for ${pricing.distanceKm} km`
        : `Not serviceable — ${pricing.distanceKm} km exceeds ${maxKm} km limit`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Rider KYC Verification ──────────────────────────────────────────

exports.getKycStatus = async (req, res) => {
  try {
    let partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) partner = await DeliveryPartner.findById(req.user.deliveryPartnerId || req.user._id);
    if (!partner) return res.status(404).json({ success: false, message: 'Delivery partner not found' });

    res.json({
      success: true,
      kycStatus: partner.kycStatus || 'pending',
      isApproved: !!partner.isApproved,
      kycDocuments: partner.kycDocuments || {},
      kycRejectReason: partner.kycRejectReason || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.uploadKycDocument = async (req, res) => {
  try {
    const type = req.body?.type || req.query?.type;
    const fileUrl = req.file?.s3Url || req.file?.location || req.file?.path || req.body?.url || req.body?.fileUrl || req.body?.image || null;
    if (!type || !fileUrl) {
      return res.status(400).json({ success: false, message: 'Document type and file are required' });
    }

    let partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) partner = await DeliveryPartner.findById(req.user.deliveryPartnerId || req.user._id);
    if (!partner) return res.status(404).json({ success: false, message: 'Delivery partner not found' });

    if (!partner.kycDocuments) partner.kycDocuments = {};
    if (!partner.kycDocuments[type]) partner.kycDocuments[type] = {};

    partner.kycDocuments[type].url = fileUrl;
    partner.kycDocuments[type].status = 'uploaded';
    partner.markModified('kycDocuments');
    await partner.save();

    res.json({
      success: true,
      url: fileUrl,
      type,
      kycDocuments: partner.kycDocuments,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.submitKycDocuments = async (req, res) => {
  try {
    const {
      aadhaarNumber,
      aadhaarUrl,
      panNumber,
      panUrl,
      drivingLicenseNumber,
      drivingLicenseUrl,
      vehicleRCNumber,
      vehicleRCUrl,
    } = req.body;

    let partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) partner = await DeliveryPartner.findById(req.user.deliveryPartnerId || req.user._id);
    if (!partner) return res.status(404).json({ success: false, message: 'Delivery partner not found' });

    // Validate mandatory fields (PAN and Aadhaar)
    const effectiveAadhaarNum = aadhaarNumber || partner.kycDocuments?.aadhaar?.number;
    const effectiveAadhaarUrl = aadhaarUrl || partner.kycDocuments?.aadhaar?.url;
    const effectivePanNum = panNumber || partner.kycDocuments?.pan?.number;
    const effectivePanUrl = panUrl || partner.kycDocuments?.pan?.url;

    if (!effectiveAadhaarNum || !effectiveAadhaarUrl) {
      return res.status(400).json({
        success: false,
        message: 'Aadhaar card number aur image dono zaroori hain',
      });
    }

    if (!effectivePanNum || !effectivePanUrl) {
      return res.status(400).json({
        success: false,
        message: 'PAN card number aur image dono zaroori hain',
      });
    }

    if (!partner.kycDocuments) partner.kycDocuments = {};

    partner.kycDocuments.aadhaar = {
      number: effectiveAadhaarNum,
      url: effectiveAadhaarUrl,
      status: 'uploaded',
    };

    partner.kycDocuments.pan = {
      number: effectivePanNum,
      url: effectivePanUrl,
      status: 'uploaded',
    };

    const dlNum = drivingLicenseNumber || partner.kycDocuments?.drivingLicense?.number;
    const dlUrl = drivingLicenseUrl || partner.kycDocuments?.drivingLicense?.url;
    if (dlUrl || dlNum) {
      partner.kycDocuments.drivingLicense = {
        number: dlNum || '',
        url: dlUrl || '',
        status: dlUrl ? 'uploaded' : 'pending',
      };
      if (dlNum) partner.licenseNumber = dlNum;
    }

    const rcNum = vehicleRCNumber || partner.kycDocuments?.vehicleRC?.number;
    const rcUrl = vehicleRCUrl || partner.kycDocuments?.vehicleRC?.url;
    if (rcUrl || rcNum) {
      partner.kycDocuments.vehicleRC = {
        number: rcNum || '',
        url: rcUrl || '',
        status: rcUrl ? 'uploaded' : 'pending',
      };
      if (rcNum) partner.vehicleNumber = rcNum;
    }

    partner.kycStatus = 'submitted';
    partner.isApproved = false;
    partner.kycRejectReason = null;
    partner.markModified('kycDocuments');
    await partner.save();

    console.log(`📄 [KYC Submitted] Partner ${partner.name} (${partner.phone}) submitted KYC for review`);

    res.json({
      success: true,
      message: 'KYC documents successfully submit ho gaye hain! Admin review ke baad aapka account activate ho jayega.',
      partner,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

