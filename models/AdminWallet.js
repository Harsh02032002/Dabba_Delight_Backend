const mongoose = require('mongoose');

const adminWalletSchema = new mongoose.Schema({
  // There will be only one admin wallet document
  wallet_id: { type: String, default: 'main', unique: true },
  
  // Balance Info
  total_balance: { type: Number, default: 0 }, // Current available balance
  total_earnings: { type: Number, default: 0 }, // Lifetime earnings
  total_paid_to_sellers: { type: Number, default: 0 }, // Total paid out to sellers
  
  // Commission Settings
  commission_percentage: { type: Number, default: 15 }, // Admin commission %
  
  // Financial Summary
  stats: {
    total_orders: { type: Number, default: 0 },
    total_subscriptions: { type: Number, default: 0 },
    total_order_amount: { type: Number, default: 0 },
    total_subscription_amount: { type: Number, default: 0 },
    total_commission_earned: { type: Number, default: 0 }
  },
  
  // Monthly Breakdown
  monthly_stats: [{
    month: { type: String, required: true }, // YYYY-MM format
    year: { type: Number },
    month_num: { type: Number },
    
    // Income
    order_income: { type: Number, default: 0 },
    subscription_income: { type: Number, default: 0 },
    total_income: { type: Number, default: 0 },
    
    // Payouts
    seller_payouts: { type: Number, default: 0 },
    commission_earned: { type: Number, default: 0 },
    
    // Counts
    order_count: { type: Number, default: 0 },
    subscription_count: { type: Number, default: 0 },
    
    created_at: { type: Date, default: Date.now }
  }],
  
  // Transaction History
  transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AdminWalletTransaction' }],
  
  // Razorpay Settings
  razorpay: {
    account_balance: { type: Number, default: 0 },
    last_synced: { type: Date }
  },
  
  // Bulk Payout Queue
  bulk_payouts: [{
    payout_batch_id: { type: String },
    total_amount: { type: Number },
    seller_count: { type: Number },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    payouts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SellerWallet.payouts' }],
    created_at: { type: Date, default: Date.now },
    completed_at: { type: Date }
  }]
  
}, { timestamps: true });

module.exports = mongoose.models.AdminWallet || mongoose.model('AdminWallet', adminWalletSchema);
