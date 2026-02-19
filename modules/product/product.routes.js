// product.routes.js
import express from "express";
import multer from "multer";

import {
  // A – Basic CRUD
  getProducts,
  createProduct,
  updateProduct,

  // B – Status / Availability
  toggleAvailability,
  markOutOfStock,
  markInStock,

  // C – Quick Edit
  updatePrice,
  updateCategory,
  toggleVeg,

  // D – Bulk JSON
  bulkCreate,
  bulkUpdate,

  // E – CSV
  bulkCSV,

  // F – Duplicate
  duplicateProduct,

  // I – Archive / Delete
  archiveProduct,
  restoreProduct,
  hardDeleteProduct,

  // J – Image
  replaceImage,
  removeImage,

  // K – Metrics
  investorMetrics,

  // L – Smart Bulk + Happy Hour
  applySmartBulkRule,
  setHappyHourDiscount,

  // M – Menu Versioning
  switchMenuVersion,

  // N – Draft / Publish
  publishProduct,

  // O & X – AI / Optimisation
  suggestOptimisation,

  // P – Health Score
  menuHealthScore,

  // Q – Inventory
  autoStockCheck,
  getLowStockProducts,
  updateStock,
  syncInventory,

  // R – Multi-Outlet
  assignOutlet,

  // S – Performance
  getProductPerformance,

  // T – Template / Clone
  createFromTemplate,

  // U – Mass Action
  bulkAction,

  // V – Rollback (placeholder)
  rollbackLastUpdate,

  // W – Preview Link
  generatePreviewLink,

  // Y – Background Jobs (placeholder)
  startBackgroundBulkJob,

  // Z – Investor Dashboard
  getInvestorDashboard,
} from "./product.controller.js";

import { protect } from "../../middlewares/auth.middleware.js"; // your auth
import { handleImageUpload } from "../../middlewares/image.middleware.js"; // your image handler

const router = express.Router();
const upload = multer({ dest: "temp/" });

// ──────────────────────────────────────────────────────────────
// CATEGORY A — BASIC CRUD
// ──────────────────────────────────────────────────────────────
router.get("/", protect, getProducts);
router.post("/", protect, handleImageUpload, createProduct);
router.put("/:id", protect, handleImageUpload, updateProduct);
// Accept PATCH as well (frontend uses PATCH for updates)
router.patch("/:id", protect, handleImageUpload, updateProduct);

// ──────────────────────────────────────────────────────────────
// CATEGORY B — STATUS / AVAILABILITY
// ──────────────────────────────────────────────────────────────
router.patch("/:id/toggle", protect, toggleAvailability);
// Alias for frontend naming
router.patch("/:id/toggle-availability", protect, toggleAvailability);
router.patch("/:id/out-of-stock", protect, markOutOfStock);
router.patch("/:id/in-stock", protect, markInStock);

// ──────────────────────────────────────────────────────────────
// CATEGORY C — QUICK EDIT
// ──────────────────────────────────────────────────────────────
router.patch("/:id/price", protect, updatePrice);
router.patch("/:id/category", protect, updateCategory);
router.patch("/:id/veg-toggle", protect, toggleVeg);
// Frontend may call toggle-veg
router.patch("/:id/toggle-veg", protect, toggleVeg);

// ──────────────────────────────────────────────────────────────
// CATEGORY D — BULK JSON
// ──────────────────────────────────────────────────────────────
router.post("/bulk/create", protect, bulkCreate);
router.put("/bulk/update", protect, bulkUpdate);

// ──────────────────────────────────────────────────────────────
// CATEGORY E — CSV BULK
// ──────────────────────────────────────────────────────────────
router.post("/bulk/csv", protect, upload.single("file"), bulkCSV);

// ──────────────────────────────────────────────────────────────
// CATEGORY F — DUPLICATE
// ──────────────────────────────────────────────────────────────
router.post("/:id/duplicate", protect, duplicateProduct);

// ──────────────────────────────────────────────────────────────
// CATEGORY I — ARCHIVE / DELETE
// ──────────────────────────────────────────────────────────────
router.patch("/:id/archive", protect, archiveProduct);
router.patch("/:id/restore", protect, restoreProduct);
router.delete("/:id", protect, hardDeleteProduct);
// Frontend sometimes calls hard-delete path
router.delete("/:id/hard-delete", protect, hardDeleteProduct);

// ──────────────────────────────────────────────────────────────
// CATEGORY J — IMAGE OPERATIONS
// ──────────────────────────────────────────────────────────────
router.patch("/:id/image", protect, handleImageUpload, replaceImage);
// Frontend uses /image/replace in some places
router.patch("/:id/image/replace", protect, handleImageUpload, replaceImage);
router.delete("/:id/image", protect, removeImage);

// ──────────────────────────────────────────────────────────────
// CATEGORY K — METRICS
// ──────────────────────────────────────────────────────────────
router.get("/metrics", protect, investorMetrics);

// ──────────────────────────────────────────────────────────────
// CATEGORY L — SMART BULK + HAPPY HOUR
// ──────────────────────────────────────────────────────────────
router.post("/bulk/smart-rule", protect, applySmartBulkRule);
router.patch("/happy-hour", protect, setHappyHourDiscount); // or /:id/happy-hour if per product

// ──────────────────────────────────────────────────────────────
// CATEGORY M — MENU VERSIONING
// ──────────────────────────────────────────────────────────────
router.patch("/menu-version", protect, switchMenuVersion);

// ──────────────────────────────────────────────────────────────
// CATEGORY N — DRAFT / PUBLISH
// ──────────────────────────────────────────────────────────────
router.patch("/:id/publish", protect, publishProduct);

// ──────────────────────────────────────────────────────────────
// CATEGORY O & X — AI OPTIMISATION SUGGESTIONS
// ──────────────────────────────────────────────────────────────
router.get("/optimise-suggestions", protect, suggestOptimisation);

// ──────────────────────────────────────────────────────────────
// CATEGORY P — MENU HEALTH SCORE
// ──────────────────────────────────────────────────────────────
router.get("/health-score", protect, menuHealthScore);

// ──────────────────────────────────────────────────────────────
// CATEGORY Q — INVENTORY SMARTNESS
// ──────────────────────────────────────────────────────────────
router.post("/inventory/auto-check", protect, autoStockCheck);
router.get("/inventory/low-stock", protect, getLowStockProducts);
router.patch("/:id/stock", protect, updateStock);
router.post("/inventory/sync", protect, syncInventory);

// ──────────────────────────────────────────────────────────────
// CATEGORY R — MULTI-OUTLET
// ──────────────────────────────────────────────────────────────
router.patch("/:id/outlet", protect, assignOutlet);

// ──────────────────────────────────────────────────────────────
// CATEGORY S — PRODUCT PERFORMANCE
// ──────────────────────────────────────────────────────────────
router.get("/:id/performance", protect, getProductPerformance);

// ──────────────────────────────────────────────────────────────
// CATEGORY T — TEMPLATE / CLONE
// ──────────────────────────────────────────────────────────────
router.post("/from-template", protect, createFromTemplate);

// ──────────────────────────────────────────────────────────────
// CATEGORY U — MASS ACTION BAR
// ──────────────────────────────────────────────────────────────
router.post("/bulk/action", protect, bulkAction);

// ──────────────────────────────────────────────────────────────
// CATEGORY V — ROLLBACK (placeholder)
// ──────────────────────────────────────────────────────────────
router.post("/rollback", protect, rollbackLastUpdate);

// ──────────────────────────────────────────────────────────────
// CATEGORY W — MENU PREVIEW LINK
// ──────────────────────────────────────────────────────────────
router.post("/preview-link", protect, generatePreviewLink);

// ──────────────────────────────────────────────────────────────
// CATEGORY Y — BACKGROUND JOBS (placeholder)
// ──────────────────────────────────────────────────────────────
router.post("/bulk/background", protect, startBackgroundBulkJob);

// ──────────────────────────────────────────────────────────────
// CATEGORY Z — INVESTOR DASHBOARD
// ──────────────────────────────────────────────────────────────
router.get("/investor-dashboard", protect, getInvestorDashboard);

export default router;
