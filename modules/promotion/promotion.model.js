import mongoose from "mongoose";

const promotionSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    code: { type: String, unique: true, required: true },
    type: { type: String, enum: ["percentage", "fixed", "bogo"] }, // Buy one get one
    value: Number, // e.g., 20 for 20%
    minOrderAmount: Number,
    maxDiscount: Number,
    startDate: Date,
    endDate: Date,
    usageLimit: Number,
    usedCount: { type: Number, default: 0 },
    applicableProducts: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export default mongoose.model("Promotion", promotionSchema);
