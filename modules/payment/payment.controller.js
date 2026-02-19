import Stripe from "stripe";
import Razorpay from "razorpay";
import Order from "../order/order.model.js";
import User from "../user/user.model.js";
import Notification from "../notification/notification.model.js";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
  : null;

const sendError = (res, status = 500, message = "Server error", err = null) => {
  console.error(message, err);
  res.status(status).json({ success: false, message, error: err?.message });
};

// STRIPE: Create payment intent
export const createStripePaymentIntent = async (req, res) => {
  try {
    if (!stripe) {
      return sendError(res, 400, "Stripe not configured");
    }

    const { amount, currency = "inr", orderId, description } = req.body;
    const userId = req.user._id;

    if (!amount || amount <= 0) {
      return sendError(res, 400, "Invalid amount");
    }

    // Create payment intent (amount is in cents for USD; in paise for INR)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to paisa/cents
      currency: currency.toLowerCase(),
      metadata: { userId, orderId, description },
      description,
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    sendError(res, 500, "Failed to create payment intent", err);
  }
};

// STRIPE: Confirm payment and create order
export const confirmStripePayment = async (req, res) => {
  try {
    if (!stripe) {
      return sendError(res, 400, "Stripe not configured");
    }

    const { paymentIntentId, orderId, cartItems, totalAmount, deliveryAddress } = req.body;
    const userId = req.user._id;

    // Verify payment intent with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return sendError(res, 400, "Payment not successful");
    }

    // Create order in DB
    const order = await Order.create({
      userId,
      orderId: orderId || `ORDER-${Date.now()}`,
      items: cartItems,
      totalAmount,
      deliveryAddress,
      paymentMethod: "stripe",
      paymentId: paymentIntentId,
      status: "confirmed",
      createdAt: new Date(),
    });

    // Create notification
    await Notification.create({
      userId,
      type: "order",
      message: `Order ${order.orderId} placed successfully!`,
      data: { orderId: order._id },
    });

    res.json({ success: true, order: order.toJSON() });
  } catch (err) {
    sendError(res, 500, "Failed to confirm payment", err);
  }
};

// RAZORPAY: Create order
export const createRazorpayOrder = async (req, res) => {
  try {
    if (!razorpay) {
      return sendError(res, 400, "Razorpay not configured");
    }

    const { amount, currency = "INR", orderId, description } = req.body;
    const userId = req.user._id;

    if (!amount || amount <= 0) {
      return sendError(res, 400, "Invalid amount");
    }

    // Create Razorpay order (amount is in paise)
    const options = {
      amount: Math.round(amount * 100), // Convert to paise
      currency: currency.toUpperCase(),
      receipt: orderId || `rcpt_${Date.now()}`,
      notes: { userId, orderId, description },
    };

    const razorpayOrder = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    sendError(res, 500, "Failed to create Razorpay order", err);
  }
};

// RAZORPAY: Verify payment and create order
export const verifyRazorpayPayment = async (req, res) => {
  try {
    if (!razorpay) {
      return sendError(res, 400, "Razorpay not configured");
    }

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, cartItems, totalAmount, deliveryAddress } = req.body;
    const userId = req.user._id;

    // Verify signature (security check)
    const crypto = await import("crypto");
    const hmac = crypto.default
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (hmac !== razorpaySignature) {
      return sendError(res, 400, "Invalid payment signature");
    }

    // Create order in DB
    const order = await Order.create({
      userId,
      orderId: `ORDER-${Date.now()}`,
      items: cartItems,
      totalAmount,
      deliveryAddress,
      paymentMethod: "razorpay",
      paymentId: razorpayPaymentId,
      razorpayOrderId,
      status: "confirmed",
      createdAt: new Date(),
    });

    // Create notification
    await Notification.create({
      userId,
      type: "order",
      message: `Order ${order.orderId} placed successfully!`,
      data: { orderId: order._id },
    });

    res.json({ success: true, order: order.toJSON() });
  } catch (err) {
    sendError(res, 500, "Failed to verify payment", err);
  }
};

// Get order history
export const getOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    sendError(res, 500, "Failed to fetch orders", err);
  }
};

// Get order detail
export const getOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, userId: req.user._id });
    if (!order) {
      return sendError(res, 404, "Order not found");
    }
    res.json({ success: true, order });
  } catch (err) {
    sendError(res, 500, "Failed to fetch order", err);
  }
};
