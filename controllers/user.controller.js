const mongoose = require('mongoose');
const { toPublicSeller } = require('../utils/publicSeller');
const { Notification, WalletTransaction, Banner, DeliveryPartner } = require('../models/Others');
const User = require('../models/User');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const Order = require('../models/Order');
const RatingService = require('../services/rating.service');
const { findNearbySellers, SERVICE_RADIUS_KM, haversineKm, isValidCoords, getEffectiveSellerCoords, ELIGIBLE_SELLER_FILTER, isSellerEligible } = require('../utils/sellerGeo');

// ─── Notifications ──────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, notifications });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.markNotificationRead = async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteNotification = async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Wallet ─────────────────────────────────────
// Money only enters the wallet after the server verifies a Razorpay payment.
const MIN_TOPUP = 1;
const MAX_TOPUP = 50000;

// POST /api/user/wallet/topup { amount } -> Razorpay order to pay; nothing is credited here
exports.topupWallet = async (req, res) => {
  try {
    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
      return res.status(400).json({ success: false, message: `Enter an amount between ₹${MIN_TOPUP} and ₹${MAX_TOPUP}` });
    }
    const { createGatewayOrder } = require('./payment.controller');
    const order = await createGatewayOrder({
      amountPaise: Math.round(amount * 100),
      receipt: `wallet_${String(req.user._id).slice(-8)}_${Date.now()}`,
      notes: { purpose: 'wallet_topup', userId: String(req.user._id) },
    });
    res.json({ success: true, key: process.env.RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) { res.status(err.status || 500).json({ success: false, message: err.message }); }
};

// POST /api/user/wallet/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
exports.verifyWalletPayment = async (req, res) => {
  try {
    const b = req.body || {};
    const razorpayOrderId = b.razorpay_order_id || b.razorpayOrderId;
    const razorpayPaymentId = b.razorpay_payment_id || b.razorpayPaymentId;
    const razorpaySignature = b.razorpay_signature || b.razorpaySignature;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ success: false, message: 'Payment details are missing' });
    }

    // Already credited (retry / double tap): return the current balance
    const existing = await WalletTransaction.findOne({ referenceType: 'topup', referenceId: String(razorpayPaymentId) });
    if (existing) {
      if (String(existing.userId) !== String(req.user._id)) return res.status(409).json({ success: false, message: 'This payment has already been used' });
      const u = await User.findById(req.user._id).select('wallet');
      return res.json({ success: true, alreadyCredited: true, wallet: u?.wallet || 0 });
    }

    const { verifyGatewayPayment } = require('./payment.controller');
    const check = await verifyGatewayPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
    if (!check.ok) return res.status(check.status).json({ success: false, message: check.message });
    const notes = check.order?.notes || {};
    if (notes.purpose && notes.purpose !== 'wallet_topup') return res.status(400).json({ success: false, message: 'This payment is not a wallet top-up' });
    if (notes.userId && String(notes.userId) !== String(req.user._id)) return res.status(403).json({ success: false, message: 'This payment belongs to another account' });
    const amount = Math.round(Number(check.order?.amount_paid || 0)) / 100;
    if (!(amount > 0)) return res.status(400).json({ success: false, message: 'Payment not completed yet' });

    // Record first (unique per payment), then credit
    let txn;
    try {
      txn = await WalletTransaction.create({
        userId: req.user._id, type: 'credit', amount, description: 'Wallet top-up (Razorpay)',
        referenceType: 'topup', referenceId: String(razorpayPaymentId),
      });
    } catch (dupErr) {
      const u = await User.findById(req.user._id).select('wallet');
      return res.json({ success: true, alreadyCredited: true, wallet: u?.wallet || 0 });
    }
    const user = await User.findByIdAndUpdate(req.user._id, { $inc: { wallet: amount } }, { new: true });
    await WalletTransaction.updateOne({ _id: txn._id }, { $set: { balance: user.wallet } });

    await Notification.create({
      userId: req.user._id,
      type: 'wallet',
      title: 'Money added to wallet',
      message: `₹${amount} was added to your wallet. Balance: ₹${user.wallet}`,
      isRead: false,
    });
    res.json({ success: true, amount, wallet: user.wallet });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getWalletTransactions = async (req, res) => {
  try {
    const transactions = await WalletTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
    const user = await User.findById(req.user._id);
    res.json({ success: true, transactions, balance: user.wallet });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const DEFAULT_LOGO = 'https://images.unsplash.com/photo-1495195129352-aec325b55b65?w=200&h=200&fit=crop&q=80';
const DEFAULT_COVER = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1000&h=400&fit=crop&q=80';

// ─── User Sellers & Menu ────────────────────────
exports.getSellers = async (req, res) => {
  try {
    const { lat, lng, radius, city, locationName, type, search } = req.query;

    const hasUserCoords = isValidCoords([Number(lng), Number(lat)]);
    const hasArea = !!(city || locationName);

    if (hasUserCoords || hasArea) {
      const sellers = await findNearbySellers({
        lat,
        lng,
        radiusMeters: radius,
        type,
        areaName: city || locationName,
        limit: 50,
      });

      const sellersWithImages = (sellers || []).map(seller => ({
        ...seller,
        logo: seller.logo || DEFAULT_LOGO,
        coverImage: seller.coverImage || DEFAULT_COVER,
        image: seller.coverImage || DEFAULT_COVER,
      }));

      return res.json({ success: true, sellers: sellersWithImages.map(toPublicSeller), total: sellersWithImages.length });
    }

    const filter = { ...ELIGIBLE_SELLER_FILTER };
    if (type && type !== 'all') {
      const typeVal = type;
      filter.type = (typeVal === 'home_chef' || typeVal === 'home-chef')
        ? { $in: ['home_chef', 'home-chef'] }
        : typeVal;
    }
    if (search) filter.businessName = { $regex: search, $options: 'i' };
    
    const sellers = await Seller.find(filter)
      .select('_id businessName type logo coverImage rating totalOrders totalRevenue cuisines address isActive isVerified description')
      .sort({ rating: -1 })
      .lean();

    const sellersWithImages = sellers.map(seller => ({
      ...seller,
      logo: seller.logo || DEFAULT_LOGO,
      coverImage: seller.coverImage || DEFAULT_COVER,
      image: seller.coverImage || DEFAULT_COVER,
    }));

    res.json({ success: true, sellers: sellersWithImages.map(toPublicSeller), total: sellers.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getMenuItems = async (req, res) => {
  try {
    // Only fetch products that have an active seller and are available
    // Only available, published items of approved sellers (see ELIGIBLE_SELLER_FILTER)
    const filter = { isAvailable: true, status: { $nin: ['draft', 'archived'] }, stock: { $ne: 0 }, isDeleted: { $ne: true }, sellerId: { $ne: null, $exists: true } };

    const { lat, lng, radius, city, locationName, sellerId, sellerIds, type, category, isVeg, search, page = 1, limit = 50 } = req.query;

    const hasUserCoords = isValidCoords([Number(lng), Number(lat)]);
    const hasArea = !!(city || locationName);

    // If client requested a specific sellerId AND passed coordinates:
    if (sellerId) {
      const targetSeller = mongoose.Types.ObjectId.isValid(String(sellerId)) ? await Seller.findById(sellerId).lean() : null;
      if (!isSellerEligible(targetSeller)) {
        return res.json({ success: true, products: [], total: 0, notAvailable: true, message: 'This kitchen is not accepting orders right now.' });
      }
    }
    if (sellerId && hasUserCoords) {
      const targetSeller = await Seller.findById(sellerId);
      if (targetSeller) {
        const { coords: sellerPoint } = getEffectiveSellerCoords(targetSeller.toObject ? targetSeller.toObject() : targetSeller);
        const userPoint = [Number(lng), Number(lat)];
        if (sellerPoint && isValidCoords(userPoint)) {
          const distKm = haversineKm(userPoint, sellerPoint);
          if (distKm > SERVICE_RADIUS_KM) {
            return res.json({
              success: true,
              products: [],
              total: 0,
              notServiceable: true,
              distanceKm: Math.round(distKm * 10) / 10,
              message: `This seller is ${distKm.toFixed(1)} km away. Delivery is only available within ${SERVICE_RADIUS_KM} km.`
            });
          }
        }
      }
    }

    let targetSellerIds = null;

    if (type && type !== 'all') {
      const typeVal = type;
      const typeQuery = (typeVal === 'home_chef' || typeVal === 'home-chef') 
        ? { $in: ['home_chef', 'home-chef'] } 
        : typeVal;
      const matchingSellers = await Seller.find({ ...ELIGIBLE_SELLER_FILTER, type: typeQuery }).select('_id').lean();
      targetSellerIds = matchingSellers.map(s => s._id.toString());
    }

    // Location-wise menu restriction: strictly only sellers within SERVICE_RADIUS_KM (12 km)
    if (hasUserCoords || hasArea) {
      const nearby = await findNearbySellers({
        lat,
        lng,
        radiusMeters: radius,
        type,
        areaName: city || locationName,
        limit: 500,
      });
      const nearbyIds = nearby.map(s => s._id.toString());
      targetSellerIds = targetSellerIds
        ? targetSellerIds.filter(id => nearbyIds.includes(id))
        : nearbyIds;
    }

    if (sellerIds) {
      let ids = String(sellerIds).split(',').map(s => s.trim()).filter(Boolean);
      if (targetSellerIds) {
        ids = ids.filter(id => targetSellerIds.includes(id.toString()));
      }
      filter.sellerId = { $in: ids };
    } else if (sellerId) {
      if (targetSellerIds && !targetSellerIds.includes(sellerId.toString())) {
        filter.sellerId = null; // Mismatch with nearby sellers or type
      } else {
        filter.sellerId = sellerId;
      }
    } else if (targetSellerIds) {
      filter.sellerId = { $in: targetSellerIds };
    } else if (!hasUserCoords && !hasArea) {
      // If client sent no location and no seller ID, never leak items from distant cities!
      return res.json({
        success: true,
        products: [],
        total: 0,
        message: 'Location required to load nearby menu items'
      });
    }

    if (category) filter.category = category;
    if (isVeg === 'true') filter.isVeg = true;
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } },
    ];

    let products = await Product.find(filter)
      .select('_id sellerId name description sellingPrice discountPrice category image isVeg preparationTime rating totalOrders stock')
      .populate('sellerId', '_id businessName type logo rating address isActive kycStatus')
      .sort({ rating: -1 })
      .limit(Number(limit) || 50)
      .skip(((Number(page) || 1) - 1) * (Number(limit) || 50))
      .lean();

    // Ensure the populated seller exists and is approved (never leak menus of pending/rejected sellers)
    products = products.filter(p => p.sellerId != null && isSellerEligible(p.sellerId));

    // Strict type check
    if (type && type !== 'all') {
      const typeVal = type;
      products = products.filter(p => {
        const sType = typeof p.sellerId === 'object' ? p.sellerId.type : null;
        if (!sType) return false;
        if (typeVal === 'home_chef' || typeVal === 'home-chef') {
          return sType === 'home_chef' || sType === 'home-chef';
        }
        return sType === typeVal;
      });
    }

    res.json({ success: true, products, total: products.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getSellerById = async (req, res) => {
  try {
    // Select only required fields
    const seller = await Seller.findById(req.params.id)
      .select('-bankDetails -kycDocuments.aadhaar -kycDocuments.pan -kycDocuments.fssai -kycDocuments.bankProof')
      .lean();

    if (!seller || !isSellerEligible(seller)) {
      return res.status(404).json({ success: false, message: 'Seller not found' });
    }

    // Add default images if missing
    seller.logo = seller.logo || DEFAULT_LOGO;
    seller.coverImage = seller.coverImage || DEFAULT_COVER;
    seller.image = seller.coverImage || DEFAULT_COVER;

    res.json({ success: true, seller: toPublicSeller(seller) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRecommendations = async (req, res) => {
  try {
    const eligibleSellerIds = await Seller.find(ELIGIBLE_SELLER_FILTER).distinct('_id');
    const products = await Product.find({ isAvailable: true, status: 'published', isAdminApproved: true, sellerId: { $in: eligibleSellerIds } })
      .select('_id sellerId name description sellingPrice discountPrice category image isVeg preparationTime rating totalOrders')
      .populate('sellerId', '_id businessName type logo rating')
      .sort({ totalOrders: -1, rating: -1 })
      .limit(10)
      .lean(); // Use lean() for faster queries
    res.json({ success: true, products });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Banners ────────────────────────────────────
exports.getActiveBanners = async (req, res) => {
  try {
    const banners = await Banner.find({ isActive: true }).sort({ sortOrder: 1 });
    res.json({ success: true, banners });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Ratings ────────────────────────────────────
exports.rateOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { review } = req.body;
    const rating = parseRating(req.body?.rating);
    if (!rating) {
      return res.status(400).json({ success: false, message: 'Rating must be a whole number from 1 to 5' });
    }

    const Order = require('../models/Order');
    const order = await Order.findOne({ _id: orderId, userId: req.user._id });
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status !== 'delivered') {
      return res.status(400).json({ success: false, message: 'Order must be delivered to be rated' });
    }

    const updatedOrder = await RatingService.updateOrderRating(orderId, rating, review);
    
    res.json({ 
      success: true, 
      message: 'Rating submitted successfully',
      order: updatedOrder
    });
  } catch (err) { 
    res.status(500).json({ success: false, message: err.message }); 
  }
};

exports.getSellerRatingBreakdown = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const breakdown = await RatingService.getSellerRatingBreakdown(sellerId);
    res.json({ success: true, breakdown });
  } catch (err) { 
    res.status(500).json({ success: false, message: err.message }); 
  }
};

// POST /user/menu/:menuItemId/rate
/** Whole-star rating 1..5, or null */
const parseRating = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

/** Running average without re-reading every rating */
const withRating = (doc, rating) => {
  const count = Number(doc.ratingCount || doc.totalRatings || 0);
  const avg = Number(doc.rating || 0);
  doc.rating = Math.round((((avg * count) + rating) / (count + 1)) * 10) / 10;
  doc.ratingCount = count + 1;
};

// POST /user/menu/:menuItemId/rate — only after receiving the dish, once per customer
exports.rateMenuItem = async (req, res) => {
  try {
    const rating = parseRating(req.body?.rating);
    if (!rating) return res.status(400).json({ success: false, message: 'Rating must be a whole number from 1 to 5' });
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(String(req.params.menuItemId))) return res.status(404).json({ success: false, message: 'Menu item not found' });

    const Product = require('../models/Product');
    const Order = require('../models/Order');
    const { Review } = require('../models/Others');
    const menuItem = await Product.findById(req.params.menuItemId);
    if (!menuItem) return res.status(404).json({ success: false, message: 'Menu item not found' });

    const order = await Order.findOne({ userId: req.user._id, status: 'delivered', 'items.menuItemId': menuItem._id }).select('_id').lean();
    if (!order) return res.status(403).json({ success: false, message: 'You can rate a dish after it has been delivered to you' });

    try {
      await Review.create({ kind: 'item', orderId: order._id, userId: req.user._id, sellerId: menuItem.sellerId, productId: menuItem._id, rating, review: req.body?.review });
    } catch (dup) {
      return res.status(409).json({ success: false, message: 'You have already rated this dish' });
    }
    withRating(menuItem, rating);
    await menuItem.save();
    res.json({ success: true, rating: menuItem.rating });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /user/sellers/:sellerId/rate — only after an order from this kitchen, once per customer
exports.rateSeller = async (req, res) => {
  try {
    const rating = parseRating(req.body?.rating);
    if (!rating) return res.status(400).json({ success: false, message: 'Rating must be a whole number from 1 to 5' });
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(String(req.params.sellerId))) return res.status(404).json({ success: false, message: 'Seller not found' });

    const Seller = require('../models/Seller');
    const Order = require('../models/Order');
    const { Review } = require('../models/Others');
    const seller = await Seller.findById(req.params.sellerId);
    if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

    const order = await Order.findOne({ userId: req.user._id, sellerId: seller._id, status: 'delivered' }).select('_id').lean();
    if (!order) return res.status(403).json({ success: false, message: 'You can rate a kitchen after an order from it has been delivered' });

    try {
      await Review.create({ kind: 'seller', orderId: order._id, userId: req.user._id, sellerId: seller._id, rating, review: req.body?.review });
    } catch (dup) {
      return res.status(409).json({ success: false, message: 'You have already rated this kitchen' });
    }
    withRating(seller, rating);
    await seller.save();
    res.json({ success: true, rating: seller.rating });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/user/orders/:orderId/track
exports.getOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId)
      .populate('sellerId', 'businessName phone address')
      .populate('deliveryPartnerId', 'userId name phone vehicleType vehicleNumber currentLocation rating');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Security check: only the order owner, its assigned rider, or an admin can track
    const isOwner = order.userId.toString() === req.user._id.toString();
    const isAssignedRider = req.user.role === 'delivery' && order.deliveryPartnerId
      && String(order.deliveryPartnerId.userId) === String(req.user._id);
    if (!isOwner && !isAssignedRider && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to track this order' });
    }

    // Extract coordinates safely
    const sellerCoords = order.sellerId?.address?.location?.coordinates;
    const pickupCoords = order.pickupLocation?.coordinates || 
      (sellerCoords && sellerCoords.length === 2 ? sellerCoords : [76.7794, 30.7333]);

    const custCoords = order.deliveryAddress?.location?.coordinates;
    let dropCoords = order.dropLocation?.coordinates || 
      (custCoords && custCoords.length === 2 ? custCoords : null);

    // If dropCoords is missing, or is hardcoded Delhi while pickup is not Delhi, or >35km from pickup:
    const isDelhiDrop = dropCoords && Math.abs(dropCoords[0] - 77.2190) < 0.05 && Math.abs(dropCoords[1] - 28.6229) < 0.05;
    const isDelhiPickup = pickupCoords && Math.abs(pickupCoords[0] - 77.2090) < 0.05 && Math.abs(pickupCoords[1] - 28.6139) < 0.05;

    let distKm = 0;
    if (pickupCoords && dropCoords) {
      const lat1 = pickupCoords[1], lon1 = pickupCoords[0];
      const lat2 = dropCoords[1], lon2 = dropCoords[0];
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      distKm = R * c;
    }

    if (!dropCoords || (isDelhiDrop && !isDelhiPickup) || distKm > 35) {
      // Place drop within ~1.5km of pickup so user tracking map doesn't zoom out across India
      dropCoords = [pickupCoords[0] + 0.009, pickupCoords[1] + 0.007];
    }

    let riderLocation = null;
    let riderInfo = null;

    if (order.deliveryPartnerId) {
      const dp = order.deliveryPartnerId;
      if (dp.currentLocation?.coordinates && Array.isArray(dp.currentLocation.coordinates) && dp.currentLocation.coordinates.length === 2) {
        riderLocation = {
          lat: dp.currentLocation.coordinates[1],
          lng: dp.currentLocation.coordinates[0],
        };
      } else if (order.deliveryLocation?.coordinates && Array.isArray(order.deliveryLocation.coordinates) && order.deliveryLocation.coordinates.length === 2) {
        riderLocation = {
          lat: order.deliveryLocation.coordinates[1],
          lng: order.deliveryLocation.coordinates[0],
        };
      }
      riderInfo = {
        name: dp.name || 'Delivery Partner',
        phone: dp.phone || '',
        vehicleType: dp.vehicleType || 'bike',
        vehicleNumber: dp.vehicleNumber || '',
        rating: dp.rating || 5.0,
      };
    }

    res.json({
      success: true,
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        deliveryStatus: order.deliveryStatus || null,
        deliveryOtp: order.deliveryOtp || null,
        riderAssignedAt: order.riderAssignedAt || null,
        pickedUpAt: order.pickedUpAt || null,
        actualDelivery: order.actualDelivery || null,
        estimatedDelivery: order.estimatedDelivery || null,
        statusHistory: order.statusHistory,
        restaurantName: order.sellerId?.businessName || 'Restaurant',
        restaurantPhone: order.sellerId?.phone || '',
        deliveryAddress: order.deliveryAddress,
        pickupCoords: {
          lat: pickupCoords[1],
          lng: pickupCoords[0],
        },
        dropCoords: {
          lat: dropCoords[1],
          lng: dropCoords[0],
        },
        riderLocation,
        riderInfo,
        total: order.total,
        deliveryFee: order.deliveryFee,
        createdAt: order.createdAt,
      },
    });
  } catch (err) {
    console.error('getOrderTracking error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
