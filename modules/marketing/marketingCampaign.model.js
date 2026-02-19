import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: ["push", "email", "banner", "coupon"] },
    title: String,
    message: String,
    targetAudience: {
      type: String,
      enum: ["all", "repeat", "new", "specific"],
    },
    targetUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    scheduledAt: Date,
    status: { type: String, enum: ["draft", "scheduled", "sent", "failed"] },
    metrics: { sent: Number, opened: Number, clicked: Number },
  },
  { timestamps: true },
);

export default mongoose.model("MarketingCampaign", campaignSchema);
