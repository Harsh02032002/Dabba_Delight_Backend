const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  referenceType: { type: String, enum: ['topup', 'order', 'refund', 'withdrawal', 'subscription'] },
  balance: { type: Number, required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
  razorpaySignature: { type: String },
}, { timestamps: true });

// One wallet credit per gateway payment
walletTransactionSchema.index({ referenceType: 1, referenceId: 1 }, { unique: true, partialFilterExpression: { referenceType: 'topup', referenceId: { $type: 'string' } } });
module.exports = mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', walletTransactionSchema);
