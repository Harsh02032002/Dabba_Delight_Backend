const Order = require('../models/Order');
const User = require('../models/User');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const {
  Settlement, Referral, Dispute, AuditLog, Category, Campaign,
  CommissionConfig, GSTConfig, ReferralConfig, PlatformConfig, Notification,
  WalletTransaction,
} = require('../models/Others');

// ─── Audit Log Helper ───────────────────────────
async function logAction(req, action, entity, entityId, details = {}) {
  await AuditLog.create({ userId: req.user._id, action, entity, entityId, details, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
}

// ─── Dashboard ──────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [totalUsers, totalSellers, totalOrders, todayOrders, totalRevenue, pendingSellers, activeProducts] = await Promise.all([
      User.countDocuments({ role: 'user' }), Seller.countDocuments(), Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.aggregate([{ $match: { status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Seller.countDocuments({ kycStatus: 'submitted' }), Product.countDocuments({ isAvailable: true }),
    ]);
    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(10).populate('userId', 'name').populate('sellerId', 'businessName');
    res.json({ success: true, totalUsers, totalSellers, totalOrders, todayOrders, totalRevenue: totalRevenue[0]?.total || 0, pendingSellers, activeProducts, recentOrders });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Analytics ──────────────────────────────────
const getDateFilter = (period) => {
  const now = new Date(); const d = new Date();
  switch (period) { case 'today': d.setHours(0,0,0,0); break; case 'week': d.setDate(d.getDate()-7); break; case 'month': d.setMonth(d.getMonth()-1); break; case 'year': d.setFullYear(d.getFullYear()-1); break; default: d.setDate(d.getDate()-7); }
  return { $gte: d, $lte: now };
};

exports.getAnalytics = async (req, res) => {
  try {
    const { period = 'week' } = req.query; const dateFilter = getDateFilter(period);
    const [orders, revenue, users, sellers] = await Promise.all([
      Order.countDocuments({ createdAt: dateFilter }),
      Order.aggregate([{ $match: { status: 'delivered', createdAt: dateFilter } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      User.countDocuments({ role: 'user', createdAt: dateFilter }), Seller.countDocuments({ createdAt: dateFilter }),
    ]);
    const dailyData = await Order.aggregate([
      { $match: { createdAt: dateFilter } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ success: true, totalOrders: orders, totalRevenue: revenue[0]?.total || 0, newUsers: users, newSellers: sellers, dailyData });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getCityWiseRevenue = async (req, res) => {
  try {
    const cityData = await Order.aggregate([{ $match: { status: 'delivered' } }, { $group: { _id: '$deliveryAddress.city', revenue: { $sum: '$total' }, orders: { $sum: 1 } } }, { $sort: { revenue: -1 } }, { $limit: 20 }]);
    res.json({ success: true, cityData });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getCategoryWiseSales = async (req, res) => {
  try {
    const categoryData = await Order.aggregate([
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.menuItemId', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$product.category', revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }, quantity: { $sum: '$items.quantity' } } },
      { $sort: { revenue: -1 } },
    ]);
    res.json({ success: true, categoryData });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getCartDropoffs = async (req, res) => {
  try { res.json({ success: true, addedToCart: 1000, reachedCheckout: 650, paymentInitiated: 500, orderPlaced: 420, dropoffRate: 58 }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Sellers ────────────────────────────────────
exports.getSellers = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      if (req.query.status === 'active') filter.isActive = true;
      else if (req.query.status === 'inactive') filter.isActive = false;
      else if (req.query.status === 'pending') filter.kycStatus = 'submitted';
    }
    const sellers = await Seller.find(filter).populate('userId', 'name email phone').sort({ createdAt: -1 });
    res.json({ success: true, sellers });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createSeller = async (req, res) => {
  try {
    const { name, email, password, phone, businessName, type, address, gstNumber } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email already exists' });
    }
    
    // Create user with seller role
    const user = await User.create({
      name,
      email,
      password,
      phone,
      role: 'seller',
      isVerified: true
    });
    
    // Create seller profile
    const seller = await Seller.create({
      userId: user._id,
      businessName,
      type: type || 'home_chef',
      email,
      phone,
      address,
      gstNumber,
      isActive: true,
      isVerified: true,
      kycStatus: 'verified'
    });
    
    await logAction(req, 'seller_created', 'Seller', seller._id, { businessName, email });
    
    res.status(201).json({ 
      success: true, 
      message: 'Seller created successfully', 
      seller: await Seller.findById(seller._id).populate('userId', 'name email phone')
    });
  } catch (err) { 
    console.error('Create seller error:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

exports.approveSeller = async (req, res) => {
  try {
    const seller = await Seller.findByIdAndUpdate(req.params.id, { isActive: true, isVerified: true, kycStatus: 'verified' }, { new: true });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });
    await logAction(req, 'seller_approved', 'Seller', seller._id, { businessName: seller.businessName });
    await Notification.create({ userId: seller.userId, type: 'kyc', title: 'KYC Approved', message: 'Your seller account has been verified.' });
    res.json({ success: true, seller });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.rejectSeller = async (req, res) => {
  try {
    const seller = await Seller.findByIdAndUpdate(req.params.id, { isActive: false, kycStatus: 'rejected' }, { new: true });
    if (!seller) return res.status(404).json({ message: 'Seller not found' });
    await logAction(req, 'seller_rejected', 'Seller', seller._id);
    res.json({ success: true, seller });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteSeller = async (req, res) => {
  try {
    const seller = await Seller.findById(req.params.id);
    if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });
    
    // Delete seller and associated user
    await Seller.findByIdAndDelete(req.params.id);
    if (seller.userId) {
      await User.findByIdAndDelete(seller.userId);
    }
    
    await logAction(req, 'seller_deleted', 'Seller', req.params.id, { businessName: seller.businessName });
    res.json({ success: true, message: 'Seller deleted successfully' });
  } catch (err) { 
    console.error('Delete seller error:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

// ─── Users ──────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const { search, status } = req.query; const filter = { role: 'user' };
    if (search) filter.$or = [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }];
    if (status === 'blocked') filter.isBlocked = true;
    else if (status === 'active') filter.isBlocked = { $ne: true };
    const users = await User.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.blockUser = async (req, res) => {
  try { await User.findByIdAndUpdate(req.params.id, { isBlocked: true }); await logAction(req, 'user_blocked', 'User', req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.unblockUser = async (req, res) => {
  try { await User.findByIdAndUpdate(req.params.id, { isBlocked: false }); await logAction(req, 'user_unblocked', 'User', req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    await User.findByIdAndDelete(req.params.id);
    await logAction(req, 'user_deleted', 'User', req.params.id, { email: user.email });
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) { 
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
};

// ─── Orders ─────────────────────────────────────
exports.refundOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.paymentStatus = 'refunded'; order.status = 'cancelled';
    order.statusHistory.push({ status: 'refunded', timestamp: new Date(), updatedBy: req.user._id });
    await order.save();

    // ─── Credit refund to user wallet ──────
    const user = await User.findByIdAndUpdate(order.userId, { $inc: { wallet: order.total } }, { new: true });
    if (user) {
      await WalletTransaction.create({
        userId: order.userId, type: 'credit', amount: order.total,
        description: `Admin refund for order #${order.orderNumber}`,
        referenceId: order._id.toString(), referenceType: 'refund', balance: user.wallet,
      });
      await Notification.create({
        userId: order.userId, type: 'wallet',
        title: 'Refund Credited', message: `₹${order.total} refunded to your wallet for order #${order.orderNumber}`,
      });
    }

    await logAction(req, 'order_refunded', 'Order', order._id, { amount: order.total });
    res.json({ success: true, order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Disputes ───────────────────────────────────
exports.getDisputes = async (req, res) => {
  try {
    const disputes = await Dispute.find().populate('orderId', 'orderNumber total').populate('userId', 'name email').populate('sellerId', 'businessName').sort({ createdAt: -1 });
    res.json({ success: true, disputes });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.resolveDispute = async (req, res) => {
  try {
    const { status, resolution } = req.body;
    const dispute = await Dispute.findByIdAndUpdate(req.params.id, { status, resolution, resolvedBy: req.user._id, resolvedAt: new Date() }, { new: true });
    await logAction(req, 'dispute_resolved', 'Dispute', dispute._id, { status, resolution });
    res.json({ success: true, dispute });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Audit Logs ─────────────────────────────────
exports.getAuditLogs = async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query; const filter = {};
    if (search) filter.$or = [{ action: { $regex: search, $options: 'i' } }, { entity: { $regex: search, $options: 'i' } }];
    const logs = await AuditLog.find(filter).populate('userId', 'name email role').sort({ createdAt: -1 }).limit(Number(limit)).skip((Number(page) - 1) * Number(limit));
    const total = await AuditLog.countDocuments(filter);
    res.json({ success: true, logs, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Categories ─────────────────────────────────
exports.getCategories = async (req, res) => {
  try { const categories = await Category.find().sort({ sortOrder: 1 }); res.json({ success: true, categories }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, icon, image, description } = req.body;
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    const category = await Category.create({ name, slug, icon, image, description });
    await logAction(req, 'category_created', 'Category', category._id, { name });
    res.status(201).json({ success: true, category });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteCategory = async (req, res) => {
  try { await Category.findByIdAndDelete(req.params.id); await logAction(req, 'category_deleted', 'Category', req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Settlements ────────────────────────────────
exports.getSettlements = async (req, res) => {
  try {
    const filter = {}; if (req.query.status) filter.status = req.query.status;
    const settlements = await Settlement.find(filter).populate('sellerId', 'businessName bankDetails').sort({ createdAt: -1 });
    res.json({ success: true, settlements });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.processSettlement = async (req, res) => {
  try {
    const settlement = await Settlement.findByIdAndUpdate(req.params.id, { status: 'completed', processedAt: new Date(), transactionId: 'TXN-' + Date.now() }, { new: true }).populate('sellerId');
    if (!settlement) return res.status(404).json({ message: 'Settlement not found' });

    // ─── Credit net amount to seller's user wallet ──────
    if (settlement.sellerId?.userId) {
      const sellerUser = await User.findByIdAndUpdate(settlement.sellerId.userId, { $inc: { wallet: settlement.netAmount } }, { new: true });
      if (sellerUser) {
        await WalletTransaction.create({
          userId: sellerUser._id, type: 'credit', amount: settlement.netAmount,
          description: `Settlement payout (${settlement.totalOrders} orders)`,
          referenceId: settlement._id.toString(), referenceType: 'settlement', balance: sellerUser.wallet,
        });
        await Notification.create({
          userId: sellerUser._id, type: 'wallet',
          title: 'Settlement Credited! 💰', message: `₹${settlement.netAmount} has been credited to your wallet`,
        });
      }
    }

    await logAction(req, 'settlement_processed', 'Settlement', settlement._id, { amount: settlement.netAmount });
    res.json({ success: true, settlement });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.bulkProcessSettlements = async (req, res) => {
  try {
    const { ids } = req.body;
    await Settlement.updateMany({ _id: { $in: ids }, status: 'pending' }, { status: 'completed', processedAt: new Date(), transactionId: 'BULK-' + Date.now() });
    await logAction(req, 'settlements_bulk_processed', 'Settlement', null, { count: ids.length });
    res.json({ success: true, processed: ids.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Commission ─────────────────────────────────
exports.getCommissionConfig = async (req, res) => {
  try { let config = await CommissionConfig.findOne(); if (!config) config = await CommissionConfig.create({}); res.json({ success: true, ...config.toObject() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateCommissionConfig = async (req, res) => {
  try {
    const config = await CommissionConfig.findOneAndUpdate({}, { ...req.body, updatedBy: req.user._id }, { new: true, upsert: true });
    await logAction(req, 'commission_updated', 'CommissionConfig', config._id, req.body);
    res.json({ success: true, ...config.toObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── GST ────────────────────────────────────────
exports.getGSTConfig = async (req, res) => {
  try { let config = await GSTConfig.findOne(); if (!config) config = await GSTConfig.create({}); res.json({ success: true, ...config.toObject() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateGSTConfig = async (req, res) => {
  try {
    const config = await GSTConfig.findOneAndUpdate({}, { ...req.body, updatedBy: req.user._id }, { new: true, upsert: true });
    await logAction(req, 'gst_updated', 'GSTConfig', config._id, req.body);
    res.json({ success: true, ...config.toObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Referrals ──────────────────────────────────
exports.getReferrals = async (req, res) => {
  try {
    const filter = {}; if (req.query.status) filter.status = req.query.status;
    const referrals = await Referral.find(filter).populate('referrerId', 'businessName').populate('referredId', 'businessName').sort({ createdAt: -1 });
    res.json({ success: true, referrals });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getReferralConfig = async (req, res) => {
  try { let config = await ReferralConfig.findOne(); if (!config) config = await ReferralConfig.create({}); res.json({ success: true, ...config.toObject() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateReferralConfig = async (req, res) => {
  try {
    const config = await ReferralConfig.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    await logAction(req, 'referral_config_updated', 'ReferralConfig', config._id, req.body);
    res.json({ success: true, ...config.toObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Marketing ──────────────────────────────────
exports.getCampaigns = async (req, res) => {
  try { const campaigns = await Campaign.find().populate('sellerId', 'businessName').sort({ createdAt: -1 }); res.json({ success: true, campaigns }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createCampaign = async (req, res) => {
  try { const campaign = await Campaign.create(req.body); await logAction(req, 'campaign_created', 'Campaign', campaign._id); res.status(201).json({ success: true, campaign }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getMarketingSpend = async (req, res) => {
  try {
    const spend = await Campaign.aggregate([{ $group: { _id: null, totalBudget: { $sum: '$budget' }, totalSpent: { $sum: '$spent' }, totalImpressions: { $sum: '$impressions' }, totalClicks: { $sum: '$clicks' } } }]);
    res.json({ success: true, ...(spend[0] || { totalBudget: 0, totalSpent: 0, totalImpressions: 0, totalClicks: 0 }) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Performance ────────────────────────────────
exports.getSellerPerformance = async (req, res) => {
  try {
    const sellers = await Seller.aggregate([
      { $lookup: { from: 'orders', localField: '_id', foreignField: 'sellerId', as: 'orders' } },
      { $project: { businessName: 1, type: 1, rating: 1, isActive: 1, totalOrders: { $size: '$orders' }, deliveredOrders: { $size: { $filter: { input: '$orders', as: 'o', cond: { $eq: ['$$o.status', 'delivered'] } } } }, totalRevenue: { $sum: '$orders.total' } } },
      { $sort: { totalRevenue: -1 } },
    ]);
    res.json({ success: true, sellers });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getPerformanceOverview = async (req, res) => {
  try {
    const last30 = new Date(); last30.setDate(last30.getDate() - 30);
    const [orderStats] = await Promise.all([
      Order.aggregate([{ $match: { createdAt: { $gte: last30 } } }, { $group: { _id: null, total: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } } } }]),
    ]);
    const stats = orderStats[0] || {};
    res.json({ success: true, totalOrders: stats.total || 0, deliveredOrders: stats.delivered || 0, cancelledOrders: stats.cancelled || 0, fulfillmentRate: stats.total ? Math.round((stats.delivered / stats.total) * 100) : 0 });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Platform Settings ──────────────────────────
exports.getPlatformConfig = async (req, res) => {
  try { let config = await PlatformConfig.findOne(); if (!config) config = await PlatformConfig.create({}); res.json({ success: true, ...config.toObject() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updatePlatformConfig = async (req, res) => {
  try {
    const config = await PlatformConfig.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    await logAction(req, 'platform_config_updated', 'PlatformConfig', config._id, req.body);
    res.json({ success: true, ...config.toObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
