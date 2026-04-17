const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    seller_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', index: true }, // Seller/restaurant this subscription is for
    plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', default: null },
    total_amount: { type: Number, required: true, min: 0 },
    remaining_amount: { type: Number, required: true, min: 0 },
    total_days: { type: Number, required: true, min: 1 },
    remaining_days: { type: Number, required: true, min: 0 },
    per_day_value: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['active', 'expired'], default: 'active', index: true },
    seller_name: { type: String }, // Denormalized seller name for quick display
    seller_type: { type: String, enum: ['home_chef', 'restaurant', 'cloud_kitchen'] },
  },
  { timestamps: true, collection: 'subscriptions' },
);

subscriptionSchema.index({ user_id: 1, status: 1 });
subscriptionSchema.index({ user_id: 1, seller_id: 1, status: 1 }); // For checking user-seller subscriptions

module.exports = mongoose.model('Subscription', subscriptionSchema);
