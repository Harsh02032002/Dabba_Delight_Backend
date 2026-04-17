const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const uc = require('../controllers/user.controller');
const lc = require('../controllers/location.controller');
const subController = require('../controllers/subscription.controller');

// Sellers & Menu (public)
router.get('/sellers', uc.getSellers);
router.get('/sellers/:id', uc.getSellerById);
router.get('/menu', uc.getMenuItems);
router.get('/recommendations', uc.getRecommendations);
router.get('/banners', uc.getActiveBanners);

// Address / Location
router.post('/address', auth, lc.addAddress);
router.get('/addresses', auth, lc.getAddresses);
router.put('/address/:id', auth, lc.updateAddress);
router.delete('/address/:id', auth, lc.deleteAddress);
router.patch('/address/:id/set-default', auth, lc.setDefaultAddress);
router.get('/sellers/nearby', auth, lc.getNearbySellers);
router.post('/reverse-geocode', auth, lc.reverseGeocode);

// Dabba Express — subscriptions
router.get('/subscriptions/active', auth, subController.getActiveForUser);
router.get('/subscriptions/my-subscriptions', auth, subController.getMySubscriptions);
router.post('/subscriptions/purchase', auth, subController.purchase);

// Wallet
router.post('/wallet/topup', auth, uc.topupWallet);
router.post('/wallet/verify', auth, uc.verifyWalletPayment);
router.get('/wallet/transactions', auth, uc.getWalletTransactions);

// Rating routes
router.post('/menu/:menuItemId/rate', auth, uc.rateMenuItem);
router.post('/sellers/:sellerId/rate', auth, uc.rateSeller);
router.post('/orders/:orderId/rate', auth, uc.rateOrder);
router.get('/sellers/:sellerId/rating-breakdown', auth, uc.getSellerRatingBreakdown);

module.exports = router;
