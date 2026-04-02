const { Notification, WalletTransaction, Banner } = require('../models/Others');
const User = require('../models/User');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
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

// ─── User Sellers & Menu ────────────────────────
exports.getSellers = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.search) filter.businessName = { $regex: req.query.search, $options: 'i' };
    // Select only required fields for faster response
    const sellers = await Seller.find(filter)
      .select('_id businessName type logo coverImage rating totalOrders totalRevenue cuisines address.city address.state isActive isVerified')
      .sort({ rating: -1 })
      .lean(); // Use lean() for faster queries
    res.json({ success: true, sellers, total: sellers.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getMenuItems = async (req, res) => {
  try {
    const filter = { isAvailable: true, status: 'published', isAdminApproved: true };
    if (req.query.sellerId) filter.sellerId = req.query.sellerId;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.isVeg === 'true') filter.isVeg = true;
    if (req.query.search) filter.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { tags: { $regex: req.query.search, $options: 'i' } },
    ];

    // Select only required fields for faster response
    let query = Product.find(filter)
      .select('_id sellerId name description sellingPrice discountPrice category image isVeg preparationTime rating totalOrders stock')
      .populate('sellerId', '_id businessName type logo rating')
      .sort({ rating: -1 })
      .lean(); // Use lean() for faster queries

    const products = await query
      .limit(Number(req.query.limit) || 20)
      .skip(((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 20));
    
    const total = await Product.countDocuments(filter);
    res.json({ success: true, products, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getSellerById = async (req, res) => {
  try {
    // Select only required fields
    const seller = await Seller.findById(req.params.id)
      .select('-bankDetails -kycDocuments.aadhaar -kycDocuments.pan -kycDocuments.fssai -kycDocuments.bankProof');
    if (!seller) {
      return res.status(404).json({ success: false, message: 'Seller not found' });
    }
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
