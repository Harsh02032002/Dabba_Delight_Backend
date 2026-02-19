import Order from "../order/order.model.js";
import User from "../user/user.model.js";

// Simple error helper
const sendError = (res, status = 500, message = "Server error", err = null) => {
  console.error(message, err);
  res.status(status).json({ success: false, message, error: err?.message });
};

// Get Customers
export const getCustomers = async (req, res) => {
  try {
    const customers = await Order.aggregate([
      { $match: { sellerId: req.user._id } },
      {
        $group: {
          _id: "$userId",
          orderCount: { $sum: 1 },
          totalSpent: { $sum: "$total" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      { $project: { _id: 0, user: 1, orderCount: 1, totalSpent: 1 } },
    ]);
    res.json(customers);
  } catch (err) {
    sendError(res, 500, "Customers fetch failed", err);
  }
};

// Award Loyalty Points
export const awardLoyaltyPoints = async (req, res) => {
  try {
    const { userId, points } = req.body;
    await User.findByIdAndUpdate(userId, { $inc: { loyaltyPoints: points } });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 400, "Points award failed", err);
  }
};
