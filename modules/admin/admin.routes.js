import express from "express";
const router = express.Router();
import * as adminCtrl from "./admin.controller.js";
import { protect, isAdmin } from "../../middlewares/auth.middleware.js"; // Add isAdmin middleware if needed

router.use(protect, isAdmin); // Protect all admin routes

// Dashboard
router.get("/dashboard", adminCtrl.getDashboard);

// Analytics
router.get("/analytics", adminCtrl.getAnalytics);
router.get("/analytics/city-wise", adminCtrl.getCityWiseRevenue);
// ... other analytics

// Performance
router.get("/performance/sellers", adminCtrl.getSellerPerformance);
router.get("/performance/overview", adminCtrl.getPerformanceOverview);

// Settlements
router.get("/settlements", adminCtrl.getSettlements);
router.post("/settlements/:id/process", adminCtrl.processSettlement);

// Sellers
router.get("/sellers", adminCtrl.getSellers);
router.post("/sellers/:id/approve", adminCtrl.approveSeller);
router.post("/sellers/:id/reject", adminCtrl.rejectSeller);

// Users
router.get("/users", adminCtrl.getUsers);
router.post("/users/:id/block", adminCtrl.blockUser);
router.post("/users/:id/unblock", adminCtrl.unblockUser);

// Orders
router.get("/orders", adminCtrl.getOrders);
router.post("/orders/:id/refund", adminCtrl.refundOrder);

/* Commission
router.get("/commission", adminCtrl.getCommissionConfig);
router.put("/commission", adminCtrl.updateCommissionConfig);*/

/* GST
router.get("/gst", adminCtrl.getGSTConfig);
router.put("/gst", adminCtrl.updateGSTConfig);*/

// Referrals
router.get("/referrals", adminCtrl.getReferrals);
router.put("/referrals/config", adminCtrl.updateReferralConfig);

// Marketing
router.get("/marketing/campaigns", adminCtrl.getCampaigns);
router.post("/marketing/campaigns", adminCtrl.createCampaign);

// Settings
router.get("/config", adminCtrl.getPlatformConfig);
router.put("/config", adminCtrl.updatePlatformConfig);

/*New: Disputes
router.get("/disputes", adminCtrl.getDisputes);
router.post("/disputes/:id/resolve", adminCtrl.resolveDispute);*/

/*New: Audit Logs
router.get("/audit-logs", adminCtrl.getAuditLogs);*/

/* New: Categories
router.get("/categories", adminCtrl.getCategories);
router.post("/categories", adminCtrl.createCategory);
router.delete("/categories/:id", adminCtrl.deleteCategory);*/

export default router;
