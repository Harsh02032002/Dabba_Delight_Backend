const { Notification, WalletTransaction, Banner } = require('../models/Others');
const User = require('../models/User');
const Seller = require('../models/Seller');
const Product = require('../models/Product');

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
    const sellers = await Seller.find(filter).sort({ rating: -1 });
    res.json({ success: true, sellers, total: sellers.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getMenuItems = async (req, res) => {
  try {
    const filter = { isAvailable: true, status: 'published' };
    if (req.query.sellerId) filter.sellerId = req.query.sellerId;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.isVeg === 'true') filter.isVeg = true;
    if (req.query.search) filter.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { tags: { $regex: req.query.search, $options: 'i' } },
    ];
    const products = await Product.find(filter)
      .populate('sellerId', 'businessName type logo rating')
      .sort({ rating: -1 }).limit(Number(req.query.limit) || 20)
      .skip(((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 20));
    const total = await Product.countDocuments(filter);
    res.json({ success: true, products, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getSellerById = async (req, res) => {
  try {
    const seller = await Seller.findById(req.params.id);
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
    const products = await Product.find({ isAvailable: true, status: 'published' })
      .populate('sellerId', 'businessName type logo rating')
      .sort({ totalOrders: -1, rating: -1 }).limit(10);
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
