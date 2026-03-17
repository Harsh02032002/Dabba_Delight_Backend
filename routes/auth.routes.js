const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { s3Upload } = require('../middleware/s3-upload.middleware');
const c = require('../controllers/auth.controller');

router.post('/register', c.register);
router.post('/login', c.login);
router.post('/verify-email', c.verifyEmail);
router.post('/resend-verification', c.resendVerificationCode);
router.post('/forgot-password', c.forgotPassword);
router.post('/reset-password', c.resetPassword);
router.post('/change-password', auth, c.changePassword);
router.get('/me', auth, c.getProfile);
router.put('/profile', auth, c.updateProfile);
router.post('/profile/avatar', auth, ...s3Upload('avatar', 'avatars'), c.updateAvatar);
router.post('/profile/banner', auth, ...s3Upload('banner', 'banners'), c.updateBanner);

module.exports = router;
