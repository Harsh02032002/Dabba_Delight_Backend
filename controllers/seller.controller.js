const Order = require('../models/Order');
const Product = require('../models/Product');
const Seller = require('../models/Seller');
const User = require('../models/User');
const { WalletTransaction } = require('../models/Others');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  Settlement, Referral, Promotion, Review, Campaign, Payout,
  SupportTicket, Notification, NotificationPreference,
} = require('../models/Others');

const DEFAULT_LOGO = '';
const DEFAULT_COVER = '';

// ─── Dashboard ──────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const sellerId = req.seller._id;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    
    // Use lean() for faster queries and select only needed fields
    const [totalOrders, todayOrders, pendingOrders, totalProducts, totalRevenue, pendingSettlements] = await Promise.all([
      Order.countDocuments({ sellerId }),
      Order.countDocuments({ sellerId, createdAt: { $gte: today } }),
      Order.countDocuments({ sellerId, status: 'pending' }),
      Product.countDocuments({ sellerId }),
      Order.aggregate([{ $match: { sellerId, status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Settlement.countDocuments({ sellerId, status: 'pending' }),
    ]);
    
    // Select only required fields for recent orders
    const recentOrders = await Order.find({ sellerId })
      .select('_id orderNumber userId items total status createdAt')
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('userId', 'name')
      .lean();
      
    res.json({ 
      success: true, 
      totalOrders, 
      todayOrders, 
      pendingOrders, 
      totalProducts, 
      totalRevenue: totalRevenue[0]?.total || 0, 
      pendingSettlements, 
      recentOrders, 
      rating: req.seller.rating 
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Analytics ──────────────────────────────────
const getDateFilter = (period) => {
  const now = new Date();
  const d = new Date();
  switch (period) {
    case 'today': d.setHours(0, 0, 0, 0); break;
    case 'week': d.setDate(d.getDate() - 7); break;
    case 'month': d.setMonth(d.getMonth() - 1); break;
    case 'year': d.setFullYear(d.getFullYear() - 1); break;
    default: d.setDate(d.getDate() - 7);
  }
  return { $gte: d, $lte: now };
};

exports.getAnalytics = async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const sellerId = req.seller._id;
    const dateFilter = getDateFilter(period);
    const [orders, revenue, avgOrderValue] = await Promise.all([
      Order.countDocuments({ sellerId, createdAt: dateFilter }),
      Order.aggregate([{ $match: { sellerId, status: 'delivered', createdAt: dateFilter } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.aggregate([{ $match: { sellerId, status: 'delivered', createdAt: dateFilter } }, { $group: { _id: null, avg: { $avg: '$total' } } }]),
    ]);
    const dailyRevenue = await Order.aggregate([
      { $match: { sellerId, createdAt: dateFilter } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', revenue: 1, orders: 1, _id: 0 } },
    ]);
    res.json({ success: true, totalOrders: orders, totalRevenue: revenue[0]?.total || 0, averageOrderValue: Math.round(avgOrderValue[0]?.avg || 0), dailyRevenue });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getTopItems = async (req, res) => {
  try {
    const topItems = await Order.aggregate([
      { $match: { sellerId: req.seller._id, status: 'delivered' } }, { $unwind: '$items' },
      { $group: { _id: '$items.name', count: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
      { $sort: { revenue: -1 } }, { $limit: 10 },
      { $project: { name: '$_id', count: 1, revenue: 1, _id: 0 } },
    ]);
    res.json({ success: true, data: topItems });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getPeakHours = async (req, res) => {
  try {
    const peakHours = await Order.aggregate([
      { $match: { sellerId: req.seller._id } },
      { $group: { _id: { $hour: '$createdAt' }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { hour: '$_id', orders: 1, _id: 0 } },
    ]);
    res.json({ success: true, data: peakHours });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getRepeatCustomers = async (req, res) => {
  try {
    const sellerId = req.seller._id;
    // Total unique customers
    const totalCustomers = await Order.distinct('userId', { sellerId, status: 'delivered' });
    // Repeat customers (2+ orders)
    const repeatCustomers = await Order.aggregate([
      { $match: { sellerId, status: 'delivered' } },
      { $group: { _id: '$userId', orderCount: { $sum: 1 }, totalSpent: { $sum: '$total' } } },
      { $match: { orderCount: { $gte: 2 } } }, { $sort: { orderCount: -1 } }, { $limit: 20 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { name: '$user.name', email: '$user.email', orderCount: 1, totalSpent: 1 } },
    ]);
    const count = repeatCustomers.length;
    const percentage = totalCustomers.length > 0 ? Math.round((count / totalCustomers.length) * 100) : 0;
    res.json({ success: true, count, percentage, repeatCustomers });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getAISuggestions = async (req, res) => {
  try {
    const sellerId = req.seller._id;
    
    // Gather seller data for context
    const [orderCount, revenue, topItems, avgRating] = await Promise.all([
      Order.countDocuments({ sellerId }),
      Order.aggregate([{ $match: { sellerId, status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.aggregate([
        { $match: { sellerId, status: 'delivered' } }, { $unwind: '$items' },
        { $group: { _id: '$items.name', count: { $sum: '$items.quantity' } } },
        { $sort: { count: -1 } }, { $limit: 5 },
      ]),
      Promise.resolve(req.seller.rating || 4.0),
    ]);

    const totalRevenue = revenue[0]?.total || 0;
    const topItemNames = topItems.map(i => i._id).join(', ') || 'None yet';
    const avgOrderVal = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;

    // Try AI API (Google Gemini free tier)
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    
    if (GEMINI_KEY) {
      try {
        const prompt = `You are a food business consultant for an Indian food delivery platform. 
Based on this seller data, give exactly 5 short actionable tips (1-2 sentences each) to grow their business:
- Total orders: ${orderCount}
- Total revenue: ₹${totalRevenue}
- Average order value: ₹${avgOrderVal}
- Top items: ${topItemNames}
- Rating: ${avgRating}/5
Return ONLY a JSON array of 5 strings, no markdown.`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          }
        );
        const geminiData = await geminiRes.json();
        const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        // Extract JSON array from response
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const suggestions = JSON.parse(jsonMatch[0]);
          return res.json({ success: true, suggestions: suggestions.map((s, i) => ({ type: 'ai', message: s })) });
        }
      } catch (aiErr) {
        console.log('AI API error, falling back to rule-based:', aiErr.message);
      }
    }

    // Fallback: rule-based suggestions
    const suggestions = [];
    if (orderCount < 10) suggestions.push({ type: 'growth', message: 'You\'re just getting started! Share your store link on WhatsApp and Instagram to get your first customers.' });
    if (avgOrderVal < 200) suggestions.push({ type: 'pricing', message: `Your avg order is ₹${avgOrderVal}. Add combo meals or meal deals to increase basket size.` });
    if (avgRating < 4.0) suggestions.push({ type: 'quality', message: `Your rating is ${avgRating}/5. Focus on packaging and timely preparation to improve reviews.` });
    if (topItems.length > 0) suggestions.push({ type: 'menu', message: `"${topItems[0]._id}" is your bestseller! Consider creating variations or a combo around it.` });
    suggestions.push({ type: 'timing', message: 'Most food orders peak between 12-2 PM and 7-9 PM. Ensure you\'re online during these hours.' });
    if (suggestions.length < 5) suggestions.push({ type: 'marketing', message: 'Create a 10% off coupon for first-time customers to boost conversion.' });
    
    res.json({ success: true, suggestions: suggestions.slice(0, 5) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Earnings ───────────────────────────────────
exports.getEarnings = async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const sellerId = req.seller._id;
    const dateFilter = getDateFilter(period);
    const earnings = await Order.aggregate([
      { $match: { sellerId, status: 'delivered', createdAt: dateFilter } },
      { $group: { _id: null, totalRevenue: { $sum: '$total' }, totalOrders: { $sum: 1 }, totalCommission: { $sum: { $multiply: ['$total', req.seller.commissionRate / 100] } } } },
    ]);
    const data = earnings[0] || { totalRevenue: 0, totalOrders: 0, totalCommission: 0 };
    const dailyEarnings = await Order.aggregate([
      { $match: { sellerId, status: 'delivered', createdAt: dateFilter } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ success: true, ...data, netEarnings: data.totalRevenue - data.totalCommission, commissionRate: req.seller.commissionRate, dailyEarnings });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Settlements ────────────────────────────────
exports.getSettlements = async (req, res) => {
  try {
    const filter = { sellerId: req.seller._id };
    if (req.query.status) filter.status = req.query.status;
    const settlements = await Settlement.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, settlements });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── KYC ────────────────────────────────────────
exports.getKYCStatus = async (req, res) => {
  try {
    const docsObj = req.seller.kycDocuments || {};
    const documents = Object.entries(docsObj).map(([type, info]) => ({
      type,
      ...(info || {}),
    }));
    res.json({
      success: true,
      kycStatus: req.seller.kycStatus,
      documents,
      bankDetails: req.seller.bankDetails,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.uploadKYCDocument = async (req, res) => {
  try {
    const { type } = req.body;
    const fileUrl = req.file?.s3Url || null;
    if (!type || !fileUrl) return res.status(400).json({ message: 'type and file required' });
    if (!req.seller.kycDocuments) req.seller.kycDocuments = {};
    req.seller.kycDocuments[type] = {
      url: fileUrl,
      status: 'uploaded',
      uploadedAt: new Date(),
    };
    req.seller.markModified('kycDocuments');
    await req.seller.save();
    const docsObj = req.seller.kycDocuments || {};
    const documents = Object.entries(docsObj).map(([t, info]) => ({
      type: t,
      ...(info || {}),
    }));
    res.json({ success: true, documents });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.submitKYC = async (req, res) => {
  try { req.seller.kycStatus = 'submitted'; await req.seller.save(); res.json({ success: true, kycStatus: 'submitted' }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteKYCDocument = async (req, res) => {
  try {
    const { type } = req.params;
    if (!req.seller.kycDocuments) req.seller.kycDocuments = {};
    if (req.seller.kycDocuments[type]) {
      delete req.seller.kycDocuments[type];
      req.seller.markModified('kycDocuments');
      await req.seller.save();
    }
    const docsObj = req.seller.kycDocuments || {};
    const documents = Object.entries(docsObj).map(([t, info]) => ({
      type: t,
      ...(info || {}),
    }));
    res.json({ success: true, documents });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateKYCDocument = async (req, res) => {
  try {
    const { type } = req.params;
    const fileUrl = req.file?.s3Url || null;
    if (!type || !fileUrl) return res.status(400).json({ message: 'type and file required' });
    if (!req.seller.kycDocuments) req.seller.kycDocuments = {};
    req.seller.kycDocuments[type] = {
      url: fileUrl,
      status: 'uploaded',
      uploadedAt: new Date(),
    };
    req.seller.markModified('kycDocuments');
    await req.seller.save();
    const docsObj = req.seller.kycDocuments || {};
    const documents = Object.entries(docsObj).map(([t, info]) => ({
      type: t,
      ...(info || {}),
    }));
    res.json({ success: true, documents });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Referrals ──────────────────────────────────
exports.getReferrals = async (req, res) => {
  try {
    const referrals = await Referral.find({ referrerId: req.seller._id }).populate('referredId', 'businessName').sort({ createdAt: -1 });
    res.json({ success: true, referralCode: req.seller.referralCode, totalReferrals: referrals.length, completedReferrals: referrals.filter(r => r.status === 'completed').length, totalEarned: referrals.filter(r => r.rewardClaimed).reduce((s, r) => s + r.reward, 0), referrals });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.generateReferralCode = async (req, res) => {
  try {
    if (req.seller.referralCode) return res.json({ success: true, referralCode: req.seller.referralCode });
    const code = 'DN-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    req.seller.referralCode = code; await req.seller.save();
    res.json({ success: true, referralCode: code });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Promotions ─────────────────────────────────
exports.getPromotions = async (req, res) => {
  try { const promotions = await Promotion.find({ sellerId: req.seller._id }).sort({ createdAt: -1 }); res.json({ success: true, promotions }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createPromotion = async (req, res) => {
  try {
    const promotion = await Promotion.create({ sellerId: req.seller._id, ...req.body });
    res.status(201).json({ success: true, promotion });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.togglePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findOneAndUpdate({ _id: req.params.id, sellerId: req.seller._id }, { isActive: req.body.isActive }, { new: true });
    res.json({ success: true, promotion });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Reviews ────────────────────────────────────
exports.getReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ sellerId: req.seller._id }).populate('userId', 'name avatar').populate('orderId', 'orderNumber').sort({ createdAt: -1 });
    res.json({ success: true, reviews });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.replyToReview = async (req, res) => {
  try {
    const review = await Review.findOneAndUpdate({ _id: req.params.id, sellerId: req.seller._id }, { reply: { message: req.body.message, repliedAt: new Date() } }, { new: true });
    res.json({ success: true, review });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Inventory ──────────────────────────────────
exports.getInventory = async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.seller._id }).sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getExpiryAlerts = async (req, res) => {
  try { res.json({ success: true, alerts: [] }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Customers ──────────────────────────────────
exports.getCustomers = async (req, res) => {
  try {
    const customers = await Order.aggregate([
      { $match: { sellerId: req.seller._id, status: 'delivered' } },
      { $group: { _id: '$userId', totalOrders: { $sum: 1 }, totalSpent: { $sum: '$total' }, lastOrder: { $max: '$createdAt' }, avgOrderValue: { $avg: '$total' } } },
      { $sort: { totalSpent: -1 } }, { $limit: 100 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { _id: '$user._id', name: '$user.name', email: '$user.email', phone: '$user.phone', totalOrders: 1, totalSpent: 1, lastOrder: 1, avgOrderValue: 1 } },
    ]);
    res.json({ success: true, customers });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.awardLoyaltyPoints = async (req, res) => {
  try {
    const { userId, points } = req.body;
    const user = await User.findByIdAndUpdate(userId, { $inc: { loyaltyPoints: points } }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, loyaltyPoints: user.loyaltyPoints });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Marketing ──────────────────────────────────
exports.getCampaigns = async (req, res) => {
  try { const campaigns = await Campaign.find({ sellerId: req.seller._id }).sort({ createdAt: -1 }); res.json({ success: true, campaigns }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createCampaign = async (req, res) => {
  try { const campaign = await Campaign.create({ sellerId: req.seller._id, ...req.body }); res.status(201).json({ success: true, campaign }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Payouts ────────────────────────────────────
exports.getPayouts = async (req, res) => {
  try {
    const payouts = await Payout.find({ sellerId: req.seller._id }).sort({ createdAt: -1 });
    const completedSettlements = await Settlement.aggregate([{ $match: { sellerId: req.seller._id, status: 'completed' } }, { $group: { _id: null, total: { $sum: '$netAmount' } } }]);
    const completedPayouts = await Payout.aggregate([{ $match: { sellerId: req.seller._id, status: { $in: ['completed', 'processing'] } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const availableBalance = (completedSettlements[0]?.total || 0) - (completedPayouts[0]?.total || 0);
    res.json({ success: true, payouts, availableBalance });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.requestPayout = async (req, res) => {
  try {
    const { amount, method } = req.body;
    if (amount < 100) return res.status(400).json({ message: 'Minimum payout is ₹100' });
    const payout = await Payout.create({ sellerId: req.seller._id, amount, method });
    res.status(201).json({ success: true, payout });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Performance ────────────────────────────────
exports.getPerformanceInsights = async (req, res) => {
  try {
    const sellerId = req.seller._id;
    const last30 = new Date(); last30.setDate(last30.getDate() - 30);
    const [orderMetrics] = await Promise.all([
      Order.aggregate([
        { $match: { sellerId, createdAt: { $gte: last30 } } },
        { $group: { _id: null, total: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } }, avgTotal: { $avg: '$total' } } },
      ]),
    ]);
    const metrics = orderMetrics[0] || {};
    res.json({ success: true, totalOrders: metrics.total || 0, deliveredOrders: metrics.delivered || 0, cancelledOrders: metrics.cancelled || 0, fulfillmentRate: metrics.total ? Math.round((metrics.delivered / metrics.total) * 100) : 0, avgOrderValue: Math.round(metrics.avgTotal || 0), rating: req.seller.rating });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const normalizeUrl = (url, fallback) => {
  if (!url) return fallback;
  if (url.startsWith('http')) return url;
  // If it's a relative path, assume it's from the bucket or server (S3 bucket is default)
  const BUCKET = process.env.AWS_S3_BUCKET || 'dabba-nation-uploads';
  const REGION = process.env.AWS_REGION || 'ap-south-1';
  if (url.startsWith('/')) return `https://${BUCKET}.s3.${REGION}.amazonaws.com${url}`;
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${url}`;
};

// ─── Profile ────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const seller = await Seller.findById(req.seller._id).populate('userId', 'name email phone').lean();
    if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });
    
    // Normalize images and add defaults
    seller.logo = normalizeUrl(seller.logo, DEFAULT_LOGO);
    seller.coverImage = normalizeUrl(seller.coverImage, DEFAULT_COVER);
    
    res.json({ success: true, ...seller });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateProfile = async (req, res) => {
  try {
    const allowed = ['businessName', 'description', 'phone', 'email', 'type', 'operatingHours', 'address', 'bankDetails', 'fssaiLicense', 'gstNumber', 'cuisines', 'tags'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const seller = await Seller.findByIdAndUpdate(req.seller._id, updates, { new: true }).lean();
    
    // Normalize images and add defaults
    seller.logo = normalizeUrl(seller.logo, DEFAULT_LOGO);
    seller.coverImage = normalizeUrl(seller.coverImage, DEFAULT_COVER);

    res.json({ success: true, ...seller });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Settings ───────────────────────────────────
exports.getNotificationPreferences = async (req, res) => {
  try {
    let prefs = await NotificationPreference.findOne({ userId: req.user._id });
    if (!prefs) prefs = await NotificationPreference.create({ userId: req.user._id });
    res.json({ success: true, ...prefs.toObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateNotificationPreferences = async (req, res) => {
  try {
    const prefs = await NotificationPreference.findOneAndUpdate({ userId: req.user._id }, req.body, { new: true, upsert: true });
    res.json({ success: true, ...prefs.toObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Current password is incorrect' });
    user.password = newPassword; // pre-save hook will hash
    await user.save();
    res.json({ success: true, message: 'Password updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/seller/profile/logo
exports.updateLogo = async (req, res) => {
  try {
    const logoUrl = req.file?.s3Url || req.file?.location || req.file?.path;
    if (!logoUrl) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    // Update user avatar and seller logo
    await User.findByIdAndUpdate(req.user._id, { avatar: logoUrl });
    
    const seller = await Seller.findOneAndUpdate({ userId: req.user._id }, { logo: logoUrl }, { new: true }).lean();
    
    // Normalize images and add defaults
    seller.logo = normalizeUrl(seller.logo, DEFAULT_LOGO);
    seller.coverImage = normalizeUrl(seller.coverImage, DEFAULT_COVER);

    res.json({ success: true, ...seller });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/seller/profile/cover
exports.updateCoverImage = async (req, res) => {
  try {
    const coverUrl = req.file?.s3Url || req.file?.location || req.file?.path;
    if (!coverUrl) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const seller = await Seller.findOneAndUpdate({ userId: req.user._id }, { coverImage: coverUrl }, { new: true }).lean();
    
    // Normalize images and add defaults
    seller.logo = normalizeUrl(seller.logo, DEFAULT_LOGO);
    seller.coverImage = normalizeUrl(seller.coverImage, DEFAULT_COVER);

    res.json({ success: true, ...seller });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Support ────────────────────────────────────
exports.createSupportTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.create({ userId: req.user._id, role: 'seller', ...req.body });
    res.status(201).json({ success: true, ticket });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user._id, role: 'seller' }).sort({ createdAt: -1 });
    res.json({ success: true, tickets });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.addTicketResponse = async (req, res) => {
  try {
    const { ticketId, message } = req.body;
    const ticket = await SupportTicket.findOneAndUpdate(
      { _id: ticketId, userId: req.user._id },
      { $push: { responses: { message, respondedBy: req.user._id } } }, { new: true }
    );
    res.json({ success: true, ticket });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Notifications ──────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, notifications });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.markNotificationRead = async (req, res) => {
  try { await Notification.findByIdAndUpdate(req.params.id, { isRead: true }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Wallet ─────────────────────────────────────
exports.getWalletTransactions = async (req, res) => {
  try {
    const transactions = await WalletTransaction.find({ sellerId: req.seller._id }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, transactions, balance: req.seller.wallet || 0 });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.withdrawFromWallet = async (req, res) => {
  try {
    const { amount } = req.body;
    if (req.seller.wallet < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    const seller = await Seller.findByIdAndUpdate(req.seller._id, { $inc: { wallet: -amount } }, { new: true });
    await WalletTransaction.create({
      sellerId: req.seller._id,
      type: 'debit',
      amount,
      description: 'Wallet withdrawal',
      referenceType: 'withdrawal',
      balance: seller.wallet,
    });
    res.json({ success: true, wallet: seller.wallet });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
