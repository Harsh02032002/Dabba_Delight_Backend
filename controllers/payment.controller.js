const crypto = require('crypto');
const Order = require('../models/Order');
const { generateInvoice } = require('../services/html-invoice.service');

let razorpay;
try {
  const Razorpay = require('razorpay');
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  } else {
    console.warn('⚠️  Razorpay keys are not set; online payments are disabled');
  }
} catch (e) {
  console.error('❌ Razorpay initialization failed:', e.message);
}

let stripe;
try {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} catch (e) { console.log('Stripe not configured'); }

/** Amount still to collect online for one of the caller's orders (paise), or an error */
const loadPayableOrder = async (orderId, userId) => {
  if (!orderId) return { order: null };
  const order = await Order.findOne({ _id: orderId, userId }).catch(() => null);
  if (!order) return { error: { status: 404, message: 'Order not found' } };
  if (order.paymentStatus === 'paid') return { error: { status: 409, message: 'This order is already paid' } };
  const payable = Number(order.payableAfterSubscription ?? order.total) || 0;
  if (payable <= 0) return { error: { status: 409, message: 'Nothing left to pay on this order' } };
  return { order, amountPaise: Math.round(payable * 100) };
};

// POST /api/payment/razorpay/create-order
// With { orderId } the amount comes from the stored order (client amount ignored).
exports.createRazorpayOrder = async (req, res) => {
  try {
    if (!razorpay) return res.status(500).json({ message: 'Razorpay not configured' });
    const { amount, currency = 'INR', orderId } = req.body;

    const { order: dnOrder, amountPaise, error } = await loadPayableOrder(orderId, req.user._id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const finalPaise = dnOrder ? amountPaise : Math.round(Number(amount) * 100);
    if (!Number.isFinite(finalPaise) || finalPaise < 100) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }
    const rzpOrder = await razorpay.orders.create({
      amount: finalPaise,
      currency,
      receipt: dnOrder ? String(dnOrder.orderNumber || dnOrder._id) : `receipt_${Date.now()}`,
      notes: dnOrder ? { dnOrderId: String(dnOrder._id) } : undefined,
    });

    const razorpayKey = process.env.RAZORPAY_KEY_ID;

    res.json({
      success: true,
      key: razorpayKey,
      orderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
    });
  } catch (err) {
    console.error('Razorpay order creation error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** HMAC check of a Razorpay checkout response (exported for tests) */
const isValidRazorpaySignature = (razorpayOrderId, razorpayPaymentId, razorpaySignature, secret) => {
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpaySignature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
exports.isValidRazorpaySignature = isValidRazorpaySignature;

/** Create a Razorpay order the server controls (amount in paise) */
exports.createGatewayOrder = async ({ amountPaise, receipt, notes }) => {
  if (!razorpay) { const e = new Error('Online payments are not configured'); e.status = 503; throw e; }
  return razorpay.orders.create({ amount: amountPaise, currency: 'INR', receipt, notes });
};

/** Verify a checkout response and return the Razorpay order (with amount_paid and notes), or an error */
exports.verifyGatewayPayment = async ({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  if (!isValidRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, process.env.RAZORPAY_KEY_SECRET)) {
    return { ok: false, status: 400, message: 'Payment could not be verified' };
  }
  if (!razorpay) return { ok: false, status: 503, message: 'Online payments are not configured' };
  try {
    const order = await razorpay.orders.fetch(razorpayOrderId);
    return { ok: true, order };
  } catch (err) {
    console.error('Razorpay order lookup failed:', err.message);
    return { ok: false, status: 502, message: 'Could not confirm the payment with Razorpay. Please try again in a moment.' };
  }
};

/**
 * Confirms a Razorpay checkout response for an exact amount (signature + amount actually paid).
 * Returns { ok: true } or { ok: false, status, message }. Used for subscription purchases.
 */
exports.confirmRazorpayPayment = async ({ razorpayOrderId, razorpayPaymentId, razorpaySignature, amountPaise }) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!isValidRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, secret)) {
    return { ok: false, status: 400, message: 'Payment could not be verified' };
  }
  if (!razorpay) return { ok: false, status: 502, message: 'Payment gateway is not configured' };
  let rzpOrder;
  try {
    rzpOrder = await razorpay.orders.fetch(razorpayOrderId);
  } catch (err) {
    console.error('Razorpay order lookup failed:', err.message);
    return { ok: false, status: 502, message: 'Could not confirm the payment with Razorpay. Please try again in a moment.' };
  }
  if (Number(rzpOrder?.amount_paid) !== Number(amountPaise)) {
    return { ok: false, status: 400, message: 'Payment amount does not match this plan' };
  }
  return { ok: true };
};

// POST /api/payment/razorpay/verify
// With { orderId } a valid payment for the right amount marks that order paid.
exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = req.body;

    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!isValidRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, razorpaySecret)) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }
    if (!orderId) return res.json({ success: true, verified: true });

    const { order, amountPaise, error } = await loadPayableOrder(orderId, req.user._id);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    // The signature proves Razorpay issued this payment; the amount must match what we are owed
    let rzpOrder;
    try {
      rzpOrder = await razorpay.orders.fetch(razorpayOrderId);
    } catch (fetchErr) {
      console.error('Razorpay order lookup failed:', fetchErr.message);
      return res.status(502).json({ success: false, message: 'Could not confirm the payment with Razorpay. It will be checked again shortly.' });
    }
    if (Number(rzpOrder?.amount_paid ?? rzpOrder?.amount) !== amountPaise) {
      return res.status(400).json({ success: false, message: 'Payment amount does not match this order' });
    }

    const updated = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $ne: 'paid' } },
      { $set: { paymentStatus: 'paid', paymentId: razorpayPaymentId, paymentVerifiedAt: new Date(), paymentVerifiedBy: 'razorpay' } },
      { new: true },
    );
    res.json({ success: true, verified: true, order: updated || order });
  } catch (err) {
    console.error('Razorpay verification error:', err.message);
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
