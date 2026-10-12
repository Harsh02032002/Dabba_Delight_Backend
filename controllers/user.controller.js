const { Notification, WalletTransaction, Banner, DeliveryPartner } = require('../models/Others');
const User = require('../models/User');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const Order = require('../models/Order');
const RatingService = require('../services/rating.service');

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
    const filter = { isActive: true };
    if (req.query.type && req.query.type !== 'all') {
      const typeVal = req.query.type;
      filter.type = (typeVal === 'home_chef' || typeVal === 'home-chef')
        ? { $in: ['home_chef', 'home-chef'] }
        : typeVal;
    }
    if (req.query.search) filter.businessName = { $regex: req.query.search, $options: 'i' };
    
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
    // Build product filter
    const filter = { isAvailable: true, isDeleted: { $ne: true } };

    let targetSellerIds = null;
    if (req.query.type && req.query.type !== 'all') {
      const typeVal = req.query.type;
      const typeQuery = (typeVal === 'home_chef' || typeVal === 'home-chef') 
        ? { $in: ['home_chef', 'home-chef'] } 
        : typeVal;
      const matchingSellers = await Seller.find({ isActive: true, type: typeQuery }).select('_id').lean();
      targetSellerIds = matchingSellers.map(s => s._id.toString());
    }

    if (req.query.sellerIds) {
      let ids = req.query.sellerIds.split(',').map(s => s.trim()).filter(Boolean);
      if (targetSellerIds) {
        // Strictly filter to only requested type sellers
        ids = ids.filter(id => targetSellerIds.includes(id.toString()));
      }
      filter.sellerId = { $in: ids };
    } else if (req.query.sellerId) {
      if (targetSellerIds && !targetSellerIds.includes(req.query.sellerId.toString())) {
        filter.sellerId = null; // Mismatch with requested type
      } else {
        filter.sellerId = req.query.sellerId;
      }
    } else if (targetSellerIds) {
      filter.sellerId = { $in: targetSellerIds };
    }
    
    if (req.query.category) filter.category = req.query.category;
    if (req.query.isVeg === 'true') filter.isVeg = true;
    if (req.query.search) filter.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { tags: { $regex: req.query.search, $options: 'i' } },
    ];

    let products = await Product.find(filter)
      .select('_id sellerId name description sellingPrice discountPrice category image isVeg preparationTime rating totalOrders stock')
      .populate('sellerId', '_id businessName type logo rating')
      .sort({ rating: -1 })
      .limit(Number(req.query.limit) || 50)
      .skip(((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 50))
      .lean();

    // Security guarantee: filter out any product whose populated seller type doesn't match
    if (req.query.type && req.query.type !== 'all') {
      const typeVal = req.query.type;
      products = products.filter(p => {
        if (!p.sellerId) return false;
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

    if (!seller) {
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
    const products = await Product.find({ isAvailable: true, status: 'published', isAdminApproved: true })
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
      .populate('deliveryPartnerId', 'name phone vehicleType vehicleNumber currentLocation rating');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Security check: only order owner or delivery or admin can track
    if (
      order.userId.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin' &&
      req.user.role !== 'delivery'
    ) {
      return res.status(403).json({ success: false, message: 'Unauthorized to track this order' });
    }

    // Extract coordinates safely
    const sellerCoords = order.sellerId?.address?.location?.coordinates;
    const pickupCoords = order.pickupLocation?.coordinates || 
      (sellerCoords && sellerCoords.length === 2 ? sellerCoords : [77.2090, 28.6139]);

    const custCoords = order.deliveryAddress?.location?.coordinates;
    const dropCoords = order.dropLocation?.coordinates || 
      (custCoords && custCoords.length === 2 ? custCoords : [77.2190, 28.6229]);

    let riderLocation = null;
    let riderInfo = null;

    if (order.deliveryPartnerId) {
      const dp = order.deliveryPartnerId;
      if (dp.currentLocation?.coordinates && Array.isArray(dp.currentLocation.coordinates) && dp.currentLocation.coordinates.length === 2) {
        riderLocation = {
          lat: dp.currentLocation.coordinates[1],
          lng: dp.currentLocation.coordinates[0],
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
