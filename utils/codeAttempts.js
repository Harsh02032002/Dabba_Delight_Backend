/**
 * Limits guessing of one-time codes (login OTP, email verification, password reset).
 * After MAX_CODE_ATTEMPTS wrong entries every pending code on the account is cleared,
 * so the user has to request a fresh one. Sending a new code resets the counter.
 */
const User = require('../models/User');

const MAX_CODE_ATTEMPTS = 5;
const TOO_MANY_ATTEMPTS = 'Too many wrong codes. Please request a new code.';

const tooManyCodeAttempts = (user) => (Number(user?.codeFailedAttempts) || 0) >= MAX_CODE_ATTEMPTS;

/** Count a wrong code; returns how many tries are left (0 = codes cleared) */
async function recordWrongCode(user) {
  const updated = await User.findByIdAndUpdate(user._id, { $inc: { codeFailedAttempts: 1 } }, { new: true });
  const used = Number(updated?.codeFailedAttempts) || 0;
  if (used >= MAX_CODE_ATTEMPTS) {
    await User.updateOne({ _id: user._id }, {
      $unset: { loginOtp: 1, loginOtpExpires: 1, emailVerificationCode: 1, emailVerificationExpires: 1, resetPasswordCode: 1, resetPasswordExpires: 1 },
    });
  }
  return Math.max(0, MAX_CODE_ATTEMPTS - used);
}

const wrongCodeMessage = (left, base = 'Invalid or expired code.') =>
  (left > 0 ? `${base} ${left} attempt${left === 1 ? '' : 's'} left.` : TOO_MANY_ATTEMPTS);

/**
 * Play Store / App Store reviewer sign-in. A fixed code is accepted only when REVIEWER_OTP is set
 * and the account's email or phone is listed in REVIEWER_ACCOUNTS (comma separated).
 * Never for admins, and never for delivery handover OTPs.
 */
const normalizeId = (v) => String(v || '').trim().toLowerCase().replace(/[\s-]/g, '');
const isReviewerOtp = (code, user) => {
  const expected = String(process.env.REVIEWER_OTP || '').trim();
  const c = String(code || '').trim();
  if (!expected || !c || c !== expected || !user || user.role === 'admin') return false;
  const allowed = String(process.env.REVIEWER_ACCOUNTS || '').split(',').map(normalizeId).filter(Boolean);
  if (!allowed.length) return false;
  const ids = [user.email, user.phone].map(normalizeId).filter(Boolean);
  return ids.some((id) => allowed.includes(id) || allowed.includes(id.replace(/^\+?91/, '')));
};

module.exports = { MAX_CODE_ATTEMPTS, TOO_MANY_ATTEMPTS, tooManyCodeAttempts, recordWrongCode, wrongCodeMessage, isReviewerOtp };
