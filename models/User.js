const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  phone: { type: String, trim: true },
  role: { type: String, enum: ['user', 'seller', 'admin', 'delivery'], default: 'user' },
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
  try {
    // Validate inputs
    if (!candidatePassword) {
      throw new Error('Candidate password is required');
    }
    
    if (!this.password) {
      throw new Error('User password is not available');
    }
    
    // Compare passwords
    const isMatch = await bcrypt.compare(candidatePassword, this.password);
    return isMatch;
  } catch (error) {
    console.error('Password comparison error:', error.message);
    throw error;
  }
};

// Generate JWT token (uses same JWT_SECRET as auth so socket verification works)
userSchema.methods.generateJWT = function () {
  const jwt = require('jsonwebtoken');
  const { getJwtSecret } = require('../utils/jwt');

  if (!this._id || !this.email || !this.role) {
    throw new Error('Missing required fields for JWT generation');
  }

  const payload = {
    id: this._id.toString(),
    email: this.email,
    role: this.role
  };

  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
};

// Generate referral code
userSchema.pre('save', function () {
  if (!this.referralCode) {
    this.referralCode = 'DN-' + this._id.toString().slice(-6).toUpperCase();
  }
});

module.exports = mongoose.model('User', userSchema);
