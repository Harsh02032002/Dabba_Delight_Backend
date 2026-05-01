const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const oc = require('../controllers/order.controller');

router.post('/place', auth, oc.placeOrder);
router.get('/', auth, oc.getUserOrders);
router.get('/:id', auth, oc.getOrderById);
router.post('/:id/rate', auth, oc.rateOrder);
router.post('/:id/cancel', auth, oc.cancelOrder);
router.delete('/:id/delete', auth, oc.deleteOrder);

module.exports = router;
