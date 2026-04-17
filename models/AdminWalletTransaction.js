const mongoose = require('mongoose');

const adminWalletTransactionSchema = new mongoose.Schema({
  // Transaction Type
  type: { 
    type: String, 
    enum: ['order_payment', 'subscription_payment', 'seller_payout', 'commission', 'refund', 'adjustment'], 
    required: true 
  },
  
  // Amount Details
  amount: { type: Number, required: true }, // Total amount
  admin_commission: { type: Number, default: 0 }, // Admin's cut
  seller_amount: { type: Number, default: 0 }, // Seller's cut
  
  // References
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  subscription_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  seller_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
  seller_wallet_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SellerWallet' },
  
  // Transaction Details
  description: { type: String, required: true },
  payment_method: { type: String, enum: ['razorpay', 'subscription', 'wallet', 'bank_transfer', 'upi'] },
  
  // Razorpay Details
  razorpay_order_id: { type: String },
  razorpay_payment_id: { type: String },
  razorpay_payout_id: { type: String }, // For seller payouts
  
  // Running Balance
  balance_after: { type: Number, required: true },
  
  // Status
  status: { type: String, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'completed' },
  
  // Metadata
  metadata: {
    order_number: { type: String },
    subscription_plan: { type: String },
    items_count: { type: Number },
    commission_rate: { type: Number }
  },
  
  // For seller payouts
  payout_details: {
    bank_account: { type: String },
    ifsc_code: { type: String },
    utr_number: { type: String },
    processed_at: { type: Date }
  }
  
}, { timestamps: true });

// Indexes
adminWalletTransactionSchema.index({ type: 1, createdAt: -1 });
adminWalletTransactionSchema.index({ seller_id: 1, createdAt: -1 });
adminWalletTransactionSchema.index({ order_id: 1 });
adminWalletTransactionSchema.index({ subscription_id: 1 });
adminWalletTransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.models.AdminWalletTransaction || mongoose.model('AdminWalletTransaction', adminWalletTransactionSchema);
