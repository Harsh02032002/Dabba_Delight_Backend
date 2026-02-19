import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        name: String,
        quantity: Number,
        price: Number,
        discountPrice: Number,
      },
    ],
    total: { type: Number, required: true },
    deliveryAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      coordinates: [Number],
    },
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "preparing",
        "ready",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },
    // ... (existing)
    disputeStatus: {
      type: String,
      enum: ["none", "open", "resolved", "refunded"],
      default: "none",
    },
    disputeReason: String,
    paymentMethod: { type: String, enum: ["cod", "online"] },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "refunded"],
      default: "pending",
    },
    notes: String,
    estimatedTime: Number, // In minutes
    rating: { type: Number, min: 1, max: 5 }, // Post-delivery
    feedback: String,
    cancellationReason: String,
  },
  { timestamps: true },
);

orderSchema.index({ status: 1, createdAt: -1 }); // For fast queries

// Awesome Feature: Auto-notify on status change (placeholder for Socket.io/email)
orderSchema.post("save", async function (doc) {
  // Emit socket event: io.emit(`orderUpdate:${doc.sellerId}`, doc);
  // Send email/SMS to seller/customer
  console.log("Order updated - notify seller/customer");
});

export default mongoose.model("Order", orderSchema);
