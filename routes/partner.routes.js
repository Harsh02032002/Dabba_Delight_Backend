const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { s3Upload } = require('../middleware/s3-upload.middleware');
const dc = require('../controllers/delivery.controller');

// Partner registration (no auth required)
router.post('/register', dc.registerPartner);

// Partner login & Dual OTP (no auth required)
router.post('/login', dc.loginPartner);
router.post('/send-login-otp', dc.sendPartnerLoginOtp);
router.post('/verify-login-otp', dc.verifyPartnerLoginOtp);

// Authenticated partner routes
router.use(auth);

// KYC Verification
router.get('/kyc', dc.getKycStatus);
router.post('/kyc/document', ...s3Upload('document', 'rider-kyc'), dc.uploadKycDocument);
router.post('/kyc/submit', dc.submitKycDocuments);

router.put('/toggle-online', dc.goOnline);
router.put('/location-update', dc.updateDeliveryLocation);
router.get('/current-order', dc.getActiveOrder);
router.get('/available-orders', dc.getAvailableOrders);
router.get('/profile', dc.getPartnerProfile);
router.get('/order-history', dc.getOrderHistory);
router.get('/earnings', dc.getEarnings);
router.post('/withdraw', dc.withdrawFromWallet);

// Order Actions (supports both /api/order/* and /api/partner/* mountings)
router.put('/accept', dc.acceptOrder);
router.post('/accept', dc.acceptOrder);
router.put('/order/accept', dc.acceptOrder);
router.post('/order/accept', dc.acceptOrder);
router.post('/orders/:orderId/accept', dc.acceptOrder);

router.put('/status-update', dc.updateDeliveryStatus);
router.patch('/status-update', dc.updateDeliveryStatus);
router.put('/order/status-update', dc.updateDeliveryStatus);
router.patch('/orders/:orderId/status', dc.updateDeliveryStatus);

router.post('/confirm-delivery', dc.confirmDeliveryOTP);
router.post('/order/confirm-delivery', dc.confirmDeliveryOTP);
router.post('/orders/:orderId/confirm-delivery', dc.confirmDeliveryOTP);

// Device Push Token Registration for Riders (FCM / Expo)
router.post('/push-token', async (req, res) => {
  try {
    const { pushToken, fcmToken } = req.body;
    const tokenToSave = pushToken || fcmToken;
    if (!tokenToSave) return res.status(400).json({ success: false, message: 'Push token required' });
    
    const { DeliveryPartner } = require('../models/Others');
    const User = require('../models/User');

    const partnerDoc = await DeliveryPartner.findOneAndUpdate(
      { $or: [{ userId: req.user._id }, { _id: req.user.deliveryPartnerId || req.user._id }] },
      { fcmToken: tokenToSave, pushToken: tokenToSave },
      { new: true }
    );

    await User.findByIdAndUpdate(req.user._id, {
      fcmToken: tokenToSave,
      pushToken: tokenToSave,
    });

    console.log(`📱 [Rider Push Token Registered] partner: ${partnerDoc?._id || req.user._id}`);
    res.json({ success: true, message: 'Rider push token registered successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
