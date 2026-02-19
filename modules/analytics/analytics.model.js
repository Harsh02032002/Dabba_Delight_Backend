import mongoose from "mongoose";

const analyticsSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    period: { type: String, enum: ["daily", "weekly", "monthly", "yearly"] },
    revenue: Number,
    orders: Number,
    repeatCustomers: Number,
    topItems: [{ name: String, count: Number, revenue: Number }],
    peakHours: { hour: Number, orders: Number },
    forecasts: { nextPeriodRevenue: Number, growth: Number }, // AI-generated
    competitorBenchmark: { growth: Number, avgRevenue: Number }, // Anonymized
    aiInsights: [String], // AI-generated tips
    isGlobal: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const AnalyticsModel =
  mongoose.models.Analytics || mongoose.model("Analytics", analyticsSchema);
export default AnalyticsModel;
