const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const dc = require('../controllers/delivery.controller');

// Partner registration (no auth required)
router.post('/register', dc.registerPartner);

// Partner login (no auth required)
router.post('/login', dc.loginPartner);

// Authenticated partner routes
router.use(auth);

router.put('/toggle-online', dc.goOnline);
router.put('/location-update', dc.updateDeliveryLocation);
router.get('/current-order', dc.getActiveOrder);
router.get('/profile', dc.getPartnerProfile);
router.get('/order-history', dc.getOrderHistory);
router.get('/earnings', dc.getEarnings);
router.post('/withdraw', dc.withdrawFromWallet);

// Order Actions
router.put('/order/accept', dc.acceptOrder);
router.post('/order/accept', dc.acceptOrder);
router.post('/orders/:orderId/accept', dc.acceptOrder);
router.put('/order/status-update', dc.updateDeliveryStatus);
router.patch('/orders/:orderId/status', dc.updateDeliveryStatus);
router.post('/order/confirm-delivery', dc.confirmDeliveryOTP);
router.post('/orders/:orderId/confirm-delivery', dc.confirmDeliveryOTP);

module.exports = router;
