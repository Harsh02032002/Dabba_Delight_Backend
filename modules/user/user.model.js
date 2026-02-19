import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["user", "seller", "admin"], default: "user" },
    customCommission: Number, // Override for sellers
    customGST: Number, // Override
    phone: String,
    businessName: String, // Seller specific
    type: { type: String, enum: ["home_chef", "restaurant"] }, // Seller type
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      coordinates: { type: [Number], index: "2dsphere" }, // For geo-location
    },
    operatingHours: [
      { day: String, open: String, close: String, isClosed: Boolean },
    ],
    bankDetails: {
      accountName: String,
      accountNumber: String,
      bankName: String,
      ifscCode: String,
    },
    referralCode: { type: String, unique: true }, // NEW: For referrals
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    earningsBalance: { type: Number, default: 0 }, // For settlements
    kycStatus: {
      type: String,
      enum: ["pending", "submitted", "verified", "rejected"],
      default: "pending",
    },
    kycDocuments: [{ type: String, uploadedAt: Date }], // Array of doc URLs
    avatar: String, // profile image URL
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { timestamps: true },
);

userSchema.pre("save", async function () {
  if (!this.referralCode) {
    this.referralCode =
      "DABBA" + Math.random().toString(36).substring(2, 8).toUpperCase();
  }
});


const UserModel = mongoose.models.User || mongoose.model("User", userSchema);
export default UserModel;
