const { DeliveryPartner, WalletTransaction, Notification } = require('../models/Others');
const Order = require('../models/Order');
const User = require('../models/User');
const { handleDeliveryResponse } = require('../services/delivery-assignment.service');

exports.loginPartner = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    
    // Find user with delivery role and include password
    const user = await User.findOne({ email, role: 'delivery' }).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'Partner not found' });
    
    // Find partner profile
    const partner = await DeliveryPartner.findOne({ userId: user._id });
    if (!partner) return res.status(404).json({ success: false, message: 'Partner profile not found' });
    
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
    const partner = await DeliveryPartner.findOne({ userId: req.user._id });
    const orders = await Order.find({ deliveryPartnerId: partner._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ success: true, orders });
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
    if (lat && lng) {
      updateData.currentLocation = { 
        type: 'Point', 
        coordinates: [lng, lat] 
      };
      console.log(`  - Using provided coordinates: [${lng}, ${lat}]`);
    }
    // Case 2: Existing location is valid (not Mumbai defaults)
    else if (currentPartner.currentLocation?.coordinates && 
             !(currentPartner.currentLocation.coordinates[0] === 72.8777 && currentPartner.currentLocation.coordinates[1] === 19.076)) {
      console.log(`  - Using existing valid location:`, currentPartner.currentLocation.coordinates);
      // Don't update location - keep existing valid one
    }
    // Case 3: No valid location - use Chandigarh as default (better than Mumbai)
    else {
      updateData.currentLocation = { 
        type: 'Point', 
        coordinates: [76.74593435736934, 30.73561296326452] // Chandigarh default
      };
      console.log(`  - Using Chandigarh default location: [76.74593435736934, 30.73561296326452]`);
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
    const { lat, lng } = req.body;
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude required' });
    }
    
    console.log(`📍 Location update from ${req.user.email}:`);
    console.log(`  - Raw coordinates: { lat: ${lat}, lng: ${lng} }`);
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
      { new: true } // Return updated document
    );
    
    console.log(`✅ Location update result:`, {
      success: !!result,
      partnerId: result?._id,
      savedCoordinates: result?.currentLocation?.coordinates,
      partnerName: result?.name
    });
    
    if (!result) {
      console.log(`❌ No delivery partner found for user ID: ${req.user._id}`);
      return res.status(404).json({ success: false, message: 'Delivery partner not found' });
    }
    
    res.json({ success: true });
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
    order.status = 'delivered'; order.actualDelivery = new Date();
    order.statusHistory.push({ status: 'delivered', timestamp: new Date() });
    if (order.paymentMethod === 'cod') order.paymentStatus = 'paid';
    await order.save();
    const partner = await DeliveryPartner.findById(order.deliveryPartnerId);
    if (partner) { partner.activeOrderId = null; partner.isAvailable = true; partner.totalDeliveries += 1; partner.earnings += order.deliveryFee || 30; await partner.save(); }
    
    // Emit delivery completion to user
    const io = req.app.get('io');
    if (io) {
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
    const { lat, lng, address } = req.body;
    const partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    
    partner.currentLocation = { type: 'Point', coordinates: [lng, lat] };
    await partner.save();
    
    // Emit location update to user
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${partner.activeOrderId}`).emit('delivery_location_update', {
        orderId: partner.activeOrderId,
        lat,
        lng,
        address,
        timestamp: new Date()
      });
    }
    
    res.json({ success: true, location: partner.currentLocation });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getEarnings = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    res.json({ success: true, earnings: partner.earnings, totalDeliveries: partner.totalDeliveries });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getActiveOrder = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findOne({ userId: req.user._id }).populate('activeOrderId');
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    res.json({ success: true, order: partner.activeOrderId });
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
    const { orderId } = req.params;
    const partnerId = req.user.deliveryPartnerId || req.user._id;

    const result = await handleDeliveryResponse(orderId, partnerId, 'accepted', req.app.get('io'));
    
    if (result.success) {
      res.json({ success: true, message: 'Order accepted successfully' });
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
    const { orderId } = req.params;
    const partnerId = req.user.deliveryPartnerId || req.user._id;

    const result = await handleDeliveryResponse(orderId, partnerId, 'rejected', req.app.get('io'));
    
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
      
      // Mark partner as available again
      await DeliveryPartner.findByIdAndUpdate(partnerId, {
        isAvailable: true,
        currentOrder: null
      });

      await Notification.create({
        userId: order.userId,
        type: 'order_delivered',
        title: '✅ Order Delivered',
        message: `Your order #${order.orderNumber} has been delivered`,
        orderId: orderId,
        isRead: false
      });

      if (io) {
        io.to(`user_${order.userId}`).emit('delivery_status_update', {
          orderId,
          status,
          message: 'Order delivered successfully!'
        });
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
