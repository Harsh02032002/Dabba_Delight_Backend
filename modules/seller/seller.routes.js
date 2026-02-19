import express from "express";
import { protect } from "../../middlewares/auth.middleware.js"; // Your JWT
import * as sellerCtrl from "./seller.controller.js";
import * as orderCtrl from "../order/order.controller.js";
import productRoutes from "../product/product.routes.js"; // Import existing for menu
import { handleImageUpload } from "../../middlewares/image.middleware.js";
import * as reviewCtrl from "../review/reviews.controller.js";
import * as inventoryCtrl from "../inventory/inventory.controller.js";
import * as marketingCtrl from "../marketing/markiting.controller.js";
import * as payoutCtrl from "../payout/payout.controller.js";
import * as promotionCtrl from "../promotion/promotion.controller.js";
import * as customersCtrl from "../customers/customers.controller.js";
const router = express.Router();

// Dashboard
router.get("/dashboard", protect, sellerCtrl.getDashboard);

// Orders
router.get("/orders", protect, orderCtrl.getOrders);
router.patch("/orders/:id/status", protect, orderCtrl.updateOrderStatus);

// Menu (Use existing product routes, but prefix for seller)
router.use("/menu", protect, productRoutes); // e.g., /seller/menu gets seller's products

// Profile
router.get("/profile", protect, sellerCtrl.getProfile);
router.put("/profile", protect, sellerCtrl.updateProfile);

// Earnings
router.get("/earnings", protect, sellerCtrl.getEarnings);

// Analytics
router.get("/analytics", protect, sellerCtrl.getAnalytics);
router.get("/analytics/top-items", protect, sellerCtrl.getTopItems);
router.get("/analytics/peak-hours", protect, sellerCtrl.getPeakHours);
router.get(
  "/analytics/repeat-customers",
  protect,
  sellerCtrl.getRepeatCustomers,
);
router.get("/analytics/ai-suggestions", protect, sellerCtrl.getAISuggestions); // NEW

// Settlements
router.get("/settlements", protect, sellerCtrl.getSettlements);

// KYC
router.get("/kyc", protect, sellerCtrl.getKYCStatus);
router.post(
  "/kyc/document",
  protect,
  handleImageUpload,
  sellerCtrl.uploadKYCDocument,
);
router.post("/kyc/submit", protect, sellerCtrl.submitKYC);

// Notifications
router.get("/notifications", protect, sellerCtrl.getNotifications);
router.patch(
  "/notifications/:id/read",
  protect,
  sellerCtrl.markNotificationRead,
);

// Inventory Alerts
router.get("/inventory/low-stock", protect, sellerCtrl.getLowStockAlerts);

// Referrals
router.get("/referrals", protect, sellerCtrl.getReferrals);
router.post("/referrals/code", protect, sellerCtrl.generateReferralCode);
// Settings - Notifications
router.get(
  "/settings/notifications",
  protect,
  sellerCtrl.getNotificationPreferences,
);
router.put(
  "/settings/notifications",
  protect,
  sellerCtrl.updateNotificationPreferences,
);

// Settings - Password
router.post("/settings/password", protect, sellerCtrl.changePassword);
// Help & Support
router.post("/support/tickets", protect, sellerCtrl.createSupportTicket);
router.get("/support/tickets", protect, sellerCtrl.getMyTickets);
router.post("/support/tickets/response", protect, sellerCtrl.addTicketResponse);
// Promotions
router.get("/promotions", protect, promotionCtrl.getPromotions);
router.post("/promotions", protect, promotionCtrl.createPromotion);
router.patch("/promotions/:id/toggle", protect, promotionCtrl.togglePromotion);

// Reviews
router.get("/reviews", protect, reviewCtrl.getReviews);
router.post("/reviews/:id/reply", protect, reviewCtrl.replyToReview);

// Inventory
router.get("/inventory", protect, inventoryCtrl.getInventory);
router.post("/inventory/update", protect, inventoryCtrl.updateStock);
router.get("/inventory/expiry-alerts", protect, inventoryCtrl.getExpiryAlerts);

// Customers
router.get("/customers", protect, customersCtrl.getCustomers);
router.post(
  "/customers/award-points",
  protect,
  customersCtrl.awardLoyaltyPoints,
);

// Marketing
router.get("/marketing/campaigns", protect, marketingCtrl.getCampaigns);
router.post("/marketing/campaigns", protect, marketingCtrl.createCampaign);

// Payout History
router.get("/payouts", protect, payoutCtrl.getPayouts);
router.post("/payouts/request", protect, payoutCtrl.requestPayout);

// Performance Insights
router.get("/performance-insights", protect, sellerCtrl.getPerformanceInsights);
export default router;
