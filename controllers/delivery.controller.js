const { DeliveryPartner, WalletTransaction, Notification } = require('../models/Others');
const Order = require('../models/Order');
const User = require('../models/User');
const Seller = require('../models/Seller');
const { handleDeliveryResponse } = require('../services/delivery-assignment.service');
const { computeDeliveryPricing, getDeliverySlabsFromDB } = require('../utils/deliveryPricing');

// Helper to reliably credit delivery fee to rider earnings and wallet
async function creditRiderDeliveryFee(partnerIdOrUserId, order) {
  try {
    let partner = await DeliveryPartner.findOne({ userId: partnerIdOrUserId });
    if (!partner) {
      partner = await DeliveryPartner.findById(partnerIdOrUserId);
    }
    if (!partner && order.deliveryPartnerId) {
      partner = await DeliveryPartner.findById(order.deliveryPartnerId);
    }
    if (!partner) {
      console.warn(`[creditRiderDeliveryFee] No partner found for ID: ${partnerIdOrUserId}`);
      return null;
    }

    const riderFee = Number(order.deliveryFee || order.riderPayout || 30);
    partner.activeOrderId = null;
    partner.isAvailable = true;
    partner.totalDeliveries = (partner.totalDeliveries || 0) + 1;
    partner.todayDeliveries = (partner.todayDeliveries || 0) + 1;
    partner.earnings = Number(((partner.earnings || 0) + riderFee).toFixed(2));
    partner.todayEarnings = Number(((partner.todayEarnings || 0) + riderFee).toFixed(2));
    partner.weekEarnings = Number(((partner.weekEarnings || 0) + riderFee).toFixed(2));
    partner.wallet = Number(((partner.wallet || 0) + riderFee).toFixed(2));
    await partner.save();

    await WalletTransaction.create({
      deliveryPartnerId: partner._id,
      userId: partner.userId,
      type: 'credit',
      amount: riderFee,
      description: `Delivery payout for Order #${order.orderNumber || order._id}`,
      referenceType: 'delivery_payout',
      balance: partner.wallet,
    }).catch(e => console.error('WalletTransaction create error:', e.message));

    console.log(`💰 Credited ₹${riderFee} to rider ${partner.name}. Total Earnings: ₹${partner.earnings}, Today: ₹${partner.todayEarnings}`);
    return partner;
  } catch (err) {
    console.error('Error crediting rider delivery fee:', err);
    return null;
  }
}

exports.loginPartner = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const cleanInput = email.trim();
    const cleanEmail = cleanInput.toLowerCase();
    
    // Find user with delivery role or by email/phone
    let user = await User.findOne({
      $or: [
        { email: cleanEmail },
        { phone: cleanInput }
      ]
    }).select('+password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'Partner account not found' });
    }

    // Ensure role is delivery or update/allow if they have partner profile
    if (user.role !== 'delivery') {
      const existingPartner = await DeliveryPartner.findOne({ userId: user._id });
      if (existingPartner) {
        user.role = 'delivery';
        await user.save();
      } else {
        return res.status(403).json({ success: false, message: 'Account is not registered as a delivery partner' });
      }
    }

    // Find or auto-create partner profile if missing
    let partner = await DeliveryPartner.findOne({ userId: user._id });
    if (!partner) {
      console.log(`⚠️ DeliveryPartner profile missing for ${user.email}, auto-creating...`);
      partner = await DeliveryPartner.create({
        userId: user._id,
        name: user.name || 'Partner',
        phone: user.phone || user.email,
        email: user.email,
        currentLocation: {
          type: 'Point',
          coordinates: [0, 0]
        }
      });
    }
    
    // Check if user is blocked
    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: 'Account is blocked' });
    }
    
    // Debug: Check if password is available
    console.log('🔐 Password check:');
    console.log('Password available:', !!user.password);
    console.log('Password length:', user.password?.length || 0);
    
    // Compare password using bcrypt
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    // Generate JWT token with error handling
    let token;
    try {
      token = user.generateJWT();
    } catch (jwtError) {
      console.error('JWT generation failed:', jwtError);
      return res.status(500).json({ success: false, message: 'Token generation failed' });
    }
    
    res.json({ 
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
    // Case 3: No location - default to Deoria [83.7788, 26.5021]
    else {
      updateData.currentLocation = { 
        type: 'Point', 
        coordinates: [83.7788, 26.5021] // Deoria default location
      };
      updateData.city = 'Deoria';
      console.log(`  - Using Deoria default location: [83.7788, 26.5021]`);
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
    const partners = await DeliveryPartner.find({
      isOnline: true, isAvailable: true, activeOrderId: null,
      currentLocation: { $near: { $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }, $maxDistance: Number(radius) } },
    }).limit(10);
    res.json({ success: true, partners });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.assignOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId).populate('sellerId');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const sellerCoords = order.sellerId.address?.location?.coordinates || [72.87, 19.07];
    const partner = await DeliveryPartner.findOne({
      isOnline: true, isAvailable: true, activeOrderId: null,
      currentLocation: { $near: { $geometry: { type: 'Point', coordinates: sellerCoords }, $maxDistance: 10000 } },
    });
    if (!partner) return res.status(404).json({ message: 'No delivery partner available' });
    partner.activeOrderId = order._id; partner.isAvailable = false; await partner.save();
    order.deliveryPartnerId = partner._id; order.status = 'out_for_delivery';
    order.statusHistory.push({ status: 'out_for_delivery', timestamp: new Date() }); await order.save();
    res.json({ success: true, partner, order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.pickupOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.status = 'out_for_delivery';
    order.statusHistory.push({ status: 'out_for_delivery', timestamp: new Date() });
    await order.save();
    res.json({ success: true, order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deliverOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.status = 'delivered';
    order.actualDelivery = new Date();
    order.statusHistory.push({ status: 'delivered', timestamp: new Date() });
    if (order.paymentMethod === 'cod') order.paymentStatus = 'paid';
    await order.save();

    // Credit delivery fee to rider
    await creditRiderDeliveryFee(order.deliveryPartnerId, order);
    
    // Emit delivery completion to user
    const io = req.app.get('io');
    if (io) {
      io.to(`order_${order._id}`).emit('delivery_status_update', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: 'delivered',
        message: 'Your order has been delivered successfully!'
      });
      io.to(`user_${order.userId}`).emit('order_delivered', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        message: 'Your order has been delivered successfully!'
      });
    }
    
    res.json({ success: true, order });
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
      const payload = {
        orderId: activeOrderId,
        partnerId: partner._id,
        lat,
        lng,
        address: req.body.address,
        timestamp: new Date()
      };
      io.to(`order_${activeOrderId}`).emit('delivery_location_update', payload);
      io.to(`user_${activeOrderId}`).emit('delivery_location_update', payload);
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
      const fee = Number(o.deliveryFee || o.riderPayout || 30);
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
    if (!order) {
      order = await Order.findOne({
        deliveryPartnerId: partner._id,
        status: { $in: ['accepted', 'out_for_delivery', 'picked', 'arrived_at_restaurant', 'order_picked_up'] }
      })
      .populate('userId', 'name phone')
      .populate('sellerId', 'businessName address phone')
      .sort({ createdAt: -1 })
      .lean();
    }

    if (order) {
      order.customerName = order.userId?.name || order.customerName || 'Customer';
      order.customerPhone = order.userId?.phone || order.customerPhone || '';
      order.restaurantName = order.sellerId?.businessName || order.restaurantName || 'Restaurant';
      order.pickupAddress = order.sellerId?.address?.fullAddress || order.pickupAddress || 'Restaurant Address';
    }

    res.json({ success: true, order: order || null });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
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

    let partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) {
      partner = await DeliveryPartner.findById(req.user.deliveryPartnerId || req.user._id);
    }
    if (!partner) return res.status(404).json({ success: false, message: 'Delivery partner profile not found' });

    const result = await handleDeliveryResponse(orderId, partner._id, 'accepted', req.app.get('io'));
    
    if (result.success) {
      const updatedOrder = await Order.findById(orderId).populate('sellerId', 'businessName address').populate('userId', 'name phone');
      res.json({ success: true, message: 'Order accepted successfully', order: updatedOrder });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/delivery/orders/:orderId/reject
exports.rejectOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId || req.body.orderId;
    let partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) {
      partner = await DeliveryPartner.findById(req.user.deliveryPartnerId || req.user._id);
    }

    const result = await handleDeliveryResponse(orderId, partner?._id || req.user._id, 'rejected', req.app.get('io'));
    
    res.json({ success: true, message: 'Order rejection recorded' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/delivery/orders/:orderId/status
exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { status, location } = req.body;
    const { orderId } = req.params;
    const partnerId = req.user.deliveryPartnerId || req.user._id;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.deliveryPartnerId?.toString() !== partnerId.toString())
      return res.status(403).json({ message: 'Unauthorized' });

    // Update order status
    order.status = status;
    order.statusHistory.push({ 
      status, 
      timestamp: new Date(), 
      updatedBy: partnerId 
    });

    // Update delivery partner location
    if (location) {
      order.deliveryLocation = location;
      await DeliveryPartner.findByIdAndUpdate(partnerId, {
        currentLocation: {
          type: 'Point',
          coordinates: [location.lng, location.lat]
        }
      });
    }

    await order.save();

    // Send notifications for key status updates
    const io = req.app.get('io');
    
    if (status === 'arrived_at_restaurant') {
      await Notification.create({
        userId: order.sellerId,
        type: 'delivery_update',
        title: '🏃 Delivery Partner Arrived',
        message: `Delivery partner has arrived at your restaurant`,
        orderId: orderId,
        isRead: false
      });

      if (io) {
        io.to(`seller_${order.sellerId}`).emit('delivery_status_update', {
          orderId,
          status,
          message: 'Delivery partner arrived at restaurant'
        });
      }
    }

    if (status === 'order_picked_up') {
      await Notification.create({
        userId: order.userId,
        type: 'delivery_update',
        title: '🛵 Order Picked Up',
        message: `Your order #${order.orderNumber} is on the way`,
        orderId: orderId,
        isRead: false
      });

      if (io) {
        io.to(`user_${order.userId}`).emit('delivery_status_update', {
          orderId,
          status,
          message: 'Order picked up, on the way to you',
          location: location
        });
      }
    }

    if (status === 'delivered') {
      order.actualDelivery = new Date();
      order.status = 'delivered';
      if (order.paymentMethod === 'cod') {
        order.paymentStatus = 'paid';
      }
      await order.save();
      
      // Credit delivery fee to delivery partner's wallet and earnings
      await creditRiderDeliveryFee(partnerId, order);

      await Notification.create({
        userId: order.userId,
        type: 'order_delivered',
        title: '✅ Order Delivered',
        message: `Your order #${order.orderNumber} has been delivered`,
        orderId: orderId,
        isRead: false
      });

      if (io) {
        const payload = {
          orderId,
          orderNumber: order.orderNumber,
          status: 'delivered',
          message: 'Order delivered successfully!'
        };
        io.to(`order_${orderId}`).emit('delivery_status_update', payload);
        io.to(`order_${orderId}`).emit('order_status_update', payload);
        io.to(`user_${order.userId}`).emit('delivery_status_update', payload);
        io.to(`user_${order.userId}`).emit('order_status_update', payload);
        io.to(`user_${order.userId}`).emit('order_delivered', payload);
      }
    }

    res.json({ 
      success: true, 
      message: 'Delivery status updated successfully',
      order: order
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.confirmDeliveryOTP = async (req, res) => {
  try {
    const orderId = req.params.orderId || req.body.orderId;
    const { otp } = req.body;
    
    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID is required' });
    
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Verify OTP: Check if OTP matches '1234' (default fallback) or order.deliveryOtp
    const validOtp = order.deliveryOtp || '1234';
    if (otp !== validOtp && otp !== '1234') {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    order.status = 'delivered';
    order.actualDelivery = new Date();
    order.statusHistory.push({
      status: 'delivered',
      timestamp: new Date(),
      updatedBy: req.user._id
    });
    if (order.paymentMethod === 'cod') {
      order.paymentStatus = 'paid';
    }
    await order.save();

    // Credit delivery fee to partner's earnings and wallet
    await creditRiderDeliveryFee(order.deliveryPartnerId || req.user._id, order);

    const io = req.app.get('io');
    if (io) {
      const payload = {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: 'delivered',
        message: 'Your order has been delivered successfully!'
      };
      io.to(`order_${order._id}`).emit('delivery_status_update', payload);
      io.to(`order_${order._id}`).emit('order_status_update', payload);
      io.to(`user_${order.userId}`).emit('order_delivered', payload);
      io.to(`user_${order.userId}`).emit('order_status_update', payload);
      io.to(`user_${order.userId}`).emit('delivery_status_update', payload);
    }

    res.json({ success: true, message: 'Delivery OTP confirmed successfully', order });
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
    const partnerId = req.user.deliveryPartnerId || req.user._id;
    
    const orders = await Order.find({
      deliveryPartnerId: partnerId,
      status: { $in: ['out_for_delivery', 'arrived_at_restaurant', 'order_picked_up'] }
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
