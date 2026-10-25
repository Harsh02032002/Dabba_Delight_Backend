const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Seller = require('../models/Seller');
const { Referral, ReferralConfig } = require('../models/Others');
const { sendEmail, generateCode } = require('../utils/email.service');
const { tooManyCodeAttempts, recordWrongCode, wrongCodeMessage, TOO_MANY_ATTEMPTS, isReviewerOtp } = require('../utils/codeAttempts');
const { buildIdentifierQuery, sendDualOTP } = require('../utils/sms.service');
const { getJwtSecret } = require('../utils/jwt');
const { validateRegistration } = require('../utils/registration');

const generateToken = (id) => jwt.sign({ id }, getJwtSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const checked = validateRegistration(req.body);
    if (!checked.ok) {
      return res.status(checked.status).json({ success: false, message: checked.message, field: checked.field });
    }
    const { name, email, password, phone, role, businessName, type } = checked.value;
    const { address, referralCode } = req.body;

    const existing = await User.findOne({ email }).select('+password');
    if (existing) {
      // An existing customer may add a seller profile to the same account, but only by proving
      // they own it (correct password). The password is never overwritten here, and admin /
      // rider accounts can never be converted.
      if (role === 'seller' && (existing.role === 'user' || existing.role === 'seller')) {
        const passwordOk = await existing.comparePassword(password).catch(() => false);
        if (!passwordOk) {
          return res.status(409).json({ success: false, message: 'Email already registered. Sign in with your existing password to add a seller profile.' });
        }
        const existingProfile = await Seller.findOne({ userId: existing._id });
        if (existing.role === 'seller' && existingProfile) {
          return res.status(409).json({ success: false, message: 'A seller account with this email already exists. Please sign in.' });
        }
        if (existing.role !== 'seller') {
          existing.role = 'seller';
          await existing.save();
        }
        const sellerProfile = existingProfile || await Seller.create({
          userId: existing._id,
          businessName,
          phone: phone || existing.phone || '',
          email: existing.email,
          type,
          address: typeof address === 'string' ? { street: address } : address || {},
        });

        const token = generateToken(existing._id);
        return res.status(200).json({
          success: true,
          token,
          user: { _id: existing._id, name: existing.name, email: existing.email, role: existing.role, phone: existing.phone },
          seller: { _id: sellerProfile._id, kycStatus: sellerProfile.kycStatus, isActive: sellerProfile.isActive },
        });
      }

      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const user = new User({ name, email, password, phone, role, businessName });

    // Generate verification code (sent to BOTH Email and Phone SMS)
    const code = generateCode();
    user.emailVerificationCode = code;
    user.codeFailedAttempts = 0;
    user.emailVerificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    user.loginOtp = code;
    user.loginOtpExpires = new Date(Date.now() + 15 * 60 * 1000);

    await user.save();

    // If seller, create the seller profile. New sellers start pending approval
    // (kycStatus 'pending', isActive false) and stay hidden from customers until an admin approves.
    let newSeller = null;
    if (role === 'seller') {
      try {
        newSeller = await Seller.create({
          userId: user._id,
          businessName,
          phone,
          email,
          type,
          address: typeof address === 'string' ? { street: address } : address || {},
        });
      } catch (sellerErr) {
        // Don't leave a seller login without a seller profile behind
        await User.deleteOne({ _id: user._id }).catch(() => {});
        throw sellerErr;
      }
    }

    // Referral rewards only after the new account definitely exists
    if (referralCode && role === 'user') {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        const refConfig = await ReferralConfig.findOne();
        const userReward = refConfig?.userReward || 100;
        user.referredBy = referralCode;
        await user.save();
        referrer.wallet += userReward;
        await referrer.save();
      }
    }
    if (referralCode && newSeller) {
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

    // Send verification OTP to BOTH Email and Phone SMS
    sendDualOTP({ user, otp: code, purpose: 'Account Verification' }).catch(() => {});

    const token = generateToken(user._id);
    res.status(201).json({
      success: true,
      requiresVerification: true,
      token,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone, isVerified: user.isVerified },
      ...(newSeller ? { seller: { _id: newSeller._id, kycStatus: newSeller.kycStatus, isActive: newSeller.isActive } } : {}),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// Helper: verify user password with existing auto-repair fallbacks
async function checkUserPassword(user, password) {
  if (!password || !user.password) return false;
  try {
    return await user.comparePassword(password);
  } catch {
    return false;
  }
}

// Helper: find user by identifier with priority given to requested role (prevents role collisions when phone is shared)
async function findUserByIdentifierAndRole(rawId, role, selectPassword = false) {
  const query = buildIdentifierQuery(rawId);
  if (role) {
    let q = User.findOne({ ...query, role });
    if (selectPassword) q = q.select('+password');
    const roleMatched = await q;
    if (roleMatched) return roleMatched;
  }
  const matchingUsers = await (selectPassword ? User.find(query).select('+password') : User.find(query));
  if (role && matchingUsers.length > 0) {
    const matched = matchingUsers.find(u => u.role === role);
    if (!matched && role === 'seller') {
      const Seller = require('../models/Seller');
      for (const u of matchingUsers) {
        const seller = await Seller.findOne({ userId: u._id });
        if (seller) {
          if (u.role !== 'seller') {
            u.role = 'seller';
            await u.save().catch(() => {});
          }
          return u;
        }
      }
    }
    if (matched) return matched;
  }
  return matchingUsers.length > 0 ? matchingUsers[0] : null;
}

// POST /api/auth/send-login-otp
exports.sendLoginOtp = async (req, res) => {
  try {
    const { email, phone, identifier, password, role } = req.body;
    const rawId = (identifier || email || phone || '').trim();
    if (!rawId) {
      return res.status(400).json({ success: false, message: 'Please enter your Email or Phone Number' });
    }

    const user = await findUserByIdentifierAndRole(rawId, role, true);
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this Email or Phone Number' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: 'Account is blocked' });
    }
    if (role && user.role !== role) {
      return res.status(403).json({
        success: false,
        message: `This account is registered as "${user.role}", not "${role}". Please use the correct portal.`,
      });
    }

    // If password was provided, verify it before sending OTP
    if (password !== undefined && password !== '') {
      const isMatch = await checkUserPassword(user, password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid password' });
      }
    }

    const otp = generateCode();
    user.loginOtp = otp;
    user.codeFailedAttempts = 0;
    user.loginOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    const { maskedEmail, maskedPhone } = await sendDualOTP({
      user,
      otp,
      purpose: 'Login Verification',
    });

    console.log(`🔐 [Login OTP Generated] User: ${user.email} (${user.phone || 'no-phone'}) | OTP: ${otp}`);

    res.json({
      success: true,
      otpRequired: true,
      identifier: rawId,
      email: user.email,
      phone: user.phone,
      role: user.role,
      maskedEmail,
      maskedPhone,
      message: `OTP sent to ${[maskedEmail, maskedPhone].filter(Boolean).join(' and ')}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/verify-login-otp
exports.verifyLoginOtp = async (req, res) => {
  try {
    const { email, phone, identifier, otp, code, role } = req.body;
    const rawId = (identifier || email || phone || '').trim();
    const submittedOtp = String(otp || code || '').trim();

    if (!rawId || !submittedOtp) {
      return res.status(400).json({ success: false, message: 'Email/Phone and 6-digit OTP are required' });
    }

    const user = await findUserByIdentifierAndRole(rawId, role, false);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: 'Account is blocked' });
    }
    if (role && user.role !== role) {
      return res.status(403).json({
        success: false,
        message: `This account is registered as "${user.role}", not "${role}".`,
      });
    }

    const isMock = isReviewerOtp(submittedOtp, user);
    if (!isMock && tooManyCodeAttempts(user)) return res.status(429).json({ success: false, message: TOO_MANY_ATTEMPTS });

    const now = new Date();
    const validLoginOtp =
      isMock ||
      (user.loginOtp &&
      user.loginOtp === submittedOtp &&
      user.loginOtpExpires &&
      user.loginOtpExpires >= now);

    const validEmailOtp =
      isMock ||
      (user.emailVerificationCode &&
      user.emailVerificationCode === submittedOtp &&
      user.emailVerificationExpires &&
      user.emailVerificationExpires >= now);

    if (!validLoginOtp && !validEmailOtp) {
      const left = await recordWrongCode(user);
      return res.status(left > 0 ? 400 : 429).json({ success: false, message: wrongCodeMessage(left, 'Invalid or expired OTP.') });
    }

    user.isVerified = true;
    user.codeFailedAttempts = 0;
    user.loginOtp = undefined;
    user.loginOtpExpires = undefined;
    user.emailVerificationCode = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    const token = generateToken(user._id);
    res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar,
        banner: user.banner,
        wallet: user.wallet,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, phone, identifier, password, otp, requireOtp, role } = req.body;
    const rawId = (identifier || email || phone || '').trim();

    // If OTP is submitted directly to /auth/login, verify OTP and return token
    if (otp) {
      return exports.verifyLoginOtp(req, res);
    }

    // If requireOtp is requested (or no password provided for OTP-based login), send Dual OTP
    if (requireOtp || (!password && rawId)) {
      return exports.sendLoginOtp(req, res);
    }

    if (!rawId || !password) {
      return res.status(400).json({ success: false, message: 'Email/Phone and password required' });
    }

    const user = await findUserByIdentifierAndRole(rawId, role, true);
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    if (user.isBlocked) return res.status(403).json({ success: false, message: 'Account blocked' });

    if (role && user.role !== role) {
      return res.status(403).json({
        success: false,
        message: `This account is not registered as ${role}`,
      });
    }

    const isMatch = await checkUserPassword(user, password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (!user.isVerified) {
      return res.status(403).json({ success: false, message: 'Account not verified. Please login with OTP.' });
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
    const { email, phone, identifier, code } = req.body;
    const rawId = (identifier || email || phone || '').trim();
    const user = await User.findOne(buildIdentifierQuery(rawId));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const submitted = String(code || '').trim();
    const isMock = isReviewerOtp(submitted, user);
    if (!isMock && tooManyCodeAttempts(user)) return res.status(429).json({ success: false, message: TOO_MANY_ATTEMPTS });

    const now = new Date();
    const validEmailCode =
      isMock ||
      (!!submitted &&
      user.emailVerificationCode === submitted &&
      user.emailVerificationExpires &&
      user.emailVerificationExpires >= now);
    const validLoginCode =
      isMock ||
      (!!submitted &&
      user.loginOtp === submitted &&
      user.loginOtpExpires &&
      user.loginOtpExpires >= now);

    if (!validEmailCode && !validLoginCode) {
      const left = await recordWrongCode(user);
      return res.status(left > 0 ? 400 : 429).json({ success: false, message: wrongCodeMessage(left, 'Invalid or expired verification code.') });
    }

    user.isVerified = true;
    user.codeFailedAttempts = 0;
    user.emailVerificationCode = undefined;
    user.emailVerificationExpires = undefined;
    user.loginOtp = undefined;
    user.loginOtpExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Account verified successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { email, phone, identifier } = req.body;
    const rawId = (identifier || email || phone || '').trim();
    const user = await User.findOne(buildIdentifierQuery(rawId));
    if (!user) return res.json({ success: true }); // don't leak existence

    const code = generateCode();
    user.resetPasswordCode = code;
    user.codeFailedAttempts = 0;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    sendDualOTP({ user, otp: code, purpose: 'Password Reset' }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { email, phone, identifier, code, newPassword } = req.body;
    const rawId = String(identifier || email || phone || '').trim();
    const submitted = String(code || '').trim();
    if (!rawId || !submitted) return res.status(400).json({ success: false, message: 'Email and reset code are required' });
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }
    const user = await User.findOne(buildIdentifierQuery(rawId)).select('+password');
    if (!user) return res.status(400).json({ success: false, message: 'Invalid reset code' });
    if (tooManyCodeAttempts(user)) return res.status(429).json({ success: false, message: TOO_MANY_ATTEMPTS });

    if (!user.resetPasswordCode || !user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Reset code expired' });
    }

    if (user.resetPasswordCode !== submitted) {
      const left = await recordWrongCode(user);
      return res.status(left > 0 ? 400 : 429).json({ success: false, message: wrongCodeMessage(left, 'Invalid reset code.') });
    }

    user.password = newPassword;
    user.codeFailedAttempts = 0;
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
    let role = user.role;
    if (role !== 'admin' && role !== 'delivery') {
      const Seller = require('../models/Seller');
      const seller = await Seller.findOne({ userId: user._id });
      if (seller) {
        role = 'seller';
        if (user.role !== 'seller') {
          user.role = 'seller';
          await user.save().catch(() => {});
        }
      }
    }
    res.json({
      success: true,
      _id: user._id, name: user.name, email: user.email, role: role,
      phone: user.phone, avatar: user.avatar, banner: user.banner, wallet: user.wallet,
      bio: user.bio || '', address: user.address || '',
      referralCode: user.referralCode, isVerified: user.isVerified,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/auth/profile
exports.updateProfile = async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'avatar', 'banner', 'bio', 'address'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json({ success: true, user: {
      _id: user._id, name: user.name, email: user.email, role: role,
      phone: user.phone, avatar: user.avatar, banner: user.banner,
      bio: user.bio || '', address: user.address || '',
      wallet: user.wallet, referralCode: user.referralCode, isVerified: user.isVerified,
    }});
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
    const { email, phone, identifier } = req.body;
    const rawId = (identifier || email || phone || '').trim();
    
    if (!rawId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email or Phone is required' 
      });
    }

    const user = await User.findOne(buildIdentifierQuery(rawId));
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Generate new verification code
    const verificationCode = generateCode();
    user.emailVerificationCode = verificationCode;
    user.codeFailedAttempts = 0;
    user.emailVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    user.loginOtp = verificationCode;
    user.loginOtpExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    // Send verification OTP to BOTH Email and Phone SMS
    const { maskedEmail, maskedPhone } = await sendDualOTP({
      user,
      otp: verificationCode,
      purpose: 'Verification',
    });

    res.json({ 
      success: true, 
      maskedEmail,
      maskedPhone,
      message: 'Verification OTP sent to your Email and Phone number.' 
    });
    
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send verification code. Please try again.' 
    });
  }
};


// DELETE /api/auth/account (also /api/partner/account) { confirm: 'DELETE' }
// Erases personal data and closes the account. Orders, invoices and wallet records are kept
// (tax and accounting law) but no longer identify the person.
const ACTIVE_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];
exports.deleteAccount = async (req, res) => {
  try {
    if (String(req.body?.confirm || '').trim().toUpperCase() !== 'DELETE') {
      return res.status(400).json({ success: false, message: 'Type DELETE to confirm account deletion' });
    }
    const Order = require('../models/Order');
    const Seller = require('../models/Seller');
    const { Address, Wishlist, Cart, Notification, NotificationPreference, DeliveryPartner } = require('../models/Others');
    const user = req.user;

    const seller = await Seller.findOne({ userId: user._id });
    const partner = await DeliveryPartner.findOne({ userId: user._id });

    const busy = await Order.exists({
      status: { $in: ACTIVE_ORDER_STATUSES },
      $or: [
        { userId: user._id },
        ...(seller ? [{ sellerId: seller._id }] : []),
        ...(partner ? [{ deliveryPartnerId: partner._id }] : []),
      ],
    });
    if (busy) {
      return res.status(409).json({ success: false, message: 'You have an order in progress. Please wait until it is delivered or cancelled, then try again.' });
    }

    const id = String(user._id);
    await Promise.all([
      Address.deleteMany({ userId: user._id }).catch(() => {}),
      Wishlist.deleteMany({ userId: user._id }).catch(() => {}),
      Cart.deleteMany({ userId: user._id }).catch(() => {}),
      Notification.deleteMany({ userId: user._id }).catch(() => {}),
      NotificationPreference.deleteMany({ userId: user._id }).catch(() => {}),
    ]);

    if (seller) {
      await Seller.updateOne({ _id: seller._id }, {
        $set: { isActive: false, isVerified: false, businessName: 'Closed kitchen', description: '' },
        $unset: { phone: 1, email: 1, bankDetails: 1, kycDocuments: 1, logo: 1, coverImage: 1 },
      });
    }
    if (partner) {
      await DeliveryPartner.updateOne({ _id: partner._id }, {
        $set: { name: 'Deleted rider', isOnline: false, isAvailable: false, isApproved: false },
        $unset: { phone: 1, email: 1, bankDetails: 1, kycDocuments: 1, pushToken: 1, fcmToken: 1, vehicleNumber: 1, profileImage: 1, currentLocation: 1 },
      });
    }

    await User.updateOne({ _id: user._id }, {
      $set: {
        name: 'Deleted user',
        email: `deleted+${id}@deleted.dabbanation.in`,
        isBlocked: true,
        isVerified: false,
        deletedAt: new Date(),
      },
      $unset: {
        phone: 1, avatar: 1, banner: 1, address: 1, pushToken: 1, fcmToken: 1, cart: 1, location: 1,
        loginOtp: 1, loginOtpExpires: 1, emailVerificationCode: 1, emailVerificationExpires: 1,
        resetPasswordCode: 1, resetPasswordExpires: 1, referralCode: 1,
      },
    });
    // Replace the password with a random one (hashed by the model) so the old one can never sign in
    const fresh = await User.findById(user._id).select('+password');
    if (fresh) { fresh.password = require('crypto').randomBytes(24).toString('hex'); await fresh.save(); }

    res.json({ success: true, message: 'Your account has been deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
