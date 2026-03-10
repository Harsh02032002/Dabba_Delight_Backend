const router = require('express').Router();
const sellerAuth = require('../middleware/seller.middleware');
const { s3Upload } = require('../middleware/s3-upload.middleware');
const c = require('../controllers/seller.controller');

// Protected routes (require seller authentication)
router.get('/', sellerAuth, c.getProfile);
router.put('/', sellerAuth, c.updateProfile);
router.post('/logo', sellerAuth, ...s3Upload('logo', 'seller-logos'), c.updateLogo);
router.post('/cover', sellerAuth, ...s3Upload('cover', 'seller-covers'), c.updateCoverImage);

module.exports = router;
