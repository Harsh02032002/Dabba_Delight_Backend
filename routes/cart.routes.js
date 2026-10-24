const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const cc = require('../controllers/cart.controller');

router.get('/', auth, cc.getCart);
router.put('/', auth, cc.saveCart);

module.exports = router;
