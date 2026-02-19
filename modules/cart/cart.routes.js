import express from "express";
import { addToCart } from "./cart.controller.js";
import { protect } from "../../middlewares/auth.middleware.js";

const router = express.Router();

// Add to cart
router.post("/", protect, addToCart);

export default router;
