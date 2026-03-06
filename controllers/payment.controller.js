const crypto = require('crypto');
const Order = require('../models/Order');
const { generateInvoice } = require('../services/invoice.service');

let razorpay;
try {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
} catch (e) { console.log('Razorpay not configured'); }

let stripe;
try {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} catch (e) { console.log('Stripe not configured'); }

// POST /api/payment/razorpay/create-order
exports.createRazorpayOrder = async (req, res) => {
  try {
    if (!razorpay) return res.status(500).json({ message: 'Razorpay not configured' });
    const { amount, currency = 'INR' } = req.body;
    const order = await razorpay.orders.create({ amount: Math.round(amount * 100), currency, receipt: `receipt_${Date.now()}` });
    res.json({ success: true, key: process.env.RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/payment/razorpay/verify
exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const sign = razorpayOrderId + '|' + razorpayPaymentId;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(sign).digest('hex');
    if (expected !== razorpaySignature) return res.status(400).json({ success: false, message: 'Invalid signature' });
    res.json({ success: true, verified: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/payment/stripe/create-intent
exports.createStripeIntent = async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ message: 'Stripe not configured' });
    const { amount, currency = 'inr' } = req.body;
    const intent = await stripe.paymentIntents.create({ amount: Math.round(amount * 100), currency });
    res.json({ success: true, clientSecret: intent.client_secret });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
