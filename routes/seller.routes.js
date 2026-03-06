const router = require('express').Router();
const sellerAuth = require('../middleware/seller.middleware');
const { s3Upload } = require('../middleware/s3-upload.middleware');
const sc = require('../controllers/seller.controller');
const oc = require('../controllers/order.controller');

// Dashboard
router.get('/dashboard', sellerAuth, sc.getDashboard);

// Orders
router.get('/orders', sellerAuth, oc.getSellerOrders);
router.patch('/orders/:id/status', sellerAuth, oc.updateOrderStatus);

// Analytics
router.get('/analytics', sellerAuth, sc.getAnalytics);
router.get('/analytics/top-items', sellerAuth, sc.getTopItems);
router.get('/analytics/peak-hours', sellerAuth, sc.getPeakHours);
router.get('/analytics/repeat-customers', sellerAuth, sc.getRepeatCustomers);
router.get('/analytics/ai-suggestions', sellerAuth, sc.getAISuggestions);

// Earnings
router.get('/earnings', sellerAuth, sc.getEarnings);

// Settlements
router.get('/settlements', sellerAuth, sc.getSettlements);

// KYC
router.get('/kyc', sellerAuth, sc.getKYCStatus);
// Upload KYC documents directly to S3 (field: "document")
router.post('/kyc/document', sellerAuth, ...s3Upload('document', 'kyc-docs'), sc.uploadKYCDocument);
router.post('/kyc/submit', sellerAuth, sc.submitKYC);

// Referrals
router.get('/referrals', sellerAuth, sc.getReferrals);
router.post('/referrals/code', sellerAuth, sc.generateReferralCode);

// Promotions
router.get('/promotions', sellerAuth, sc.getPromotions);
router.post('/promotions', sellerAuth, sc.createPromotion);
router.patch('/promotions/:id/toggle', sellerAuth, sc.togglePromotion);

// Reviews
router.get('/reviews', sellerAuth, sc.getReviews);
router.post('/reviews/:id/reply', sellerAuth, sc.replyToReview);

// Inventory
router.get('/inventory', sellerAuth, sc.getInventory);
router.get('/inventory/expiry-alerts', sellerAuth, sc.getExpiryAlerts);

// Customers
router.get('/customers', sellerAuth, sc.getCustomers);
router.post('/customers/award-points', sellerAuth, sc.awardLoyaltyPoints);

// Marketing
router.get('/marketing/campaigns', sellerAuth, sc.getCampaigns);
router.post('/marketing/campaigns', sellerAuth, sc.createCampaign);

// Payouts
router.get('/payouts', sellerAuth, sc.getPayouts);
router.post('/payouts/request', sellerAuth, sc.requestPayout);

// Performance
router.get('/performance-insights', sellerAuth, sc.getPerformanceInsights);

// Profile
router.get('/profile', sellerAuth, sc.getProfile);
router.put('/profile', sellerAuth, sc.updateProfile);

// Settings
router.get('/settings/notifications', sellerAuth, sc.getNotificationPreferences);
router.put('/settings/notifications', sellerAuth, sc.updateNotificationPreferences);
router.post('/settings/password', sellerAuth, sc.changePassword);

// Support
router.post('/support/tickets', sellerAuth, sc.createSupportTicket);
router.get('/support/tickets', sellerAuth, sc.getMyTickets);
router.post('/support/tickets/response', sellerAuth, sc.addTicketResponse);

// Notifications
router.get('/notifications', sellerAuth, sc.getNotifications);
router.patch('/notifications/:id/read', sellerAuth, sc.markNotificationRead);

module.exports = router;
