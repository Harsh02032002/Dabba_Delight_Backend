const router = require('express').Router();
const adminAuth = require('../middleware/admin.middleware');
const ac = require('../controllers/admin.controller');
const oc = require('../controllers/order.controller');
const gstController = require('../controllers/gstSettings.controller');

// Dashboard
router.get('/dashboard', adminAuth, ac.getDashboard);

// Analytics
router.get('/analytics', adminAuth, ac.getAnalytics);
router.get('/analytics/city-wise', adminAuth, ac.getCityWiseRevenue);
router.get('/analytics/category-wise', adminAuth, ac.getCategoryWiseSales);
router.get('/analytics/cart-dropoffs', adminAuth, ac.getCartDropoffs);

// Sellers
router.get('/sellers', adminAuth, ac.getSellers);
router.post('/sellers/:id/approve', adminAuth, ac.approveSeller);
router.post('/sellers/:id/reject', adminAuth, ac.rejectSeller);

// Users
router.get('/users', adminAuth, ac.getUsers);
router.post('/users/:id/block', adminAuth, ac.blockUser);
router.post('/users/:id/unblock', adminAuth, ac.unblockUser);

// Orders
router.get('/orders', adminAuth, oc.getAdminOrders);
// router.post('/orders/:id/refund', adminAuth, oc.refundOrder); // Function not implemented yet

// Disputes
router.get('/disputes', adminAuth, ac.getDisputes);
router.post('/disputes/:id/resolve', adminAuth, ac.resolveDispute);

// Audit Logs
router.get('/audit-logs', adminAuth, ac.getAuditLogs);

// Categories
router.get('/categories', adminAuth, ac.getCategories);
router.post('/categories', adminAuth, ac.createCategory);
router.delete('/categories/:id', adminAuth, ac.deleteCategory);

// Settlements
router.get('/settlements', adminAuth, ac.getSettlements);
router.post('/settlements/:id/process', adminAuth, ac.processSettlement);
router.post('/settlements/bulk-process', adminAuth, ac.bulkProcessSettlements);

// Commission
router.get('/commission', adminAuth, ac.getCommissionConfig);
router.put('/commission', adminAuth, ac.updateCommissionConfig);

// GST (Old routes for backward compatibility)
router.get('/gst', adminAuth, ac.getGSTConfig);
router.put('/gst', adminAuth, ac.updateGSTConfig);

// GST Settings (New comprehensive GST control)
router.get('/gst/settings', adminAuth, gstController.getGSTSettings);
router.put('/gst/settings', adminAuth, gstController.updateGSTSettings);
router.post('/gst/reset', adminAuth, gstController.resetGSTSettings);
router.get('/gst/summary', adminAuth, gstController.getGSTSummary);

// Referrals
router.get('/referrals', adminAuth, ac.getReferrals);
router.get('/referrals/config', adminAuth, ac.getReferralConfig);
router.put('/referrals/config', adminAuth, ac.updateReferralConfig);

// Marketing
router.get('/marketing/campaigns', adminAuth, ac.getCampaigns);
router.post('/marketing/campaigns', adminAuth, ac.createCampaign);
router.get('/marketing/spend', adminAuth, ac.getMarketingSpend);

// Performance
router.get('/performance/sellers', adminAuth, ac.getSellerPerformance);
router.get('/performance/overview', adminAuth, ac.getPerformanceOverview);

// Platform Config
router.get('/config', adminAuth, ac.getPlatformConfig);
router.put('/config', adminAuth, ac.updatePlatformConfig);

module.exports = router;
