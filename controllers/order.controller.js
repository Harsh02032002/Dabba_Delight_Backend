const Order = require('../models/Order');
const Seller = require('../models/Seller');
const User = require('../models/User');
const { Invoice, Settlement, CommissionConfig, WalletTransaction, Notification } = require('../models/Others');
const { generateInvoice } = require('../services/invoice.service');

// POST /api/user/orders/place
exports.placeOrder = async (req, res) => {
  try {
    const { items, sellerId, deliveryAddress, paymentMethod, totalAmount, subtotal, deliveryFee, platformFee, gstAmount, discount, specialInstructions } = req.body;

    // ─── Wallet Payment: check & deduct balance ──────
    if (paymentMethod === 'wallet') {
      const user = await User.findById(req.user._id);
      if (!user || user.wallet < totalAmount) {
        return res.status(400).json({ success: false, message: `Insufficient wallet balance. You have ₹${user?.wallet || 0} but need ₹${totalAmount}` });
      }
      // Deduct wallet
      user.wallet -= totalAmount;
      await user.save();
      // Record transaction
      await WalletTransaction.create({
        userId: req.user._id, type: 'debit', amount: totalAmount,
        description: `Order payment`, referenceType: 'order', balance: user.wallet,
      });
    }

    const order = new Order({
      userId: req.user._id, sellerId, items, deliveryAddress, paymentMethod,
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
      subtotal, deliveryFee, platformFee, gstAmount, discount: discount || 0,
      total: totalAmount, specialInstructions,
      status: 'pending',
      statusHistory: [{ status: 'pending', timestamp: new Date() }],
    });
    await order.save();

    // Update wallet transaction with order reference
    if (paymentMethod === 'wallet') {
      await WalletTransaction.findOneAndUpdate(
        { userId: req.user._id, referenceType: 'order', referenceId: null },
        { referenceId: order._id.toString(), description: `Payment for order #${order.orderNumber}` },
        { sort: { createdAt: -1 } }
      );
    }

    if (paymentMethod !== 'cod') await generateInvoice(order);
    const io = req.app.get('io');
    if (io) io.to(`seller_${sellerId}`).emit('new_order', order);
    res.status(201).json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/user/orders
exports.getUserOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { userId: req.user._id };
    if (status && status !== 'all') filter.status = status;
    const orders = await Order.find(filter).populate('sellerId', 'businessName type logo').sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/user/orders/:id
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('sellerId', 'businessName type logo phone')
      .populate('items.menuItemId', 'name image');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Unauthorized' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/user/orders/:id/rate
exports.rateOrder = async (req, res) => {
  try {
    const { rating, review } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'delivered') return res.status(400).json({ message: 'Can only rate delivered orders' });
    order.rating = rating;
    order.review = review || '';
    await order.save();
    // Update seller average rating
    const sellerOrders = await Order.find({ sellerId: order.sellerId, rating: { $exists: true, $ne: null } });
    const avgRating = sellerOrders.reduce((s, o) => s + o.rating, 0) / sellerOrders.length;
    await Seller.findByIdAndUpdate(order.sellerId, { rating: Math.round(avgRating * 10) / 10 });
    res.json({ success: true, message: 'Rating submitted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/user/orders/:id/cancel
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.userId.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Unauthorized' });
    
    const cancellable = ['pending', 'confirmed'];
    if (!cancellable.includes(order.status))
      return res.status(400).json({ message: 'Order cannot be cancelled at this stage' });

    order.status = 'cancelled';
    order.statusHistory.push({ status: 'cancelled', timestamp: new Date(), updatedBy: req.user._id });

    // ─── Refund to wallet ──────────────────────────
    if (order.paymentStatus === 'paid' && order.paymentMethod !== 'cod') {
      const user = await User.findByIdAndUpdate(order.userId, { $inc: { wallet: order.total } }, { new: true });
      await WalletTransaction.create({
        userId: order.userId, type: 'credit', amount: order.total,
        description: `Refund for cancelled order #${order.orderNumber}`,
        referenceId: order._id.toString(), referenceType: 'refund', balance: user.wallet,
      });
      order.paymentStatus = 'refunded';

      await Notification.create({
        userId: order.userId, type: 'wallet',
        title: 'Refund Credited', message: `₹${order.total} refunded to your wallet for order #${order.orderNumber}`,
      });
    }

    await order.save();
    const io = req.app.get('io');
    if (io) io.to(`seller_${order.sellerId}`).emit('order_cancelled', { orderId: order._id });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/seller/orders/:id/status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.sellerId.toString() !== req.user.sellerId.toString())
      return res.status(403).json({ message: 'Unauthorized' });
    order.status = status;
    order.statusHistory.push({ status, timestamp: new Date(), updatedBy: req.user._id });

    if (status === 'delivered') {
      order.actualDelivery = new Date();
      if (order.paymentMethod === 'cod') { order.paymentStatus = 'paid'; await generateInvoice(order); }

      // Auto-create settlement record
      try {
        const seller = await Seller.findById(order.sellerId);
        const commConfig = await CommissionConfig.findOne();
        const commissionRate = seller?.commissionRate || commConfig?.defaultRate || 15;
        const grossAmount = order.total;
        const commission = Math.round(grossAmount * commissionRate / 100);
        const gst = Math.round(commission * 0.18); // 18% GST on commission
        const tds = Math.round(grossAmount * 0.01); // 1% TDS
        const netAmount = grossAmount - commission - gst - tds;

        await Settlement.create({
          sellerId: order.sellerId,
          period: { startDate: order.createdAt, endDate: new Date() },
          totalOrders: 1, grossAmount, commission, gst, tds, netAmount,
          status: 'pending', orderIds: [order._id],
        });

        // Update seller total revenue
        await Seller.findByIdAndUpdate(order.sellerId, {
          $inc: { totalOrders: 1, totalRevenue: grossAmount },
        });

        // ─── Cashback to customer (2% of order total) ──────
        try {
          const cashbackRate = 0.02; // 2%
          const cashback = Math.round(order.total * cashbackRate);
          if (cashback > 0) {
            const customer = await User.findByIdAndUpdate(order.userId, { $inc: { wallet: cashback } }, { new: true });
            await WalletTransaction.create({
              userId: order.userId, type: 'credit', amount: cashback,
              description: `Cashback for order #${order.orderNumber}`,
              referenceId: order._id.toString(), referenceType: 'order', balance: customer.wallet,
            });
            await Notification.create({
              userId: order.userId, type: 'wallet',
              title: 'Cashback Received! 🎉', message: `₹${cashback} cashback credited for order #${order.orderNumber}`,
            });
          }
        } catch (cbErr) { console.error('Cashback error:', cbErr.message); }
      } catch (settlementErr) {
        console.error('Settlement creation error:', settlementErr.message);
      }
    }

    // ─── Seller cancels → refund to wallet ──────
    if (status === 'cancelled' && order.paymentStatus === 'paid' && order.paymentMethod !== 'cod') {
      const user = await User.findByIdAndUpdate(order.userId, { $inc: { wallet: order.total } }, { new: true });
      await WalletTransaction.create({
        userId: order.userId, type: 'credit', amount: order.total,
        description: `Refund for cancelled order #${order.orderNumber}`,
        referenceId: order._id.toString(), referenceType: 'refund', balance: user.wallet,
      });
      order.paymentStatus = 'refunded';
      await Notification.create({
        userId: order.userId, type: 'wallet',
        title: 'Refund Credited', message: `₹${order.total} refunded to your wallet for order #${order.orderNumber}`,
      });
    }

    await order.save();
    const io = req.app.get('io');
    if (io) io.to(`user_${order.userId}`).emit('order_status_update', { orderId: order._id, status });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/seller/orders
exports.getSellerOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { sellerId: req.user.sellerId };
    if (status && status !== 'all') filter.status = status;
    const orders = await Order.find(filter).populate('userId', 'name phone').sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/admin/orders
exports.getAdminOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    const orders = await Order.find(filter)
      .populate('userId', 'name email')
      .populate('sellerId', 'businessName')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));
    const total = await Order.countDocuments(filter);
    res.json({ success: true, orders, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
