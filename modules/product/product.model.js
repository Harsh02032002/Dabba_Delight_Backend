import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    outletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Outlet",
      default: null,
      index: true,
    },

    // BASIC
    name: { type: String, required: true },
    description: String,
    category: { type: String, index: true },
    tags: [{ type: String, index: true }],

    // PRICING
    price: { type: Number, required: true },
    discountPrice: Number,
    costPrice: Number,

    // TIME BASED PRICING
    happyHourDiscount: {
      start: Date,
      end: Date,
      percentage: Number,
    },

    preparationTime: Number,

    // INVENTORY
    stock: { type: Number, default: 999 },
    lowStockThreshold: { type: Number, default: 5 },

    // IMAGE
    image: String,

    // STATUS
    isVeg: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ["draft", "published"],
      default: "published",
    },

    // VERSIONING
    menuVersion: { type: Number, default: 1 },

    // PERFORMANCE METRICS
    views: { type: Number, default: 0 },
    addToCartCount: { type: Number, default: 0 },
    orderCount: { type: Number, default: 0 },
    cancelCount: { type: Number, default: 0 },

    // PREVIEW SYSTEM
    previewToken: String,
    previewExpires: Date,

    // AI / OPTIMISATION FLAGS
    optimisationScore: { type: Number, default: 100 },
  },
  { timestamps: true },
);

export default mongoose.model("Product", productSchema);
