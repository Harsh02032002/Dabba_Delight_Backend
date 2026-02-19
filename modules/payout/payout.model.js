import mongoose from "mongoose";

const payoutSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: Number,
    status: { type: String, enum: ["requested", "processed", "failed"] },
    transactionId: String,
    method: { type: String, enum: ["bank", "upi"] },
    requestedAt: Date,
    processedAt: Date,
  },
  { timestamps: true },
);

export default mongoose.model("Payout", payoutSchema);
