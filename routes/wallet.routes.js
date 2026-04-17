const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.middleware');
const adminAuth = require('../middleware/admin.middleware');
const sellerAuth = require('../middleware/seller.middleware');
const walletController = require('../controllers/wallet.controller');

// ============= ADMIN ROUTES =============

// Get admin wallet stats and dashboard
router.get('/admin/stats', auth, adminAuth, walletController.getAdminWalletStats);

// Get seller wallet details (admin view)
router.get('/admin/seller/:sellerId', auth, adminAuth, walletController.getSellerWallet);

// Trigger payout to seller
router.post('/admin/payout', auth, adminAuth, walletController.triggerPayout);

// Trigger bulk payout to multiple sellers
router.post('/admin/bulk-payout', auth, adminAuth, walletController.triggerBulkPayout);

// Get financial reports
router.get('/admin/reports', auth, adminAuth, walletController.getFinancialReports);

// ============= SELLER ROUTES =============

// Get own wallet details
router.get('/seller/my-wallet', auth, sellerAuth, async (req, res) => {
  // Override sellerId with logged in seller's ID
  req.params.sellerId = req.seller._id;
  return walletController.getSellerWallet(req, res);
});

// ============= WEBHOOK ROUTES (For Razorpay callbacks) =============

// Payout status webhook
router.post('/webhooks/payout', async (req, res) => {
  try {
    const { payload } = req.body;
    
    // Verify webhook signature here
    // Update payout status in database
    
    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
