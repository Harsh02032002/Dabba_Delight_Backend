const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    total_amount: { type: Number, required: true, min: 0 },
    remaining_amount: { type: Number, required: true, min: 0 },
    total_days: { type: Number, required: true, min: 1 },
    remaining_days: { type: Number, required: true, min: 0 },
    per_day_value: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['active', 'expired'], default: 'active', index: true },
  },
  { timestamps: true, collection: 'subscriptions' },
);

subscriptionSchema.index({ user_id: 1, status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
