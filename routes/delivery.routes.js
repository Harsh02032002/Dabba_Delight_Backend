const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const dc = require('../controllers/delivery.controller');

// Original delivery routes
router.post('/register', auth, dc.registerPartner);
router.patch('/go-online', auth, dc.goOnline);
router.patch('/go-offline', auth, dc.goOffline);
router.patch('/location', auth, dc.updateLocation);
router.post('/location-update', auth, dc.updateDeliveryLocation);
router.get('/nearby', auth, dc.findNearbyPartners);
router.post('/assign/:orderId', auth, dc.assignOrder);
router.patch('/orders/:orderId/pickup', auth, dc.pickupOrder);
router.patch('/orders/:orderId/deliver', auth, dc.deliverOrder);
router.get('/earnings', auth, dc.getEarnings);
router.get('/active-order', auth, dc.getActiveOrder);
router.get('/wallet/transactions', auth, dc.getWalletTransactions);
router.post('/wallet/withdraw', auth, dc.withdrawFromWallet);

// Additional partner routes for delivery app compatibility
router.post('/register', auth, dc.registerPartner);
router.post('/login', dc.loginPartner);
router.put('/toggle-online', auth, dc.goOnline);
router.put('/location-update', auth, dc.updateDeliveryLocation);
router.get('/current-order', auth, dc.getActiveOrder);
router.get('/profile', auth, dc.getPartnerProfile);
router.get('/order-history', auth, dc.getOrderHistory);
router.post('/withdraw', auth, dc.withdrawFromWallet);

// ─── New Order Management Routes (Step 4-6) ──────
router.post('/orders/:orderId/accept', auth, dc.acceptOrder);
router.post('/orders/:orderId/reject', auth, dc.rejectOrder);
router.patch('/orders/:orderId/status', auth, dc.updateDeliveryStatus);
router.get('/partner/location/:partnerId', dc.getPartnerLocation);
router.get('/orders/active', auth, dc.getActiveOrders);

module.exports = router;
