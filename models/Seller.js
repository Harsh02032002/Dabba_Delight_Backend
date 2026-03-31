const mongoose = require('mongoose');

const sellerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  businessName: { type: String, required: true },
  type: { type: String, enum: ['home_chef', 'cloud_kitchen', 'restaurant', 'catering'], default: 'home_chef' },
  logo: String,
  coverImage: String,
  description: String,
  phone: { type: String, required: true },
  email: String,
  fssaiLicense: String,
  gstNumber: String,
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    fullAddress: String,
    location: {
      type: { type: String, default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
  },
  operatingHours: {
    monday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    tuesday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    wednesday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    thursday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    friday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    saturday: { open: String, close: String, isOpen: { type: Boolean, default: true } },
    sunday: { open: String, close: String, isOpen: { type: Boolean, default: false } },
  },
  cuisines: [String],
  tags: [String],
  rating: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  commissionRate: { type: Number, default: 15 },
  isActive: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  kycStatus: { type: String, enum: ['pending', 'submitted', 'verified', 'rejected'], default: 'pending' },
  kycDocuments: {
    aadhaar: { url: String, status: String },
    pan: { url: String, status: String },
    fssai: { url: String, status: String },
    bankProof: { url: String, status: String },
  },
  bankDetails: {
    accountNumber: String,
    ifscCode: String,
    accountHolder: String,
    bankName: String,
  },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
}, { timestamps: true });

sellerSchema.index({ 'address.location': '2dsphere' });

// Additional indexes for faster queries
sellerSchema.index({ userId: 1 });
sellerSchema.index({ type: 1, isActive: 1 });
sellerSchema.index({ kycStatus: 1 });
sellerSchema.index({ rating: -1 });
sellerSchema.index({ totalOrders: -1 });
sellerSchema.index({ 'address.city': 1 });
sellerSchema.index({ cuisines: 1 });
sellerSchema.index({ referralCode: 1 });
sellerSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Seller', sellerSchema);
