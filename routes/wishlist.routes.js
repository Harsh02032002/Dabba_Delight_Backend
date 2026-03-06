const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const wc = require('../controllers/wishlist.controller');

router.post('/add', auth, wc.addToWishlist);
router.delete('/remove/:productId', auth, wc.removeFromWishlist);
router.get('/', auth, wc.getWishlist);

module.exports = router;
