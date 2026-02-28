import User from "../user/user.model.js";
import Order from "../order/order.model.js";
import Product from "../product/product.model.js";
import Cart from "../cart/cart.model.js";
import Analytics from "../analytics/analytics.model.js";
import Settlement from "../settlement/settlement.model.js";
//import Config from "../config/config.model.js";
import MarketingCampaign from "../marketing/marketingCampaign.model.js";
//import AuditLog from "../auditlog/auditlog.model.js";
//import Dispute from "../dispute/dispute.model.js";
//import Category from "../category/category.model.js";
import mongoose from "mongoose";
import { getIO } from "../../socket.js";

const io = getIO();

// Simple error helper
const sendError = (res, status = 500, message = "Server error", err = null) => {
  console.error(message, err);
  res.status(status).json({ success: false, message, error: err?.message });
};

export const getDashboard = async (req, res) => {
  try {
    const stats = {
      totalSellers: await User.countDocuments({ role: "seller" }),
      totalUsers: await User.countDocuments({ role: "user" }),
      totalOrders: await Order.countDocuments(),
      totalRevenue: await Order.aggregate([
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]).then((r) => r[0]?.total || 0),
      // More: pending KYC, etc.
    };
    const revenueData = []; // Aggregate by date
    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(5);
    const topSellers = await User.find({ role: "seller" })
      .sort({ revenue: -1 })
      .limit(5); // Assume revenue field or aggregate
    res.json({ stats, revenueData, recentOrders, topSellers });
  } catch (err) {
    sendError(res, 500, "Dashboard fetch failed", err);
  }
};
export const getAnalytics = async (req, res) => {
  try {
    const { period } = req.query;
    const analytics =
      (await Analytics.findOne({ isGlobal: true, period })) ||
      {
        /* aggregate from orders */
      };
    res.json(analytics);
  } catch (err) {
    sendError(res, 500, "Analytics fetch failed", err);
  }
};

// Similar for cityWise, categoryWise, cartDropoffs
export const getCityWiseRevenue = async (req, res) => {
  try {
    const pipeline = [
      { $match: { status: { $ne: "cancelled" } } },
      {
        $group: {
          _id: "$deliveryAddress.city",
          orders: { $sum: 1 },
          revenue: { $sum: "$total" },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 50 },
    ];
    const result = await Order.aggregate(pipeline);
    res.json(result);
  } catch (err) {
    sendError(res, 500, "City-wise revenue failed", err);
  }
};
export const getCategoryWiseSales = async (req, res) => {
  try {
    const pipeline = [
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.productId",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $group: {
          _id: "$product.category",
          quantity: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { revenue: -1 } },
    ];
    const result = await Order.aggregate(pipeline);
    res.json(result);
  } catch (err) {
    sendError(res, 500, "Category-wise sales failed", err);
  }
};
export const getCartDropoffs = async (req, res) => {
  try {
    const days = Number(req.query.days || 7);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const carts = await Cart.find();
    const dropoffs = [];
    for (const c of carts) {
      const converted = await Order.findOne({
        userId: c.userId,
        createdAt: { $gte: since },
      });
      if (!converted && c.items && c.items.length > 0) {
        dropoffs.push({ cartId: c._id, userId: c.userId, items: c.items });
      }
      if (dropoffs.length >= 100) break;
    }
    res.json({ count: dropoffs.length, dropoffs });
  } catch (err) {
    sendError(res, 500, "Cart dropoffs failed", err);
  }
};
export const getSellerPerformance = async (req, res) => {
  try {
    const sellers = await User.find({ role: "seller" }).sort({ revenue: -1 });
    res.json(sellers);
  } catch (err) {
    sendError(res, 500, "Performance fetch failed", err);
  }
};

export const getPerformanceOverview = async (req, res) => {
  try {
    const overview = {
      /* global metrics */
    };
    res.json(overview);
  } catch (err) {
    sendError(res, 500, "Overview fetch failed", err);
  }
};
export const getSettlements = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const settlements = await Settlement.find(filter);
    res.json(settlements);
  } catch (err) {
    sendError(res, 500, "Settlements fetch failed", err);
  }
};

export const processSettlement = async (req, res) => {
  try {
    const settlement = await Settlement.findByIdAndUpdate(
      req.params.id,
      { status: "settled", processedBy: req.user._id },
      { new: true },
    );
    // Emit real-time
    io.to(`seller:${settlement.sellerId}`).emit(
      "settlementProcessed",
      settlement,
    );
    res.json(settlement);
  } catch (err) {
    sendError(res, 400, "Process failed", err);
  }
};
export const getSellers = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { kycStatus: status } : {};
    const sellers = await User.find({ role: "seller", ...filter });
    res.json(sellers);
  } catch (err) {
    sendError(res, 500, "Sellers fetch failed", err);
  }
};

export const approveSeller = async (req, res) => {
  try {
    const seller = await User.findByIdAndUpdate(
      req.params.id,
      { kycStatus: "verified" },
      { new: true },
    );
    await AuditLog.create({
      adminId: req.user._id,
      action: "approved seller",
      targetId: req.params.id,
    });
    io.to(`seller:${req.params.id}`).emit("kycApproved");
    res.json(seller);
  } catch (err) {
    sendError(res, 400, "Approve failed", err);
  }
};

// Similar for reject
export const rejectSeller = async (req, res) => {
  try {
    const seller = await User.findByIdAndUpdate(
      req.params.id,
      { kycStatus: "rejected" },
      { new: true },
    );
    await AuditLog.create({
      adminId: req.user._id,
      action: "rejected seller",
      targetId: req.params.id,
    });
    io.to(`seller:${req.params.id}`).emit("kycRejected");
    res.json(seller);
  } catch (err) {
    sendError(res, 400, "Reject failed", err);
  }
};
export const getUsers = async (req, res) => {
  try {
    const { search, status } = req.query;
    const filter = {};
    if (search)
      filter.$or = [
        { name: { $regex: search } },
        { email: { $regex: search } },
      ];
    if (status) filter.isBlocked = status === "blocked";
    const users = await User.find({ role: "user", ...filter });
    res.json(users);
  } catch (err) {
    sendError(res, 500, "Users fetch failed", err);
  }
};

export const blockUser = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBlocked: true });
    await AuditLog.create({
      adminId: req.user._id,
      action: "blocked user",
      targetId: req.params.id,
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "Block failed", err);
  }
};
export const unblockUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBlocked: false },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await AuditLog.create({
      adminId: req.user._id,
      action: "unblocked user",
      targetId: req.params.id,
    });

    res.json({
      success: true,
      message: "User unblocked successfully",
      user,
    });
  } catch (err) {
    sendError(res, 400, "Unblock failed", err);
  }
};
export const getOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const orders = await Order.find(filter);
    res.json(orders);
  } catch (err) {
    sendError(res, 500, "Orders fetch failed", err);
  }
};

export const refundOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { paymentStatus: "refunded" },
      { new: true },
    );
    io.to(`seller:${order.sellerId}`).emit("orderRefunded", order);
    res.json(order);
  } catch (err) {
    sendError(res, 400, "Refund failed", err);
  }
};
export const getCommissionConfig = async (req, res) => {
  try {
    const config = (await Config.findOne({ type: "commission" })) || {
      type: "commission",
      percentage: 10,
      tiers: [
        { min: 0, max: 10000, rate: 10 },
        { min: 10001, max: 50000, rate: 8 },
      ],
    };
    res.json(config);
  } catch (err) {
    sendError(res, 500, "Config fetch failed", err);
  }
};

export const updateCommissionConfig = async (req, res) => {
  try {
    await Config.updateOne({ type: "commission" }, req.body, { upsert: true });
    await AuditLog.create({
      adminId: req.user._id,
      action: "updated commission config",
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "Update failed", err);
  }
};
// GST config
export const getGSTConfig = async (req, res) => {
  try {
    const config = (await Config.findOne({ type: "gst" })) || {
      type: "gst",
      rate: 18,
    };
    res.json(config);
  } catch (err) {
    sendError(res, 500, "GST config fetch failed", err);
  }
};

export const updateGSTConfig = async (req, res) => {
  try {
    await Config.updateOne({ type: "gst" }, req.body, { upsert: true });
    await AuditLog.create({
      adminId: req.user._id,
      action: "updated gst config",
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "GST update failed", err);
  }
};
// getGSTConfig, updateGSTConfig – similar logic
export const getReferrals = async (req, res) => {
  try {
    const { status } = req.query;
    // Assume Referral model or aggregate from User
    const pipeline = [
      { $match: { referredBy: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: "$referredBy",
          count: { $sum: 1 },
          users: { $push: { id: "$_id", name: "$name", email: "$email" } },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "referrer",
        },
      },
      { $unwind: "$referrer" },
      {
        $project: {
          referrer: {
            _id: "$referrer._id",
            name: "$referrer.name",
            email: "$referrer.email",
          },
          count: 1,
          users: 1,
        },
      },
      { $sort: { count: -1 } },
    ];
    const referrals = await User.aggregate(pipeline);
    res.json(referrals);
  } catch (err) {
    sendError(res, 500, "Referrals fetch failed", err);
  }
};

export const updateReferralConfig = async (req, res) => {
  try {
    await Config.updateOne({ type: "referral" }, req.body, { upsert: true });
    await AuditLog.create({
      adminId: req.user._id,
      action: "updated referral config",
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "Referral update failed", err);
  }
};

// updateReferralConfig similar to commission
export const getCampaigns = async (req, res) => {
  try {
    const campaigns = await MarketingCampaign.find(); // Global for admin
    res.json(campaigns);
  } catch (err) {
    sendError(res, 500, "Campaigns fetch failed", err);
  }
};

// createCampaign similar to seller's, but global
export const createCampaign = async (req, res) => {
  try {
    const campaign = await MarketingCampaign.create({
      ...req.body,
      createdBy: req.user._id,
    });
    res.status(201).json(campaign);
  } catch (err) {
    sendError(res, 400, "Create campaign failed", err);
  }
};

export const getPlatformConfig = async (req, res) => {
  try {
    const config = (await Config.findOne({ type: "platform" })) || {
      type: "platform",
      maintenanceMode: false,
      allowedOrigins: [process.env.SOCKET_IO_ORIGIN || "*"],
      features: { referrals: true, promotions: true, kyc: true },
    };
    res.json(config);
  } catch (err) {
    sendError(res, 500, "Config fetch failed", err);
  }
};

export const updatePlatformConfig = async (req, res) => {
  try {
    await Config.updateOne({ type: "platform" }, req.body, { upsert: true });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "Update failed", err);
  }
};
export const getDisputes = async (req, res) => {
  try {
    const disputes = await Dispute.find();
    res.json(disputes);
  } catch (err) {
    sendError(res, 500, "Disputes fetch failed", err);
  }
};

export const resolveDispute = async (req, res) => {
  try {
    const { status, resolution } = req.body;
    const dispute = await Dispute.findByIdAndUpdate(
      req.params.id,
      { status, resolution, resolvedBy: req.user._id },
      { new: true },
    );
    io.to(`seller:${dispute.sellerId}`).emit("disputeResolved", dispute);
    res.json(dispute);
  } catch (err) {
    sendError(res, 400, "Resolve failed", err);
  }
};
export const getAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    sendError(res, 500, "Logs fetch failed", err);
  }
};
export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (err) {
    sendError(res, 500, "Categories fetch failed", err);
  }
};

export const createCategory = async (req, res) => {
  try {
    const category = await Category.create(req.body);
    res.status(201).json(category);
  } catch (err) {
    sendError(res, 400, "Create failed", err);
  }
};

// deleteCategory, updateCategory similar
