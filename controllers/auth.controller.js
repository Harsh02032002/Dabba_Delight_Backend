const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Seller = require('../models/Seller');
const { Referral, ReferralConfig } = require('../models/Others');
const { sendEmail, generateCode } = require('../utils/email.service');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, role = 'user', businessName, address, referralCode, type } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      // If trying to register as seller with an existing account, upgrade/create seller profile
      if (role === 'seller') {
        // Ensure user has seller role
        if (existing.role !== 'seller') {
          existing.role = 'seller';
          if (password) existing.password = password;
          await existing.save();
        }

        // Ensure seller profile exists
        let sellerProfile = await Seller.findOne({ userId: existing._id });
        if (!sellerProfile) {
          sellerProfile = await Seller.create({
            userId: existing._id,
            businessName: businessName || existing.businessName || name || existing.name,
            phone: phone || existing.phone || '',
            email: existing.email,
            type: type || 'home_chef',
            address: typeof address === 'string' ? { street: address } : address || {},
          });
        }

        const token = generateToken(existing._id);
        return res.status(200).json({
          success: true,
          token,
          user: { _id: existing._id, name: existing.name, email: existing.email, role: existing.role, phone: existing.phone },
        });
      }

      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const user = new User({ name, email, password, phone, role, businessName });

    // Handle user referral (user-to-user)
    if (referralCode && role === 'user') {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        const refConfig = await ReferralConfig.findOne();
        const userReward = refConfig?.userReward || 100;
        user.referredBy = referralCode;
        referrer.wallet += userReward;
        await referrer.save();
      }
    }

    // Generate email verification code
    const code = generateCode();
    user.emailVerificationCode = code;
    user.emailVerificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await user.save();

    // Send verification email (fire and forget)
    sendEmail(
      email,
      'Verify your Dabba Nation account',
      `<p>Hi ${name || ''},</p>
       <p>Your verification code is <b>${code}</b>.</p>
       <p>This code will expire in 15 minutes.</p>`
    ).catch(() => {});

    // If seller, create seller profile
    if (role === 'seller') {
      const newSeller = await Seller.create({
        userId: user._id,
        businessName: businessName || name,
        phone: phone || '',
        email,
        type: type || 'home_chef',
        address: typeof address === 'string' ? { street: address } : address || {},
      });

      // Handle seller referral code (seller-to-seller)
      if (referralCode) {
        const referrerSeller = await Seller.findOne({ referralCode });
        if (referrerSeller) {
          const refConfig = await ReferralConfig.findOne();
          const sellerReward = refConfig?.sellerReward || 500;
          newSeller.referredBy = referrerSeller._id;
          await newSeller.save();

          await Referral.create({
            referrerId: referrerSeller._id,
            referredId: newSeller._id,
            referralCode,
            status: 'pending',
            reward: sellerReward,
          });
        }
      }
    }

    const token = generateToken(user._id);
    res.status(201).json({
      success: true,
      requiresVerification: true,
      token,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone, isVerified: user.isVerified },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    if (user.isBlocked) return res.status(403).json({ success: false, message: 'Account blocked' });

    if (!password || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    let isMatch = false;
    try {
      isMatch = await user.comparePassword(password);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (!user.isVerified) {
      return res.status(403).json({ success: false, message: 'Email not verified' });
    }

    const token = generateToken(user._id);
    res.json({
      success: true,
      token,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone, avatar: user.avatar, wallet: user.wallet },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/verify-email
exports.verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.emailVerificationCode || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Verification code expired' });
    }

    if (user.emailVerificationCode !== code) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    user.isVerified = true;
    user.emailVerificationCode = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: true }); // don't leak existence

    const code = generateCode();
    user.resetPasswordCode = code;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    sendEmail(
      email,
      'Reset your Dabba Nation password',
      `<p>Hi ${user.name || ''},</p>
       <p>Your password reset code is <b>${code}</b>.</p>
       <p>This code will expire in 15 minutes.</p>`
    ).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(400).json({ success: false, message: 'Invalid reset code' });

    if (!user.resetPasswordCode || !user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Reset code expired' });
    }

    if (user.resetPasswordCode !== code) {
      return res.status(400).json({ success: false, message: 'Invalid reset code' });
    }

    user.password = newPassword;
    user.resetPasswordCode = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/change-password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/auth/me
exports.getProfile = async (req, res) => {
  try {
    const user = req.user;
    res.json({
      success: true,
      _id: user._id, name: user.name, email: user.email, role: user.role,
      phone: user.phone, avatar: user.avatar, wallet: user.wallet,
      referralCode: user.referralCode, isVerified: user.isVerified,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/auth/profile
exports.updateProfile = async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'avatar'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json({ success: true, ...user.toObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/profile/avatar
exports.updateAvatar = async (req, res) => {
  try {
    const avatarUrl = req.file?.location || req.file?.path;
    if (!avatarUrl) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const user = await User.findByIdAndUpdate(req.user._id, { avatar: avatarUrl }, { new: true });
    res.json({ success: true, avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
