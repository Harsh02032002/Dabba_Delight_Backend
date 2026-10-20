const mongoose = require('mongoose');
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
exports.topupWallet = async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findByIdAndUpdate(req.user._id, { $inc: { wallet: amount } }, { new: true });
    await WalletTransaction.create({
      userId: req.user._id, type: 'credit', amount, description: 'Wallet top-up',
      referenceType: 'topup', balance: user.wallet,
    });
    
    // ─── Create Notification for Wallet Top-up ───
    await Notification.create({
      userId: req.user._id,
      type: 'wallet',
      title: '💳 Wallet Topped Up',
      message: `₹${amount} has been successfully added to your wallet. Current Balance: ₹${user.wallet}`,
      isRead: false,
    });
    res.json({ success: true, wallet: user.wallet });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.verifyWalletPayment = async (req, res) => {
  try {
    // After Razorpay payment verified, credit wallet
    const { amount } = req.body;
    const user = await User.findByIdAndUpdate(req.user._id, { $inc: { wallet: amount } }, { new: true });
    await WalletTransaction.create({
      userId: req.user._id, type: 'credit', amount, description: 'Wallet top-up verified',
      referenceType: 'topup', balance: user.wallet,
    });
    
    // ─── Create Notification for Wallet Top-up ───
    await Notification.create({
      userId: req.user._id,
      type: 'wallet',
      title: '💳 Wallet Top-up Successful',
      message: `Your payment of ₹${amount} was verified and added to your wallet. Current Balance: ₹${user.wallet}`,
      isRead: false,
    });
    res.json({ success: true, wallet: user.wallet });
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

      return res.json({ success: true, sellers: sellersWithImages, total: sellersWithImages.length });
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

    res.json({ success: true, sellers: sellersWithImages, total: sellers.length });
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

    res.json({ success: true, seller });
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
    const { rating, review } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
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
exports.rateMenuItem = async (req, res) => {
  try {
    const { menuItemId } = req.params;
    const { rating } = req.body;
    const userId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Invalid rating' });
    }

    // Find the menu item
    const Product = require('../models/Product');
    const menuItem = await Product.findById(menuItemId);
    if (!menuItem) {
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }

    // Update menu item rating (simple average for now)
    const currentRating = menuItem.rating || 0;
    const currentRatings = menuItem.ratingCount || 0;
    
    menuItem.rating = ((currentRating * currentRatings) + rating) / (currentRatings + 1);
    menuItem.ratingCount = currentRatings + 1;
    await menuItem.save();

    res.json({ success: true, rating: menuItem.rating });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /user/sellers/:sellerId/rate
exports.rateSeller = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { rating } = req.body;
    const userId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Invalid rating' });
    }

    // Find the seller
    const Seller = require('../models/Seller');
    const seller = await Seller.findById(sellerId);
    if (!seller) {
      return res.status(404).json({ success: false, message: 'Seller not found' });
    }

    // Update seller rating (simple average for now)
    const currentRating = seller.rating || 0;
    const currentRatings = seller.ratingCount || 0;
    
    seller.rating = ((currentRating * currentRatings) + rating) / (currentRatings + 1);
    seller.ratingCount = currentRatings + 1;
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
