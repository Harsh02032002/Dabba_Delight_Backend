const mongoose = require('mongoose');

const subscriptionUsageSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    amount_used: { type: Number, required: true, min: 0 },
    days_used: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: 'subscription_usages' },
);

module.exports = mongoose.model('SubscriptionUsage', subscriptionUsageSchema);
