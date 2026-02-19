import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: String,
    replies: [
      {
        from: { type: String, enum: ["seller", "user"] },
        message: String,
        createdAt: Date,
      },
    ],
  },
  { timestamps: true },
);

export default mongoose.model("Review", reviewSchema);
