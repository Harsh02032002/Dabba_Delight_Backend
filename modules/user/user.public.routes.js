import express from "express";
import Product from "../product/product.model.js";
import User from "./user.model.js";

const router = express.Router();

// Public menu for customers: supports search, category, isVeg, page, limit, sellerId
router.get("/menu", async (req, res) => {
  try {
    const { search, category, isVeg, page = 1, limit = 20, sort = "-createdAt" } = req.query;
    const filter = { isArchived: false, isAvailable: true, status: "published" };
    if (req.query.sellerId) filter.sellerId = req.query.sellerId;
    if (search) filter.name = { $regex: search, $options: "i" };
    if (category && category !== "all") filter.category = category;
    if (isVeg !== undefined) filter.isVeg = isVeg === "true";

    const products = await Product.find(filter)
      .sort(sort)
      .skip((page - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    const total = await Product.countDocuments(filter);
    res.json({ success: true, products, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Public menu fetch failed", err);
    res.status(500).json({ success: false, message: "Menu fetch failed" });
  }
});

// Public sellers listing
router.get("/sellers", async (req, res) => {
  try {
    const { search, type, page = 1, limit = 20 } = req.query;
    const filter = { role: "seller" };
    if (type) filter.type = type;
    if (search) filter.$or = [{ businessName: { $regex: search, $options: "i" } }, { name: { $regex: search, $options: "i" } }];

    const sellers = await User.find(filter)
      .select("-password")
      .skip((page - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    const total = await User.countDocuments(filter);
    res.json({ success: true, sellers, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("Public sellers fetch failed", err);
    res.status(500).json({ success: false, message: "Sellers fetch failed" });
  }
});

export default router;
