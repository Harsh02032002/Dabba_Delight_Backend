const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const ic = require('../controllers/invoice.controller');

router.post('/generate/:orderId', auth, ic.generateInvoiceForOrder);
router.get('/:invoiceId', auth, ic.getInvoice);
router.get('/download/:orderId', auth, ic.downloadInvoice);

module.exports = router;
