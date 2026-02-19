import mongoose from "mongoose";

const preferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    newOrderAlerts: { type: Boolean, default: true },
    orderStatusUpdates: { type: Boolean, default: true },
    settlementAlerts: { type: Boolean, default: true },
    marketingEmails: { type: Boolean, default: false },
    smsEnabled: { type: Boolean, default: true },
    emailEnabled: { type: Boolean, default: true },
    pushEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export default mongoose.model("NotificationPreference", preferenceSchema);
