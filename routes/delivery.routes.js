const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const dc = require('../controllers/delivery.controller');

router.post('/register', auth, dc.registerPartner);
router.patch('/go-online', auth, dc.goOnline);
router.patch('/go-offline', auth, dc.goOffline);
router.patch('/location', auth, dc.updateLocation);
router.get('/nearby', auth, dc.findNearbyPartners);
router.post('/assign/:orderId', auth, dc.assignOrder);
router.patch('/orders/:orderId/pickup', auth, dc.pickupOrder);
router.patch('/orders/:orderId/deliver', auth, dc.deliverOrder);
router.get('/earnings', auth, dc.getEarnings);
router.get('/active-order', auth, dc.getActiveOrder);

module.exports = router;
