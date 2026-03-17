const crypto = require('crypto');
const Order = require('../models/Order');
const { generateInvoice } = require('../services/html-invoice.service');

let razorpay;
try {
  const Razorpay = require('razorpay');
  
  // Check if credentials are available
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  
  console.log('🔧 Razorpay Configuration Check:');
  console.log('RAZORPAY_KEY_ID defined:', !!keyId);
  console.log('RAZORPAY_KEY_SECRET defined:', !!keySecret);
  console.log('RAZORPAY_KEY_ID length:', keyId?.length || 0);
  console.log('RAZORPAY_KEY_SECRET length:', keySecret?.length || 0);
  
  // Use environment variables or fallback
  const razorpayKeyId = keyId || 'rzp_test_RDG5JVvoKELSk0';
  const razorpayKeySecret = keySecret || 'N5tamdzyBKMT2E1M2TVR01PT';
  
  console.log('🔑 Using Razorpay Key ID:', razorpayKeyId.substring(0, 10) + '...');
  console.log('🔑 Using Razorpay Secret (length):', razorpayKeySecret.length);
  
  razorpay = new Razorpay({ 
    key_id: razorpayKeyId, 
    key_secret: razorpayKeySecret 
  });
  
  if (!keyId || !keySecret) {
    console.log('⚠️  Using fallback Razorpay credentials');
  } else {
    console.log('✅ Razorpay initialized with environment credentials');
  }
} catch (e) { 
  console.error('❌ Razorpay initialization failed:', e.message);
}

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
    
    // Use environment key or fallback
    const razorpayKey = process.env.RAZORPAY_KEY_ID || 'rzp_test_RDG5JVvoKELSk0';
    
    res.json({ 
      success: true, 
      key: razorpayKey, 
      orderId: order.id, 
      amount: order.amount, 
      currency: order.currency 
    });
  } catch (err) {
    console.error('Razorpay order creation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/payment/razorpay/verify
exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const sign = razorpayOrderId + '|' + razorpayPaymentId;
    
    // Use environment secret or fallback
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET || 'N5tamdzyBKMT2E1M2TVR01PT';
    
    const expected = crypto.createHmac('sha256', razorpaySecret).update(sign).digest('hex');
    if (expected !== razorpaySignature) return res.status(400).json({ success: false, message: 'Invalid signature' });
    res.json({ success: true, verified: true });
  } catch (err) {
    console.error('Razorpay verification error:', err);
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
