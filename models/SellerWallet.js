const mongoose = require('mongoose');

const sellerWalletSchema = new mongoose.Schema({
  seller_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, unique: true },
  
  // Balance Info
  total_earnings: { type: Number, default: 0 }, // Total from all orders/subscriptions
  pending_payout: { type: Number, default: 0 }, // Amount waiting to be paid
  paid_out: { type: Number, default: 0 }, // Total already paid
  
  // Bank Details (auto-populated from Seller model)
  bank_account_number: { type: String },
  bank_ifsc_code: { type: String },
  bank_account_holder: { type: String },
  
  // Razorpay Contact/Fund Account IDs for payouts
  razorpay_contact_id: { type: String },
  razorpay_fund_account_id: { type: String },
  
  // Payout History
  payouts: [{
    payout_id: { type: String }, // Razorpay payout ID
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    method: { type: String, enum: ['bank_transfer', 'upi'], default: 'bank_transfer' },
    utr: { type: String }, // UTR number for bank transfer
    failure_reason: { type: String },
    processed_at: { type: Date },
    created_at: { type: Date, default: Date.now }
  }],
  
  // Transaction References
  transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction' }],
  
}, { timestamps: true });

// Indexes
sellerWalletSchema.index({ seller_id: 1 });
sellerWalletSchema.index({ pending_payout: -1 });

module.exports = mongoose.models.SellerWallet || mongoose.model('SellerWallet', sellerWalletSchema);
