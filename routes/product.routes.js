const router = require('express').Router();
const sellerAuth = require('../middleware/seller.middleware');
const adminAuth = require('../middleware/admin.middleware');
const { s3Upload } = require('../middleware/s3-upload.middleware');
const pc = require('../controllers/product.controller');

// Helper middleware to allow both seller and admin
const sellerOrAdminAuth = (req, res, next) => {
  // Try seller auth first
  sellerAuth(req, res, (err) => {
    if (!err) return next();
    // If seller auth fails, try admin auth
    adminAuth(req, res, next);
  });
};

// CRUD
router.get('/', pc.getProducts);
router.post('/', sellerAuth, ...s3Upload('image', 'products'), pc.createProduct);
router.put('/:id', sellerAuth, ...s3Upload('image', 'products'), pc.updateProduct);

// Status
router.patch('/:id/toggle', sellerAuth, pc.toggleAvailability);
router.patch('/:id/out-of-stock', sellerAuth, pc.markOutOfStock);
router.patch('/:id/in-stock', sellerAuth, pc.markInStock);

// Quick edit
router.patch('/:id/price', sellerAuth, pc.updatePrice);
router.patch('/:id/category', sellerAuth, pc.updateCategory);
router.patch('/:id/veg-toggle', sellerAuth, pc.toggleVeg);

// Bulk
router.post('/bulk/create', sellerAuth, pc.bulkCreate);
router.put('/bulk/update', sellerAuth, pc.bulkUpdate);
router.post('/bulk/action', sellerAuth, pc.bulkAction);

// Duplicate
router.post('/:id/duplicate', sellerAuth, pc.duplicateProduct);

// Recycle Bin (Soft Delete)
router.get('/recycle-bin', sellerAuth, pc.getRecycleBin);
router.patch('/:id/archive', sellerAuth, pc.archiveProduct);
router.patch('/:id/restore', sellerAuth, pc.restoreProduct);
router.delete('/recycle-bin/empty', sellerAuth, pc.emptyRecycleBin);
router.delete('/:id', sellerAuth, pc.hardDeleteProduct);

// Image
router.patch('/:id/image', sellerAuth, ...s3Upload('image', 'products'), pc.replaceImage);
router.delete('/:id/image', sellerAuth, pc.removeImage);

// Stock / Inventory
router.patch('/:id/stock', sellerAuth, pc.updateStock);
router.get('/inventory/low-stock', sellerAuth, pc.getLowStockProducts);

// Metrics & Performance (allow both seller and admin)
router.get('/metrics', sellerOrAdminAuth, pc.getInvestorMetrics);
router.get('/health-score', sellerOrAdminAuth, pc.menuHealthScore);
router.get('/:id/performance', sellerAuth, pc.getProductPerformance);

// Publish & Happy Hour
router.patch('/:id/publish', sellerAuth, pc.publishProduct);
router.patch('/happy-hour', sellerAuth, pc.setHappyHourDiscount);

module.exports = router;