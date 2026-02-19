import User from "../user/user.model.js";
import Order from "../order/order.model.js";
import Product from "../product/product.model.js";
import Settlement from "../settlement/settlement.model.js";
import Notification from "../notification/notification.model.js";
import Analytics from "../analytics/analytics.model.js";
import OpenAI from "openai"; // For AI suggestions
import { sendEmail } from "../../utils/email.js"; // Nodemailer helper
import { sendSMS } from "../../utils/sms.js"; // Twilio helper
import NotificationPreference from "../notificationpreferences/notificationprefer.model.js"; // For notification settings
import SupportTicket from "../support_ticket/supportticket.model.js";
import bcrypt from "bcryptjs";
let openaiClient = null;
const getOpenAI = () => {
  if (openaiClient) return openaiClient;
  if (!process.env.OPENAI_API_KEY) return null;
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
};

// Error Helper
const sendError = (res, status = 500, message = "Server error", err = null) => {
  console.error(message, err);
  res.status(status).json({ success: false, message, error: err?.message });
};

// Dashboard
export const getDashboard = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const stats = {
      todayRevenue: await Order.aggregate([
        {
          $match: {
            sellerId,
            createdAt: { $gte: new Date(new Date().setHours(0, 0, 0)) },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]).then((r) => r[0]?.total || 0),
      todayOrders: await Order.countDocuments({
        sellerId,
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0)) },
      }),
      revenueGrowth: 12.5, // Calculate real diff from yesterday
      averageRating: 4.5, // Aggregate from orders
    };
    const revenueData = []; // Aggregate by day/week
    const recentOrders = await Order.find({ sellerId })
      .sort({ createdAt: -1 })
      .limit(5);
    const topItems = await Product.find({ sellerId })
      .sort({ orderCount: -1 })
      .limit(5);
    res.json({ stats, revenueData, recentOrders, topItems });
  } catch (err) {
    sendError(res, 500, "Dashboard fetch failed", err);
  }
};

// Profile
export const getProfile = async (req, res) => {
  try {
    const profile = await User.findById(req.user._id).select("-password");
    res.json(profile);
  } catch (err) {
    sendError(res, 500, "Profile fetch failed", err);
  }
};

export const updateProfile = async (req, res) => {
  try {
    const updated = await User.findByIdAndUpdate(req.user._id, req.body, {
      new: true,
    }).select("-password");
    res.json(updated);
  } catch (err) {
    sendError(res, 400, "Profile update failed", err);
  }
};

// Earnings
export const getEarnings = async (req, res) => {
  try {
    const { period } = req.query;
    const earnings = {
      totalEarnings: 50000, // Aggregate from settlements
      totalCommission: 5000,
      commissionBreakdown: [], // By date
      recentTransactions: [], // From settlements
    };
    res.json(earnings);
  } catch (err) {
    sendError(res, 500, "Earnings fetch failed", err);
  }
};

// Analytics
export const getAnalytics = async (req, res) => {
  try {
    const { period } = req.query;
    // Use Analytics model for cached data, or aggregate from Orders/Products
    const analytics =
      (await Analytics.findOne({ sellerId: req.user._id, period })) ||
      {
        /* default */
      };
    res.json(analytics);
  } catch (err) {
    sendError(res, 500, "Analytics fetch failed", err);
  }
};

export const getTopItems = async (req, res) => {
  try {
    const topItems = await Product.find({ sellerId: req.user._id })
      .sort({ orderCount: -1 })
      .limit(5);
    res.json(topItems);
  } catch (err) {
    sendError(res, 500, "Top items fetch failed", err);
  }
};

export const getPeakHours = async (req, res) => {
  try {
    const peak = {
      /* Aggregate Orders by hour */
    };
    res.json(peak);
  } catch (err) {
    sendError(res, 500, "Peak hours fetch failed", err);
  }
};

export const getRepeatCustomers = async (req, res) => {
  try {
    const repeat = { percentage: 30, count: 50 }; // Aggregate unique users with >1 order
    res.json(repeat);
  } catch (err) {
    sendError(res, 500, "Repeat customers fetch failed", err);
  }
};

// NEW: AI Suggestions (Awesome Profit Booster)
export const getAISuggestions = async (req, res) => {
  try {
    const analytics = await getAnalytics(req); // Reuse
    const prompt = `Based on this seller analytics: ${JSON.stringify(analytics)}, suggest 3 ways to increase profit by 20%.`;
    const client = getOpenAI();
    if (!client) return sendError(res, 500, "OpenAI API key not configured");
    const response = await client.completions.create({
      model: "text-davinci-003",
      prompt,
      max_tokens: 200,
    });
    res.json({ suggestions: response.choices[0].text });
  } catch (err) {
    sendError(res, 500, "AI suggestions failed", err);
  }
};

// Settlements
export const getSettlements = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { sellerId: req.user._id };
    if (status && status !== "all") filter.status = status;
    const settlements = await Settlement.find(filter).sort({ createdAt: -1 });
    res.json(settlements);
  } catch (err) {
    sendError(res, 500, "Settlements fetch failed", err);
  }
};

// KYC
export const getKYCStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ kycStatus: user.kycStatus, kycDocuments: user.kycDocuments });
  } catch (err) {
    sendError(res, 500, "KYC status fetch failed", err);
  }
};

export const uploadKYCDocument = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.kycDocuments.push({
      type: req.body.type,
      uploadedAt: new Date(),
      url: req.uploadedImageUrl,
    }); // Assuming image middleware
    await user.save();
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "KYC upload failed", err);
  }
};

export const submitKYC = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.kycDocuments.length < 4)
      return sendError(res, 400, "Upload all required documents");
    user.kycStatus = "submitted";
    await user.save();
    // Send admin notification/email
    await sendEmail(
      "admin@dabbanation.com",
      "New KYC Submission",
      `Seller ${user.name} submitted KYC`,
    );
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "KYC submit failed", err);
  }
};

// Notifications (Awesome Feature)
export const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({
      userId: req.user._id,
      isRead: false,
    })
      .sort({ createdAt: -1 })
      .limit(20);
    res.json(notifications);
  } catch (err) {
    sendError(res, 500, "Notifications fetch failed", err);
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "Mark read failed", err);
  }
};

// Low Stock Alerts (Awesome Feature)
export const getLowStockAlerts = async (req, res) => {
  try {
    const lowStock = await Product.find({
      sellerId: req.user._id,
      stock: { $lte: "$lowStockThreshold" },
    });
    // Auto-notify if new low stock
    if (lowStock.length > 0) {
      await Notification.create({
        userId: req.user._id,
        type: "low_stock",
        message: `${lowStock.length} items low on stock!`,
      });
      await sendSMS(req.user.phone, "Low stock alert on Dabba Nation!");
    }
    res.json(lowStock);
  } catch (err) {
    sendError(res, 500, "Low stock alerts failed", err);
  }
};

// Referrals (Awesome Profit Booster)
export const getReferrals = async (req, res) => {
  try {
    const referrals = await User.find({ referredBy: req.user._id });
    const bonus = referrals.length * 500; // e.g., ₹500 per referral
    res.json({ referrals, bonus });
  } catch (err) {
    sendError(res, 500, "Referrals fetch failed", err);
  }
};

export const generateReferralCode = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ code: user.referralCode });
  } catch (err) {
    sendError(res, 500, "Referral code failed", err);
  }
};
// Get Notification Preferences
export const getNotificationPreferences = async (req, res) => {
  try {
    let prefs = await NotificationPreference.findOne({ userId: req.user._id });
    if (!prefs) {
      prefs = await NotificationPreference.create({ userId: req.user._id });
    }
    res.json(prefs);
  } catch (err) {
    sendError(res, 500, "Preferences fetch failed", err);
  }
};

// Update Notification Preferences
export const updateNotificationPreferences = async (req, res) => {
  try {
    const prefs = await NotificationPreference.findOneAndUpdate(
      { userId: req.user._id },
      { $set: req.body },
      { new: true, upsert: true },
    );
    res.json(prefs);
  } catch (err) {
    sendError(res, 400, "Preferences update failed", err);
  }
};

// Change Password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Assuming you have bcrypt in your auth setup
    const user = await User.findById(req.user._id).select("+password");
    if (!user) return sendError(res, 404, "User not found");

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return sendError(res, 401, "Current password incorrect");

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    sendError(res, 400, "Password change failed", err);
  }
};
// Create Support Ticket
export const createSupportTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.create({
      ...req.body,
      sellerId: req.user._id,
    });

    // Send email to support
    await sendEmail(
      "seller-support@dabbanation.com",
      `New Support Ticket: ${ticket.subject}`,
      `Seller: ${req.user.name}\nCategory: ${ticket.category}\nMessage: ${ticket.message}`,
    );

    // Notify seller
    await Notification.create({
      userId: req.user._id,
      type: "support",
      message: `Your ticket "${ticket.subject}" has been created. Ticket ID: #${ticket._id}`,
    });

    res.status(201).json({ success: true, ticket });
  } catch (err) {
    sendError(res, 400, "Ticket creation failed", err);
  }
};

// Get My Tickets
export const getMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ sellerId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20);
    res.json(tickets);
  } catch (err) {
    sendError(res, 500, "Tickets fetch failed", err);
  }
};

// Add Response to Ticket (seller reply)
export const addTicketResponse = async (req, res) => {
  try {
    const { ticketId, message } = req.body;
    const ticket = await SupportTicket.findOneAndUpdate(
      { _id: ticketId, sellerId: req.user._id },
      { $push: { responses: { from: "seller", message } } },
      { new: true },
    );
    if (!ticket) return sendError(res, 404, "Ticket not found");

    // Notify support team
    await sendEmail(
      "seller-support@dabbanation.com",
      `Reply on Ticket #${ticketId}`,
      message,
    );

    res.json(ticket);
  } catch (err) {
    sendError(res, 400, "Response failed", err);
  }
};
// Get Insights
export const getPerformanceInsights = async (req, res) => {
  try {
    const insights = await Analytics.findOne({ sellerId: req.user._id });
    // AI tip
    const prompt = `Give 3 performance tips based on: ${JSON.stringify(insights)}`;
    const client = getOpenAI();
    if (!client) return sendError(res, 500, "OpenAI API key not configured");
    const response = await client.completions.create({
      model: "text-davinci-003",
      prompt,
      max_tokens: 150,
    });
    insights.aiInsights = response.choices[0].text.split("\n");
    res.json(insights);
  } catch (err) {
    sendError(res, 500, "Insights fetch failed", err);
  }
};
