const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  phone: { type: String, trim: true },
  role: { type: String, enum: ['user', 'seller', 'admin'], default: 'user' },
  avatar: String,
  banner: String,
  wallet: { type: Number, default: 0 },
  loyaltyPoints: { type: Number, default: 0 },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: String },
  isVerified: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
  businessName: String,
  fcmToken: String,
  emailVerificationCode: String,
  emailVerificationExpires: Date,
  resetPasswordCode: String,
  resetPasswordExpires: Date,
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate referral code
userSchema.pre('save', function () {
  if (!this.referralCode) {
    this.referralCode = 'DN-' + this._id.toString().slice(-6).toUpperCase();
  }
});

module.exports = mongoose.model('User', userSchema);
