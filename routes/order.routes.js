const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const oc = require('../controllers/order.controller');
const uc = require('../controllers/user.controller');

router.post('/place', auth, oc.placeOrder);
router.get('/', auth, oc.getUserOrders);
router.get('/:orderId/track', auth, uc.getOrderTracking);
router.get('/:id', auth, oc.getOrderById);
router.post('/:id/rate', auth, oc.rateOrder);
router.post('/:id/cancel', auth, oc.cancelOrder);
router.delete('/:id/delete', auth, oc.deleteOrder);

module.exports = router;
