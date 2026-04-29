const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Seller = require('../models/Seller');
const { Referral, ReferralConfig } = require('../models/Others');
const { sendEmail, generateCode } = require('../utils/email.service');
const { getJwtSecret } = require('../utils/jwt');

const generateToken = (id) => jwt.sign({ id }, getJwtSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

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
      phone: user.phone, avatar: user.avatar, banner: user.banner, wallet: user.wallet,
      referralCode: user.referralCode, isVerified: user.isVerified,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/auth/profile
exports.updateProfile = async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'avatar', 'banner'];
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
    const avatarUrl = req.file?.s3Url || req.file?.location || req.file?.path;
    if (!avatarUrl) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const user = await User.findByIdAndUpdate(req.user._id, { avatar: avatarUrl }, { new: true });
    
    // Also update seller profile if user is a seller
    const Seller = require('../models/Seller');
    await Seller.findOneAndUpdate({ userId: req.user._id }, { logo: avatarUrl }, { new: true });
    
    res.json({ success: true, avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/profile/banner
exports.updateBanner = async (req, res) => {
  try {
    const bannerUrl = req.file?.s3Url || req.file?.location || req.file?.path;
    if (!bannerUrl) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    // Update user banner
    const user = await User.findByIdAndUpdate(req.user._id, { banner: bannerUrl }, { new: true });
    
    // Also update seller profile if user is a seller
    const Seller = require('../models/Seller');
    await Seller.findOneAndUpdate({ userId: req.user._id }, { coverImage: bannerUrl }, { new: true });
    
    res.json({ success: true, banner: user.banner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/resend-verification
exports.resendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    if (user.isVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is already verified' 
      });
    }

    // Generate new verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.emailVerificationCode = verificationCode;
    user.emailVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    // Send verification email
    await sendEmail({
      to: user.email,
      subject: '🔔 New Email Verification Code - Dabba Nation',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #E86F2A 0%, #FF6B35 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 32px;">🍱 Dabba Nation</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Email Verification Code</p>
          </div>
          <div style="background: white; padding: 40px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin: 0 0 20px 0;">Hello ${user.name},</h2>
            <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
              Your new verification code is:
            </p>
            <div style="background: #f8f9fa; border: 2px dashed #E86F2A; padding: 20px; border-radius: 8px; text-align: center; margin: 30px 0;">
              <span style="font-size: 32px; font-weight: bold; color: #E86F2A; letter-spacing: 3px;">${verificationCode}</span>
            </div>
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
              ⏰ This code will expire in <strong>10 minutes</strong>.<br>
              📝 Please enter this code in verification page to complete your registration.
            </p>
            <div style="background: #f0f8ff; border-left: 4px solid #E86F2A; padding: 15px; margin: 30px 0 0 0;">
              <p style="margin: 0; color: #666;">
                <strong>🔒 Security Notice:</strong> Never share this code with anyone. Our team will never ask for your verification code.
              </p>
            </div>
          </div>
          <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
            <p>© 2024 Dabba Nation. All rights reserved.</p>
            <p>This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      `
    });

    res.json({ 
      success: true, 
      message: 'Verification code sent successfully. Please check your email.' 
    });
    
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send verification code. Please try again.' 
    });
  }
};
