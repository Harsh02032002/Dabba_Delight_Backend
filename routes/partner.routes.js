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
router.post('/withdraw', dc.withdrawFromWallet);

module.exports = router;
