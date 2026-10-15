const router = require('express').Router();
const sellerAuth = require('../middleware/seller.middleware');
const adminAuth = require('../middleware/admin.middleware');
const { s3Upload } = require('../middleware/s3-upload.middleware');
const pc = require('../controllers/product.controller');

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Seller = require('../models/Seller');

// Sellers may read their own menu while pending, but may only create or change items once
// an admin has approved them (same rule as sellerAuth's KYC gate)
const requireApprovedForWrites = (req, res, next) => {
  if (req.method !== 'GET' && req.seller && req.seller.kycStatus !== 'verified') {
    return res.status(403).json({
      success: false,
      message: 'Your seller account is pending approval. You can add menu items once an admin approves it.',
      kycStatus: req.seller.kycStatus,
      requiresKYC: true,
    });
  }
  next();
};

// GET /api/products: anonymous allowed; a valid seller/admin token scopes the result
const optionalSellerOrAdminAuth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (user?.role === 'admin') { req.user = user; req.admin = user; }
    else if (user?.role === 'seller') {
      req.user = user;
      req.seller = await Seller.findOne({ userId: user._id });
    }
  } catch (_) { /* invalid token -> treat as anonymous */ }
  next();
};

// Helper middleware to allow both seller and admin seamlessly
const sellerOrAdminAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'User not found' });

    req.user = user;

    // ── Admin ──────────────────────────────────────────────────────────────
    if (user.role === 'admin') {
      req.admin = user;
      return next();
    }

    // ── Seller (by role) ───────────────────────────────────────────────────
    if (user.role === 'seller') {
      let seller = await Seller.findOne({ userId: user._id });
      if (!seller) {
        seller = await Seller.create({
          userId: user._id,
          businessName: user.businessName || user.name || 'New Seller',
          phone: user.phone || '',
          email: user.email,
        });
      }
      req.seller = seller;
      return requireApprovedForWrites(req, res, next);
    }

    // ── Fallback: check if user has a Seller profile (role may not be updated) ──
    // This handles sellers who signed up as 'user' but have a Seller document
    const sellerByProfile = await Seller.findOne({ userId: user._id });
    if (sellerByProfile) {
      // Auto-upgrade role to 'seller' in DB so future requests are faster
      user.role = 'seller';
      await user.save().catch(() => {}); // non-blocking
      req.seller = sellerByProfile;
      return requireApprovedForWrites(req, res, next);
    }

    return res.status(403).json({ message: 'Access denied. Neither seller nor admin.' });
  } catch (err) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
};

// CRUD
router.get('/', optionalSellerOrAdminAuth, pc.getProducts);
router.post('/', sellerOrAdminAuth, ...s3Upload('image', 'products'), pc.createProduct);
router.put('/:id', sellerOrAdminAuth, ...s3Upload('image', 'products'), pc.updateProduct);

// Status
router.patch('/:id/toggle', sellerOrAdminAuth, pc.toggleAvailability);
router.patch('/:id/out-of-stock', sellerOrAdminAuth, pc.markOutOfStock);
router.patch('/:id/in-stock', sellerOrAdminAuth, pc.markInStock);

// Quick edit
router.patch('/:id/price', sellerOrAdminAuth, pc.updatePrice);
router.patch('/:id/category', sellerOrAdminAuth, pc.updateCategory);
router.patch('/:id/veg-toggle', sellerOrAdminAuth, pc.toggleVeg);

// Bulk
router.post('/bulk/create', sellerOrAdminAuth, pc.bulkCreate);
router.put('/bulk/update', sellerOrAdminAuth, pc.bulkUpdate);
router.post('/bulk/action', sellerOrAdminAuth, pc.bulkAction);

// Duplicate
router.post('/:id/duplicate', sellerOrAdminAuth, pc.duplicateProduct);

// Recycle Bin (Soft Delete)
router.get('/recycle-bin', sellerOrAdminAuth, pc.getRecycleBin);
router.patch('/:id/archive', sellerOrAdminAuth, pc.archiveProduct);
router.patch('/:id/restore', sellerOrAdminAuth, pc.restoreProduct);
router.delete('/recycle-bin/empty', sellerOrAdminAuth, pc.emptyRecycleBin);
router.delete('/:id', sellerOrAdminAuth, pc.hardDeleteProduct);

// Image
router.patch('/:id/image', sellerOrAdminAuth, ...s3Upload('image', 'products'), pc.replaceImage);
router.delete('/:id/image', sellerOrAdminAuth, pc.removeImage);

// Stock / Inventory
router.patch('/:id/stock', sellerOrAdminAuth, pc.updateStock);
router.get('/inventory/low-stock', sellerOrAdminAuth, pc.getLowStockProducts);

// Metrics & Performance (allow both seller and admin)
router.get('/metrics', sellerOrAdminAuth, pc.getInvestorMetrics);
router.get('/health-score', sellerOrAdminAuth, pc.menuHealthScore);
router.get('/:id/performance', sellerOrAdminAuth, pc.getProductPerformance);

// Publish & Happy Hour
router.patch('/:id/publish', sellerAuth, pc.publishProduct);
router.patch('/happy-hour', sellerAuth, pc.setHappyHourDiscount);

module.exports = router;