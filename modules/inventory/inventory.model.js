import mongoose from "mongoose";

const inventorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      unique: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    stock: { type: Number, default: 0 },
    expiryDate: Date, // For perishable food
    lastUpdated: Date,
    alertThreshold: { type: Number, default: 10 },
  },
  { timestamps: true },
);

export default mongoose.model("Inventory", inventorySchema);
