const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const uc = require('../controllers/user.controller');
const lc = require('../controllers/location.controller');

// Sellers & Menu (public)
router.get('/sellers', uc.getSellers);
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

// Wallet
router.post('/wallet/topup', auth, uc.topupWallet);
router.post('/wallet/verify', auth, uc.verifyWalletPayment);
router.get('/wallet/transactions', auth, uc.getWalletTransactions);

module.exports = router;
