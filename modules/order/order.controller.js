import Order from "./order.model.js";
import Notification from "../notification/notification.model.js";
import { sendSMS } from "../../utils/sms.js"; // Twilio helper

// Get Orders
export const getOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { sellerId: req.user._id };
    if (status && status !== "all") filter.status = status;
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ orders });
  } catch (err) {
    sendError(res, 500, "Orders fetch failed", err);
  }
};

// Update Status
export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true },
    );
    if (!order) return sendError(res, 404, "Order not found");
    // Notify customer
    await Notification.create({
      userId: order.userId,
      type: "order",
      message: `Order ${order._id} updated to ${status}`,
    });
    await sendSMS(order.userPhone, `Your order is now ${status}!`);
    res.json(order);
  } catch (err) {
    sendError(res, 400, "Status update failed", err);
  }
};
