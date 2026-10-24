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

const isMockOtp = (code) => {
  const c = String(code || '').trim();
  if (!c) return false;
  return c === '999999' || c === '123456' || (process.env.MOCK_LOGIN_OTP && c === String(process.env.MOCK_LOGIN_OTP).trim());
};

module.exports = { MAX_CODE_ATTEMPTS, TOO_MANY_ATTEMPTS, tooManyCodeAttempts, recordWrongCode, wrongCodeMessage, isMockOtp };
