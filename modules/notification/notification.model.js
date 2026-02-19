import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "order",
        "settlement",
        "kyc",
        "low_stock",
        "ai_insight",
        "referral",
      ],
    },
    message: String,
    data: Object, // Extra payload (e.g., orderId)
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ isRead: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
