const express = require('express');
const auth = require('../middleware/auth.middleware');
const adminAuth = require('../middleware/admin.middleware');
const subscriptionController = require('../controllers/subscription.controller');
const { s3Upload, s3UploadMultiple } = require('../middleware/s3-upload.middleware');

const router = express.Router();

// ============= USER ROUTES =============

// Get active subscription for logged in user
router.get('/active', auth, subscriptionController.getActiveForUser);

// Get user's all subscriptions with seller details
router.get('/my-subscriptions', auth, subscriptionController.getMySubscriptions);

// Get all available subscription plans
router.get('/plans', auth, subscriptionController.getAvailablePlans);

// Purchase a subscription
router.post('/purchase', auth, subscriptionController.purchase);

// Get user's subscription history
router.get('/history', auth, subscriptionController.getUserSubscriptionHistory);

// Validate subscription for current order context
router.get('/validate/:sellerId', auth, subscriptionController.validateForOrder);

// Get subscription items for user (food items in their subscription)
router.get('/my-items', auth, subscriptionController.getMySubscriptionItems);

// Place order directly from subscription items
router.post('/place-order', auth, subscriptionController.placeOrderFromSubscription);

// ============= ADMIN ROUTES =============

// Debug middleware for form-data
const debugFormData = (req, res, next) => {
  console.log('=== ROUTE DEBUG ===');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  next();
};

// Get all subscription plans (admin) - alias for /admin/all
router.get('/admin/plans', auth, adminAuth, subscriptionController.adminGetAllPlans);

// Get all subscription plans (admin)
router.get('/admin/all', auth, adminAuth, subscriptionController.adminGetAllPlans);

// Debug middleware after multer
const debugAfterMulter = (req, res, next) => {
  console.log('=== AFTER MULTER DEBUG ===');
  console.log('req.body:', req.body);
  console.log('req.file:', req.file);
  next();
};

// Create new subscription plan with image upload
router.post('/admin/plans', auth, adminAuth, debugFormData, 
  ...s3Upload('image', 'subscriptions'), 
  debugAfterMulter, 
  subscriptionController.adminCreatePlan);

// Update subscription plan with image upload  
router.put('/admin/plans/:id', auth, adminAuth, debugFormData, 
  ...s3Upload('image', 'subscriptions'), 
  debugAfterMulter, 
  subscriptionController.adminUpdatePlan);

// Delete subscription plan
router.delete('/admin/plans/:id', auth, adminAuth, subscriptionController.adminDeletePlan);

// Get all user subscriptions
router.get('/admin/subscriptions', auth, adminAuth, subscriptionController.adminListSubscriptions);

// Get all subscription usage
router.get('/admin/usage', auth, adminAuth, subscriptionController.adminListUsage);

// Assign subscription to user manually
router.post('/admin/assign', auth, adminAuth, subscriptionController.adminAssignSubscription);

// Adjust subscription (add balance/days)
router.post('/admin/adjust', auth, adminAuth, subscriptionController.adminAdjustSubscription);

// Force expire subscription
router.post('/admin/expire', auth, adminAuth, subscriptionController.adminForceExpire);

// Get subscription statistics
router.get('/admin/stats', auth, adminAuth, subscriptionController.adminGetStats);

module.exports = router;
