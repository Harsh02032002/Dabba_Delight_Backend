const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const pc = require('../controllers/payment.controller');

router.post('/razorpay/create-order', auth, pc.createRazorpayOrder);
router.post('/razorpay/verify', auth, pc.verifyRazorpayPayment);
router.post('/stripe/create-intent', auth, pc.createStripeIntent);

module.exports = router;
