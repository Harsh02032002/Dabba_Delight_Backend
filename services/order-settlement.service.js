/**
 * Money that moves when an order is delivered — exactly once per order, whoever completes it
 * (seller self-delivery or rider OTP confirmation):
 *   - tax invoice for cash orders
 *   - seller/admin wallet split (commission) for paid orders
 *   - 2% cashback to the customer
 * The order-level `sellerSettledAt` flag is claimed atomically before anything is credited.
 */
const Order = require('../models/Order');
const User = require('../models/User');
const { WalletTransaction, Notification } = require('../models/Others');

const CASHBACK_RATE = 0.02;

async function settleDeliveredOrder(orderId) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: 'delivered', sellerSettledAt: null },
    { $set: { sellerSettledAt: new Date() } },
    { new: true },
  );
  if (!order) return { settled: false, reason: 'already settled or not delivered' };

  if (order.paymentMethod === 'cod') {
    try {
      const { generateInvoice } = require('./html-invoice.service');
      await generateInvoice(order);
    } catch (err) { console.error('Invoice generation failed for', order.orderNumber, err.message); }
  }

  // Seller earnings + platform commission (only money that was actually collected)
  let sellerCredited = false;
  if (order.paymentStatus === 'paid') {
    try {
      const walletController = require('../controllers/wallet.controller');
      // The platform wallet must exist before the split runs inside its transaction
      await walletController.initializeAdminWallet();
      await walletController.processOrderPayment({
        orderId: order._id,
        userId: order.userId,
        sellerId: order.sellerId,
        totalAmount: order.total,
        paymentMethod: order.paymentMethod,
        orderNumber: order.orderNumber,
        itemsCount: order.items?.length || 0,
      });
      sellerCredited = true;
    } catch (err) {
      // Release the claim so a retry or reconciliation can settle it later
      console.error('Seller settlement failed for', order.orderNumber, err.message);
      await Order.updateOne({ _id: order._id }, { $set: { sellerSettledAt: null } });
      return { settled: false, reason: err.message };
    }
  }

  try {
    const cashback = Math.round((Number(order.total) || 0) * CASHBACK_RATE);
    if (cashback > 0) {
      const customer = await User.findByIdAndUpdate(order.userId, { $inc: { wallet: cashback } }, { new: true });
      if (customer) {
        await WalletTransaction.create({
          userId: order.userId, type: 'credit', amount: cashback,
          description: `Cashback for order #${order.orderNumber}`,
          referenceId: order._id.toString(), referenceType: 'order', balance: customer.wallet,
        });
        await Notification.create({
          userId: order.userId, type: 'wallet',
          title: 'Cashback received', message: `₹${cashback} cashback credited for order #${order.orderNumber}`,
        });
      }
    }
  } catch (err) { console.error('Cashback error for', order.orderNumber, err.message); }

  return { settled: true, sellerCredited };
}

module.exports = { settleDeliveredOrder, CASHBACK_RATE };
