const Subscription = require('../models/Subscription');
const SubscriptionUsage = require('../models/SubscriptionUsage');
const subscriptionService = require('../services/subscription.service');

exports.getActiveForUser = async (req, res) => {
  try {
    const subscription = await subscriptionService.getActiveSubscription(req.user._id);
    res.json({ success: true, subscription });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.purchase = async (req, res) => {
  try {
    const { totalAmount, totalDays } = req.body;
    const subscription = await subscriptionService.createSubscriptionPurchase(req.user._id, {
      totalAmount: Number(totalAmount),
      totalDays: Number(totalDays),
    });
    res.status(201).json({ success: true, subscription });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.adminListSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find()
      .sort({ createdAt: -1 })
      .limit(300)
      .populate('user_id', 'name email phone');
    res.json({ success: true, subscriptions });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.adminListUsage = async (req, res) => {
  try {
    const usage = await SubscriptionUsage.find()
      .sort({ date: -1 })
      .limit(500)
      .populate('user_id', 'name email')
      .populate('order_id', 'orderNumber total status');
    res.json({ success: true, usage });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
