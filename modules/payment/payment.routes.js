import express from "express";
import { protect } from "../../middlewares/auth.middleware.js";
import {
  createStripePaymentIntent,
  confirmStripePayment,
  createRazorpayOrder,
  verifyRazorpayPayment,
  getOrders,
  getOrderDetail,
} from "./payment.controller.js";

const router = express.Router();

// Stripe routes
router.post("/stripe/create-intent", protect, createStripePaymentIntent);
router.post("/stripe/confirm", protect, confirmStripePayment);

// Razorpay routes
router.post("/razorpay/create-order", protect, createRazorpayOrder);
router.post("/razorpay/verify", protect, verifyRazorpayPayment);

// Orders
router.get("/orders", protect, getOrders);
router.get("/orders/:id", protect, getOrderDetail);

export default router;
