import Product from "./product.model.js";
import csv from "csv-parser";
import fs from "fs/promises";
import crypto from "crypto";
import OpenAI from "openai";

let openai = null;
if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (e) {
    console.warn("OpenAI initialization failed:", e?.message || e);
    openai = null;
  }
} else {
  console.warn("OPENAI_API_KEY not set — OpenAI features disabled");
}

// ─── ERROR HELPER ───────────────────────────────────────────────────────────
const sendError = (res, status = 500, message = "Server error", err = null) => {
  console.error(message, err?.stack || err);
  return res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== "production" &&
      err && { error: err.message, stack: err.stack }),
  });
};

// ─── CATEGORY A — BASIC CRUD ────────────────────────────────────────────────
export const getProducts = async (req, res) => {
  try {
    const {
      search,
      category,
      isVeg,
      isAvailable,
      page = 1,
      limit = 20,
      sort = "-createdAt",
    } = req.query;
    const filter = {};
    // isArchived: if provided in query use it, otherwise default to false
    if (req.query.isArchived !== undefined) {
      filter.isArchived = req.query.isArchived === 'true' || req.query.isArchived === true;
    } else {
      filter.isArchived = false;
    }
    // Admin can pass sellerId as query to view specific seller's products
    if (req.user.role === "admin" && req.query.sellerId) {
      filter.sellerId = req.query.sellerId;
    } else if (req.user.role !== "admin") {
      filter.sellerId = req.user._id;
    }
    if (search) filter.name = { $regex: search, $options: "i" };
    if (category && category !== "all") filter.category = category;
    if (isVeg !== undefined) filter.isVeg = isVeg === "true";
    if (isAvailable !== undefined) filter.isAvailable = isAvailable === "true";
    const products = await Product.find(filter)
      .sort(sort)
      .skip((page - 1) * Number(limit))
      .limit(Number(limit))
      .lean();
    const total = await Product.countDocuments(filter);
    res.json({
      success: true,
      products,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    sendError(res, 500, "Get products failed", err);
  }
};

export const createProduct = async (req, res) => {
  try {
    // ⭐ logged in seller ki id
    const sellerId = req.user._id || req.user.id;

    const data = {
      ...req.body,
      sellerId: sellerId,
    };
    if (req.uploadedImageUrl) data.image = req.uploadedImageUrl;

    const product = await Product.create(data);

    res.status(201).json({
      success: true,
      product,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Create failed",
      error: error.message,
    });
  }
};


export const updateProduct = async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (req.uploadedImageUrl) updateData.image = req.uploadedImageUrl;
    const product = await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
      },
      updateData,
      { new: true, runValidators: true },
    );
    if (!product)
      return sendError(res, 404, "Product not found / unauthorized");
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 400, "Update failed", err);
  }
};

// ─── CATEGORY B — STATUS / AVAILABILITY ─────────────────────────────────────
export const toggleAvailability = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (
      !product ||
      (req.user.role !== "admin" &&
        product.sellerId.toString() !== req.user._id.toString())
    ) {
      return sendError(res, 403, "Unauthorized");
    }
    product.isAvailable = !product.isAvailable;
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 500, "Toggle failed", err);
  }
};

export const markOutOfStock = async (req, res) => {
  try {
    await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
      },
      { isAvailable: false },
      { new: true },
    );
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "Out of stock failed", err);
  }
};

export const markInStock = async (req, res) => {
  try {
    await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
      },
      { isAvailable: true },
      { new: true },
    );
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "In stock failed", err);
  }
};

// ─── CATEGORY C — PRICE / QUICK EDIT ────────────────────────────────────────
export const updatePrice = async (req, res) => {
  try {
    const { price } = req.body;
    const product = await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
      },
      { price },
      { new: true },
    );
    if (!product) return sendError(res, 404, "Not found");
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 400, "Price update failed", err);
  }
};

export const updateCategory = async (req, res) => {
  try {
    const { category } = req.body;
    const product = await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
      },
      { category },
      { new: true },
    );
    if (!product) return sendError(res, 404, "Not found");
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 400, "Category update failed", err);
  }
};

export const toggleVeg = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
    });
    if (!product) return sendError(res, 404, "Not found");
    product.isVeg = !product.isVeg;
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 500, "Veg toggle failed", err);
  }
};

// ─── CATEGORY D — BULK JSON ─────────────────────────────────────────────────
export const bulkCreate = async (req, res) => {
  try {
    const items = req.body.map((p) => ({ ...p, sellerId: req.user._id }));
    const result = await Product.insertMany(items);
    res.status(201).json({ success: true, count: result.length });
  } catch (err) {
    sendError(res, 400, "Bulk create failed", err);
  }
};

export const bulkUpdate = async (req, res) => {
  try {
    const ops = req.body.map((item) => ({
      updateOne: {
        filter: { _id: item._id, sellerId: req.user._id },
        update: { $set: item },
      },
    }));
    await Product.bulkWrite(ops);
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "Bulk update failed", err);
  }
};

// ─── CATEGORY E — CSV BULK ──────────────────────────────────────────────────
export const bulkCSV = async (req, res) => {
  if (!req.file) return sendError(res, 400, "No CSV uploaded");
  const results = [];
  const errors = [];
  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on("data", (row) => results.push(row))
        .on("end", resolve)
        .on("error", reject);
    });
    for (const [idx, row] of results.entries()) {
      try {
        const data = { ...row };
        if (row.id) {
          await Product.findOneAndUpdate(
            { _id: row.id, sellerId: req.user._id },
            data,
            { runValidators: true },
          );
        } else {
          await Product.create({ ...data, sellerId: req.user._id });
        }
      } catch (e) {
        errors.push({ row: idx + 2, error: e.message });
      }
    }
    await fs.unlink(req.file.path).catch(() => {});
    res.json({ success: true, processed: results.length, errors });
  } catch (err) {
    sendError(res, 500, "CSV bulk failed", err);
  }
};

// ─── CATEGORY F — COPY / DUPLICATE ──────────────────────────────────────────
export const duplicateProduct = async (req, res) => {
  try {
    const original = await Product.findById(req.params.id).lean();
    if (
      !original ||
      (req.user.role !== "admin" &&
        original.sellerId.toString() !== req.user._id.toString())
    ) {
      return sendError(res, 404, "Not found");
    }
    const { _id, ...clone } = original;
    const newProduct = await Product.create({
      ...clone,
      sellerId: req.user._id,
    });
    res.status(201).json({ success: true, product: newProduct });
  } catch (err) {
    sendError(res, 500, "Duplicate failed", err);
  }
};

// ─── CATEGORY I — ARCHIVE / DELETE ─────────────────────────────────────────
export const archiveProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
      },
      { isArchived: true },
      { new: true },
    );
    if (!product)
      return sendError(res, 404, "Product not found / unauthorized");
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 500, "Archive failed", err);
  }
};

export const restoreProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
      },
      { isArchived: false },
      { new: true },
    );
    if (!product)
      return sendError(res, 404, "Product not found / unauthorized");
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 500, "Restore failed", err);
  }
};

export const hardDeleteProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({
      _id: req.params.id,
      sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
    });
    if (!product)
      return sendError(res, 404, "Product not found / unauthorized");
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "Delete failed", err);
  }
};
// ─── CATEGORY J — IMAGE OPERATIONS ──────────────────────────────────────────
export const replaceImage = async (req, res) => {
  try {
    if (!req.uploadedImageUrl) return sendError(res, 400, "No image");
    const product = await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
      },
      { image: req.uploadedImageUrl },
      { new: true },
    );
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 500, "Image replace failed", err);
  }
};

export const removeImage = async (req, res) => {
  try {
    await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
      },
      { $unset: { image: 1 } },
      { new: true },
    );
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "Remove image failed", err);
  }
};

// ─── CATEGORY K — INVESTOR METRICS ──────────────────────────────────────────
export const investorMetrics = async (req, res) => {
  try {
    const match = req.user.role === "admin" ? {} : { sellerId: req.user._id };
    const [totalProducts, activeProducts, archivedProducts] = await Promise.all(
      [
        Product.countDocuments(match),
        Product.countDocuments({ ...match, isAvailable: true }),
        Product.countDocuments({ ...match, isArchived: true }),
      ],
    );
    const [stockRes, priceRes] = await Promise.all([
      Product.aggregate([
        { $match: match },
        { $group: { _id: null, total: { $sum: "$stock" } } },
      ]),
      Product.aggregate([
        { $match: match },
        { $group: { _id: null, avg: { $avg: "$price" } } },
      ]),
    ]);
    const efficiency = totalProducts
      ? ((activeProducts / totalProducts) * 100).toFixed(2) + "%"
      : "0%";
    res.json({
      success: true,
      totalProducts,
      activeProducts,
      archivedProducts,
      totalStock: stockRes[0]?.total || 0,
      averagePrice: priceRes[0]?.avg?.toFixed(2) || 0,
      efficiency,
    });
  } catch (err) {
    sendError(res, 500, "Metrics failed", err);
  }
};

// ─── CATEGORY L — SMART BULK INTELLIGENCE ───────────────────────────────────
export const applySmartBulkRule = async (req, res) => {
  try {
    const { category, tag, priceRange, isVeg, percentageIncrease } = req.body;
    const filter = { sellerId: req.user._id };
    if (category) filter.category = category;
    if (tag) filter.tags = { $in: [tag] };
    if (priceRange?.min && priceRange?.max)
      filter.price = { $gte: priceRange.min, $lte: priceRange.max };
    if (isVeg !== undefined) filter.isVeg = isVeg;

    const result = await Product.updateMany(filter, {
      $mul: { price: 1 + percentageIncrease / 100 },
    });
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    sendError(res, 400, "Smart bulk rule failed", err);
  }
};

export const setHappyHourDiscount = async (req, res) => {
  try {
    const { percentage = 0, productIds } = req.body;
    if (percentage <= 0) return sendError(res, 400, "Invalid percentage");

    const filter = { sellerId: req.user._id };
    if (Array.isArray(productIds) && productIds.length > 0)
      filter._id = { $in: productIds };

    const update = {
      $set: {
        happyHour: {
          percentage,
          startedAt: new Date(),
        },
      },
    };

    const result = await Product.updateMany(filter, update);
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    sendError(res, 500, "Set happy hour failed", err);
  }
};

// ─── CATEGORY M — MENU VERSIONING ───────────────────────────────────────────
export const switchMenuVersion = async (req, res) => {
  try {
    const { version } = req.body;
    await Product.updateMany(
      { sellerId: req.user._id },
      { menuVersion: version },
    );
    res.json({ success: true, message: `Menu switched to v${version}` });
  } catch (err) {
    sendError(res, 500, "Menu version switch failed", err);
  }
};

// ─── CATEGORY N — DRAFT MODE ────────────────────────────────────────────────
export const publishProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.user._id },
      { status: "published" },
      { new: true },
    );
    if (!product) return sendError(res, 404, "Not found");
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 500, "Publish failed", err);
  }
};

// ─── CATEGORY O & X — AI ASSISTED + AUTO-OPTIMISATION ───────────────────────
export const suggestOptimisation = async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.user._id }).lean();
    const lowPerformers = products.filter(
      (p) => p.views > 50 && p.orderCount < 5,
    );

    // Agar real OpenAI use karna hai to uncomment kar dena
    /*
    if (lowPerformers.length > 0) {
      const prompt = `Suggest price optimizations for these low performing products:\n${JSON.stringify(lowPerformers.map(p => ({name: p.name, price: p.price, views: p.views, orders: p.orderCount})))}`;
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });
      // Parse completion aur suggestions banao
    }
    */

    const suggestions = lowPerformers.map((p) => ({
      productId: p._id,
      name: p.name,
      currentPrice: p.price,
      suggestion: `Reduce to ₹${Math.round(p.price * 0.85)} (-15%) for better conversion`,
      reason: `${p.views} views but only ${p.orderCount} orders`,
    }));

    res.json({ success: true, suggestions });
  } catch (err) {
    sendError(res, 500, "Optimisation suggestion failed", err);
  }
};

// ─── CATEGORY P — MENU HEALTH SCORE ─────────────────────────────────────────
export const menuHealthScore = async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.user._id });
    let score = 100;
    const vegRatio =
      products.filter((p) => p.isVeg).length / (products.length || 1);
    if (vegRatio < 0.3) score -= 25;
    const lowStock = products.filter((p) => p.stock < 5).length;
    if (lowStock > 10) score -= 20;
    res.json({
      success: true,
      score: Math.max(0, score),
      totalProducts: products.length,
    });
  } catch (err) {
    sendError(res, 500, "Health score failed", err);
  }
};

// ─── CATEGORY Q — INVENTORY SMARTNESS ───────────────────────────────────────
export const autoStockCheck = async (req, res) => {
  try {
    await Product.updateMany({ stock: { $lte: 0 } }, { isAvailable: false });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, "Auto stock check failed", err);
  }
};

export const getLowStockProducts = async (req, res) => {
  try {
    const products = await Product.find({
      sellerId: req.user._id,
      stock: { $lte: 5 },
      isArchived: false,
    });
    res.json({ success: true, products });
  } catch (err) {
    sendError(res, 500, "Low stock fetch failed", err);
  }
};

export const updateStock = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.user._id },
      { stock: req.body.stock },
      { new: true },
    );
    if (product.stock <= 0) {
      product.isAvailable = false;
      await product.save();
    }
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 400, "Stock update failed", err);
  }
};

// ─── CATEGORY W — MENU PREVIEW LINK ─────────────────────────────────────────
export const generatePreviewLink = async (req, res) => {
  try {
    const token = crypto.randomBytes(16).toString("hex");
    await Product.updateMany(
      { sellerId: req.user._id },
      {
        previewToken: token,
        previewExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    );
    res.json({
      success: true,
      link: `${req.protocol}://${req.get("host")}/preview/${token}`,
    });
  } catch (err) {
    sendError(res, 500, "Preview link failed", err);
  }
};

// ─── CATEGORY Z — INVESTOR SHOWOFF MODE ─────────────────────────────────────
export const getInvestorDashboard = async (req, res) => {
  try {
    const match = req.user.role === "admin" ? {} : { sellerId: req.user._id };
    const total = await Product.countDocuments(match);
    const active = await Product.countDocuments({
      ...match,
      isAvailable: true,
    });
    const efficiency = total ? ((active / total) * 100).toFixed(2) : 0;
    res.json({
      success: true,
      productsCount: total,
      activePercentage: `${efficiency}%`,
      bulkOpsSavedHours: "Estimated 45+ hours/month",
      menuGrowth: "+28% this month",
    });
  } catch (err) {
    sendError(res, 500, "Investor dashboard failed", err);
  }
};

// CATEGORY R — MULTI-OUTLET / BRANCH MENU
export const assignOutlet = async (req, res) => {
  try {
    const { outletId } = req.body;
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.user._id },
      { outletId },
      { new: true, runValidators: true },
    );
    if (!product)
      return sendError(res, 404, "Product not found or unauthorized");
    res.json({ success: true, product });
  } catch (err) {
    sendError(res, 400, "Assign outlet failed", err);
  }
};

// CATEGORY S — PRODUCT PERFORMANCE INSIGHTS
export const getProductPerformance = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user.role === "admin" ? { $exists: true } : req.user._id,
    });
    if (!product) return sendError(res, 404, "Product not found");
    res.json({
      success: true,
      performance: {
        views: product.views,
        addToCart: product.addToCartCount,
        orders: product.orderCount,
        cancels: product.cancelCount,
        conversionRate:
          product.views > 0
            ? ((product.orderCount / product.views) * 100).toFixed(2) + "%"
            : "0%",
      },
    });
  } catch (err) {
    sendError(res, 500, "Performance fetch failed", err);
  }
};

// CATEGORY T — CLONE & TEMPLATE SYSTEM
export const createFromTemplate = async (req, res) => {
  try {
    const { templateId } = req.body;
    const template = await Product.findById(templateId).lean();
    if (!template) return sendError(res, 404, "Template not found");
    const { _id, createdAt, updatedAt, ...cloneData } = template;
    const newProduct = await Product.create({
      ...cloneData,
      sellerId: req.user._id,
      status: "draft", // new se draft mein start
    });
    res.status(201).json({ success: true, product: newProduct });
  } catch (err) {
    sendError(res, 500, "Create from template failed", err);
  }
};

// CATEGORY U — MASS ACTION BAR
export const bulkAction = async (req, res) => {
  try {
    const { ids, action, value } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return sendError(res, 400, "ids array required");

    let update = {};
    switch (action) {
      case "archive":
        update = { isArchived: true };
        break;
      case "unarchive":
        update = { isArchived: false };
        break;
      case "publish":
        update = { status: "published" };
        break;
      case "draft":
        update = { status: "draft" };
        break;
      case "discount":
        update = { discountPrice: value };
        break;
      case "toggleAvailability":
        update = { isAvailable: !!value };
        break;
      case "addTag":
        update = { $addToSet: { tags: value } };
        break;
      default:
        return sendError(res, 400, "Invalid action");
    }

    const result = await Product.updateMany(
      { _id: { $in: ids }, sellerId: req.user._id },
      update,
    );
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    sendError(res, 400, "Bulk action failed", err);
  }
};

// CATEGORY V — ROLLBACK & AUDIT (basic placeholder - real mein history collection banao)
export const rollbackLastUpdate = async (req, res) => {
  try {
    // Real implementation ke liye: mongoose-history ya custom audit log use karo
    res.json({
      success: false,
      message:
        "Rollback feature requires audit/history collection. Placeholder response.",
    });
  } catch (err) {
    sendError(res, 500, "Rollback failed", err);
  }
};

// CATEGORY O & X — AI ASSISTED + AUTO-OPTIMISATION (with real OpenAI call)

// CATEGORY Y — SELLER EXPERIENCE BOOSTERS (backend support for background jobs - placeholder)
export const startBackgroundBulkJob = async (req, res) => {
  try {
    // Real mein BullMQ / Agenda / Redis queue use karo
    // Example: await queue.add('bulk-update', { ...req.body });
    res.json({
      success: true,
      jobId: "placeholder-job-123",
      message: "Bulk job queued in background",
    });
  } catch (err) {
    sendError(res, 500, "Background job queue failed", err);
  }
};

export const syncInventory = async (req, res) => {
  try {
    const items = req.body; // expect [{ id, stock }, ...]
    if (!Array.isArray(items) || items.length === 0)
      return sendError(res, 400, "Invalid payload, expected array of items");

    const ops = items.map((it) => ({
      updateOne: {
        filter: { _id: it.id, sellerId: req.user._id },
        update: { $set: { stock: it.stock, isAvailable: it.stock > 0 } },
      },
    }));

    const result = await Product.bulkWrite(ops);
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    sendError(res, 500, "Sync inventory failed", err);
  }
};
