import mongoose from "mongoose";

const settlementSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" }, // Linked to order if per-order
    orderAmount: Number,
    commission: Number,
    gst: Number,
    netAmount: Number,
    status: {
      type: String,
      enum: ["pending", "settled", "failed"],
      default: "pending",
    },
    settlementDate: Date,
    transactionId: String, // From bank/payment gateway
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Admin ID
  },
  { timestamps: true },
);

// Awesome Feature: Auto-settle after T+2 days (use cron job in app)
settlementSchema.statics.autoSettle = async function () {
  // Find pending settlements older than 2 days and mark settled
  // Integrate with bank API for real payout
  console.log("Auto-settling pending settlements");
};

const SettlementModel =
  mongoose.models.Settlement || mongoose.model("Settlement", settlementSchema);
export default SettlementModel;
