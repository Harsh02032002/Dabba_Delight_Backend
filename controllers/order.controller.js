const mongoose = require('mongoose');
const { settleDeliveredOrder } = require('../services/order-settlement.service');
const Order = require('../models/Order');
const Seller = require('../models/Seller');
const User = require('../models/User');
const Product = require('../models/Product');
const { SERVICE_RADIUS_KM, haversineKm, isValidCoords, getEffectiveSellerCoords } = require('../utils/sellerGeo');
const { Invoice, Settlement, CommissionConfig, WalletTransaction, Notification, PlatformConfig } = require('../models/Others');
const { generateInvoice } = require('../services/html-invoice.service');
const { sendOrderToRiders, releaseRider } = require('../services/delivery-assignment.service');
const { validateSellerTransition, validateCustomerCancel } = require('../services/order-lifecycle.service');
const pushNotification = require('../utils/pushNotification.service');
const { DeliveryPartner } = require('../models/Others');

const loadCustomer = (userId) => User.findById(userId).select('name pushToken fcmToken');

/**
 * pending → confirmed, exactly once (seller action or auto-confirm timer).
 * Notifies the customer and offers the order to nearby riders.
 */
async function confirmOrder(orderId, { io, updatedBy }) {
  const now = new Date();
  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: 'pending' },
    { $set: { status: 'confirmed' }, $push: { statusHistory: { status: 'confirmed', timestamp: now, updatedBy } } },
    { new: true },
  ).populate('sellerId', 'businessName');
  if (!order) return null;

  if (io) {
    const payload = { orderId: order._id, orderNumber: order.orderNumber, status: 'confirmed', message: 'Your order has been confirmed and is being prepared!', timestamp: now };
    io.to(`user_${order.userId}`).emit('order_status_update', payload);
    io.to(`order_${order._id}`).emit('order_status_update', payload);
    io.to(`seller_${order.sellerId?._id || order.sellerId}`).emit('order_confirmed', { order, message: `Order #${order.orderNumber} is ready for preparation!` });
  }
  pushNotification.notifyOrderConfirmed({ order, customer: await loadCustomer(order.userId), io })
    .catch(e => console.warn('notifyOrderConfirmed error:', e.message));

  const dispatch = await sendOrderToRiders(order._id, io);
  console.log(`🛵 Rider dispatch for ${order.orderNumber}:`, dispatch.message || `${dispatch.notified || 0} notified`);
  return order;
}

/** Undo a rider assignment when an order is cancelled before pickup */
async function releaseAssignedRider(order, io) {
  if (!order.deliveryPartnerId) return null;
  const rider = await DeliveryPartner.findById(order.deliveryPartnerId);
  await releaseRider(order.deliveryPartnerId, order._id);
  if (io && rider) {
    const payload = { orderId: order._id, orderNumber: order.orderNumber, status: 'cancelled' };
    io.to(`delivery_partner_${rider._id}`).emit('orderCancelled', payload);
    io.to(`delivery_partner_${rider.userId}`).emit('orderCancelled', payload);
  }
  return rider;
}
const { computeOrderGSTAndCommission, getGSTSettingsDoc } = require('../services/gst-order.service');
const subscriptionService = require('../services/subscription.service');
const walletController = require('../controllers/wallet.controller');
const { computeDeliveryPricing, getDeliverySlabsFromDB } = require('../utils/deliveryPricing');
const { priceOrder, toQuoteResponse, normalizePaymentMethod, initialPaymentStatus } = require('../services/order-pricing.service');

// POST /api/user/orders/quote — authoritative checkout totals (same pricing as /place)
exports.quoteOrder = async (req, res) => {
  try {
    const { sellerId, items, deliveryAddress } = req.body;
    const priced = await priceOrder({ sellerId, items, deliveryAddress, requireStreet: false });
    if (!priced.ok) {
      const { ok, status, ...body } = priced;
      return res.status(status).json({ success: false, ...body });
    }
    res.json({ success: true, quote: toQuoteResponse(priced) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/user/orders/place
exports.placeOrder = async (req, res) => {
  const io = req.app.get('io');
  try {
    let {
      items,
      sellerId,
      deliveryAddress,
      paymentMethod,
      totalAmount: clientTotalRaw,
      subtotal,
      deliveryFee,
      platformFee,
      discount,
      specialInstructions,
    } = req.body;

    // ── Auto-resolve sellerId if missing or empty string ────────
    if (!sellerId || typeof sellerId !== 'string' || sellerId.trim() === '') {
      if (items && Array.isArray(items) && items.length > 0) {
        const firstItemId = items[0].menuItemId || items[0].id || items[0]._id;
        if (firstItemId && mongoose.Types.ObjectId.isValid(firstItemId)) {
          const product = await Product.findById(firstItemId);
          if (product && product.sellerId) sellerId = product.sellerId.toString();
        }
      }
    }

    // ── Idempotent retries: same key -> same order ───────────────────────────
    const rawKey = req.get?.('Idempotency-Key') || req.body.idempotencyKey;
    const idempotencyKey = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim().slice(0, 100) : undefined;
    if (idempotencyKey) {
      const existingOrder = await Order.findOne({ userId: req.user._id, idempotencyKey })
        .populate('userId', 'name phone email')
        .populate('sellerId', 'businessName type logo phone email');
      if (existingOrder) {
        return res.status(200).json({ success: true, duplicatePrevented: true, order: existingOrder, billing: { grandTotal: existingOrder.total } });
      }
    }

    paymentMethod = normalizePaymentMethod(paymentMethod);
    if (!paymentMethod) {
      return res.status(400).json({ success: false, code: 'INVALID_PAYMENT_METHOD', message: 'Choose a valid payment method' });
    }

    // ── Server-side validation + pricing (seller approval, 21 km radius, items, prices, fees, GST) ──
    const priced = await priceOrder({ sellerId, items, deliveryAddress, clientSubtotal: subtotal });
    if (!priced.ok) {
      const { ok, status, ...body } = priced;
      return res.status(status).json({ success: false, ...body });
    }
    const { seller, lineItems, subtotal: numSubtotal, customerPoint, sellerPoint, distanceKm, tax } = priced;
    items = lineItems.map(({ lineTotal, ...line }) => line);
    const numDel = priced.deliveryFee;
    const riderPayoutAmount = priced.riderPayout;
    const deliveryDistanceKm = distanceKm;
    const numPlat = priced.platformFee;
    const grandTotal = tax.customerPayable;

    // ── Idempotency / Duplicate Order Guard (20 seconds window) ──────────────
    const recentDuplicate = await Order.findOne({
      userId: req.user._id,
      sellerId,
      total: grandTotal,
      status: 'pending',
      createdAt: { $gte: new Date(Date.now() - 20 * 1000) },
    })
      .populate('userId', 'name phone email')
      .populate('sellerId', 'businessName type logo phone email');

    if (recentDuplicate) {
      console.log(`⚠️ Duplicate placeOrder request prevented within 20s — returning existing order ${recentDuplicate.orderNumber}`);
      return res.status(200).json({
        success: true,
        duplicatePrevented: true,
        order: recentDuplicate,
        billing: {
          grandTotal: recentDuplicate.total,
          subscriptionUsed: recentDuplicate.subscriptionAmountUsed,
          daysDeducted: recentDuplicate.subscriptionDaysDeducted,
          payableAfterSubscription: recentDuplicate.payableAfterSubscription,
        },
      });
    }

    const session = await mongoose.startSession({ defaultTransactionOptions: { readPreference: 'primary' } });
    let order;
    try {
      session.startTransaction();
      
      // Check for seller-specific subscription
      console.log('🔍 Checking subscription for user:', req.user._id, 'seller:', sellerId);
      const subscription = await subscriptionService.getActiveSubscriptionForSeller(req.user._id, sellerId, session);
      console.log('📋 Subscription found:', subscription ? 'YES' : 'NO', subscription ? { remaining: subscription.remaining_amount, days: subscription.remaining_days } : null);
      
      let subCredit = { creditApplied: 0, payableRemainder: grandTotal, subscription: null };
      
      if (subscription) {
        // User has subscription for this seller
        console.log('✅ User has active subscription');
        if (subscription.remaining_amount >= grandTotal) {
          // Full amount can be covered by subscription
          console.log('💰 Full coverage - order total:', grandTotal, 'subscription remaining:', subscription.remaining_amount);
          subCredit = await subscriptionService.applySubscriptionToOrderWithSub(subscription, grandTotal, { sellerId }, session);
          console.log('✅ Subscription credit applied:', subCredit);
        } else if (subscription.remaining_amount > 0) {
          // Partial coverage - subscription has some amount but not enough
          console.log('💰 Partial coverage - subscription remaining:', subscription.remaining_amount, 'order total:', grandTotal);
          subCredit = await subscriptionService.applySubscriptionToOrderWithSub(subscription, grandTotal, { sellerId }, session);
          console.log('✅ Subscription credit applied:', subCredit);
        } else {
          // No remaining amount in subscription
          console.log('❌ No remaining balance in subscription');
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: `Your subscription for ${seller.businessName} has no remaining balance. Please renew your subscription.`,
          });
        }
      } else {
        console.log('ℹ️ No active subscription found for this seller');
      }

      const payableAfterSub = subCredit.payableRemainder;

      if (paymentMethod === 'wallet') {
        const user = await User.findById(req.user._id).session(session);
        if (!user || user.wallet < payableAfterSub) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: `Insufficient wallet balance. You have ₹${user?.wallet || 0} but need ₹${payableAfterSub.toFixed(2)} after subscription credit`,
          });
        }
        user.wallet -= payableAfterSub;
        await user.save({ session });
        await WalletTransaction.create(
          [
            {
              userId: req.user._id,
              type: 'debit',
              amount: payableAfterSub,
              description: `Order payment`,
              referenceType: 'order',
              balance: user.wallet,
            },
          ],
          { session },
        );
      }

      let sanitizedAddress = deliveryAddress ? { ...deliveryAddress } : {};
      const streetStr = (sanitizedAddress.street || sanitizedAddress.address || '').trim();
      const cityStr = String(sanitizedAddress.city || '').trim();
      const stateStr = String(sanitizedAddress.state || '').trim();
      const pinStr = (sanitizedAddress.pincode || '').trim();
      const fullAddr = (sanitizedAddress.fullAddress || [streetStr, cityStr, stateStr, pinStr].filter(Boolean).join(', ')).trim();

      sanitizedAddress.street = streetStr;
      sanitizedAddress.address = streetStr;
      sanitizedAddress.city = cityStr;
      sanitizedAddress.state = stateStr;
      sanitizedAddress.pincode = pinStr;
      sanitizedAddress.fullAddress = fullAddr;

      // The delivery point is the validated customer location (never guessed from address text)
      sanitizedAddress.location = { type: 'Point', coordinates: customerPoint };

      order = new Order({
        userId: req.user._id,
        deliveryOtp: Math.floor(1000 + Math.random() * 9000).toString(),
        sellerId,
        items,
        deliveryAddress: sanitizedAddress,
        pickupLocation: { type: 'Point', coordinates: sellerPoint },
        dropLocation: { type: 'Point', coordinates: customerPoint },
        paymentMethod,
        paymentStatus: initialPaymentStatus({ paymentMethod, payableAfterSubscription: payableAfterSub }),
        paymentReference: req.body.transactionId ? String(req.body.transactionId).slice(0, 64) : undefined,
        subtotal: numSubtotal,
        deliveryFee: numDel,
        riderPayout: riderPayoutAmount,
        deliveryDistanceKm,
        platformFee: numPlat,
        gstAmount: tax.gstAmount,
        gstMode: tax.gstMode,
        foodCgst: tax.foodCgst,
        foodSgst: tax.foodSgst,
        foodIgst: tax.foodIgst,
        deliveryCgst: tax.deliveryCgst,
        deliverySgst: tax.deliverySgst,
        deliveryIgst: tax.deliveryIgst,
        cgst: tax.foodCgst,
        sgst: tax.foodSgst,
        igst: tax.foodIgst,
        commission: tax.commission,
        commissionGST: tax.commissionGST,
        subscriptionAmountUsed: subCredit.amountUsed,
        subscriptionDaysDeducted: subCredit.daysUsed,
        payableAfterSubscription: payableAfterSub,
        discount: 0, // no server-side order discounts exist; client values are ignored
        total: grandTotal,
        specialInstructions,
        idempotencyKey,
        status: 'pending',
        statusHistory: [{ status: 'pending', timestamp: new Date() }],
      });
      await order.save({ session });

      await subscriptionService.recordUsage(
        {
          userId: req.user._id,
          orderId: order._id,
          amountUsed: subCredit.amountUsed,
          daysUsed: subCredit.daysUsed,
        },
        session,
      );

      // Credit subscription amount used to admin wallet
      if (subCredit.amountUsed > 0) {
        const adminUser = await User.findOne({ role: 'admin' }).session(session);
        if (adminUser) {
          await User.findByIdAndUpdate(
            adminUser._id, 
            { $inc: { wallet: subCredit.amountUsed } },
            { session }
          );

          await WalletTransaction.create([{
            userId: adminUser._id,
            type: 'credit',
            amount: subCredit.amountUsed,
            description: `Subscription amount from order #${order.orderNumber}`,
            referenceType: 'order',
            referenceId: order._id.toString(),
            balance: (adminUser.wallet || 0) + subCredit.amountUsed,
          }], { session });

          console.log(`💰 Subscription amount ₹${subCredit.amountUsed} credited to admin wallet`);
        }
      }

      await session.commitTransaction();
    } catch (innerErr) {
      await session.abortTransaction();
      if (innerErr?.code === 11000 && idempotencyKey) {
        // A concurrent retry with the same key won the race — return that order
        const winner = await Order.findOne({ userId: req.user._id, idempotencyKey });
        if (winner) return res.status(200).json({ success: true, duplicatePrevented: true, order: winner, billing: { grandTotal: winner.total } });
      }
      throw innerErr;
    } finally {
      session.endSession();
    }

    if (paymentMethod === 'wallet') {
      await WalletTransaction.findOneAndUpdate(
        { userId: req.user._id, referenceType: 'order', referenceId: null },
        { referenceId: order._id.toString(), description: `Payment for order #${order.orderNumber}` },
        { sort: { createdAt: -1 } },
      );
    }

    const clientTotal = Number(clientTotalRaw);
    if (clientTotal && Math.abs(clientTotal - grandTotal) > 1) {
      console.warn(`placeOrder: client total ${clientTotal} vs server ${grandTotal} — using server amounts`);
    }

    await order.populate('userId', 'name phone email');
    await order.populate('sellerId', 'businessName type logo phone email address gstNumber fssaiLicense');

    // Respond immediately to the client so it never times out waiting for Puppeteer PDF generation
    res.status(201).json({
      success: true,
      order,
      billing: {
        grandTotal,
        subscriptionUsed: order.subscriptionAmountUsed,
        daysDeducted: order.subscriptionDaysDeducted,
        payableAfterSubscription: order.payableAfterSubscription,
      },
    });

    // Run notifications, invoice generation, and auto-confirm timer in the background
    const userIdForBg = req.user._id;
    setImmediate(async () => {
      try {
        if (io) {
          io.to(`seller_${sellerId}`).emit('new_order', {
            orderId: order._id,
            orderNumber: order.orderNumber,
            totalAmount: grandTotal,
            customerName: order.userId?.name,
            itemCount: items?.length || 0,
            timestamp: new Date(),
          });
        }

        const sellerUser = seller.userId ? await User.findById(seller.userId).select('pushToken fcmToken') : null;
        const customer = await loadCustomer(userIdForBg);
        await pushNotification.notifyOrderPlaced({ order, customer, sellerUser, io });
        console.log(`✅ Order placed notifications sent for order ${order.orderNumber}`);

        // Offer order to nearby online riders immediately on order placement
        const dispatch = await sendOrderToRiders(order._id, io);
        console.log(`🛵 Initial rider dispatch for ${order.orderNumber}:`, dispatch.message || `${dispatch.notified || 0} notified`);
      } catch (notifErr) {
        console.log(`❌ Failed to send notification: ${notifErr.message}`);
      }

      try {
        await generateInvoice(order);
        console.log(`✅ Invoice generated for order ${order.orderNumber}`);
      } catch (invoiceErr) {
        console.log(`❌ Invoice generation failed for order ${order.orderNumber}:`, invoiceErr.message);
      }
    });

    const preparationTime = 5 * 60 * 1000;
    const orderRef = order;
    setTimeout(async () => {
      try {
        // No-op if the seller already confirmed or cancelled
        await confirmOrder(orderRef._id, { io: req.app.get('io'), updatedBy: 'system' });
      } catch (err) {
        console.log(`❌ Auto-confirmation failed for order ${orderRef.orderNumber}:`, err.message);
      }
    }, preparationTime);
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
    
    console.log('🔍 getUserOrders Debug:');
    console.log('- User ID:', req.user._id);
    console.log('- Status filter:', status);
    console.log('- Final filter:', filter);
    
    const orders = await Order.find(filter)
      .populate('sellerId', 'businessName type logo address')
      .populate('deliveryPartnerId', 'name phone vehicleType')
      .sort({ createdAt: -1 });
      
    console.log('- Found orders count:', orders.length);
    console.log('- Orders:', orders.map(o => ({
      id: o._id,
      orderNumber: o.orderNumber,
      status: o.status,
      createdAt: o.createdAt
    })));
    
    res.json({ success: true, orders });
  } catch (err) {
    console.error('❌ getUserOrders Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/user/orders/:id
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('sellerId', 'businessName type logo phone address')
      .populate('items.menuItemId', 'name image');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Unauthorized' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Delete Order ────────────────────────────────
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.userId.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Unauthorized' });

    // Allow deleting only cancelled or delivered orders
    const deletable = ['delivered', 'cancelled', 'failed'];
    if (!deletable.includes(order.status) && order.paymentStatus !== 'failed') {
      return res.status(400).json({ message: 'Only delivered or cancelled orders can be deleted' });
    }

    await Order.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Order deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
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
    const existing = await Order.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Order not found' });
    if (existing.userId.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Unauthorized' });

    const check = validateCustomerCancel(existing);
    if (!check.ok) return res.status(400).json({ message: check.message });

    // Atomic: only one cancel wins, and never after pickup (prevents double refunds)
    const order = await Order.findOneAndUpdate(
      { _id: existing._id, status: existing.status, deliveryStatus: { $ne: 'picked_up' } },
      {
        $set: { status: 'cancelled' },
        $push: { statusHistory: { status: 'cancelled', timestamp: new Date(), updatedBy: req.user._id } },
      },
      { new: true },
    );
    if (!order) return res.status(409).json({ message: 'Order status changed. Please refresh and try again.' });

    // ─── Refund to wallet ──────────────────────────
    try {
      if (order.paymentStatus === 'paid' && (order.paymentMethod === 'razorpay' || order.paymentMethod === 'wallet' || order.paymentMethod === 'stripe')) {
        const user = await User.findByIdAndUpdate(order.userId, { $inc: { wallet: order.total } }, { new: true });
        if (user) {
          await WalletTransaction.create({
            userId: order.userId, type: 'credit', amount: order.total,
            description: `Refund for cancelled order #${order.orderNumber}`,
            referenceId: order._id.toString(), referenceType: 'refund', balance: user.wallet,
          });

          await Notification.create({
            userId: order.userId, type: 'wallet',
            title: 'Refund Credited', message: `₹${order.total} refunded to your wallet for order #${order.orderNumber}`,
            isRead: false
          }).catch(e => console.error('Notification error:', e));

          order.paymentStatus = 'refunded';
        }
      }
    } catch (refundErr) {
      console.error('Wallet refund error:', refundErr);
    }

    // ─── Refund to Subscription ────────────────────
    try {
      if (order.subscriptionAmountUsed > 0) {
        await subscriptionService.refundSubscriptionUsage(order._id);
        await Notification.create({
          userId: order.userId,
          type: 'order',
          title: 'Subscription Refunded',
          message: `₹${order.subscriptionAmountUsed} has been credited back to your subscription.`,
          orderId: order._id,
          isRead: false
        }).catch(e => console.error('Notification error:', e));
      }
    } catch (subErr) {
      console.error('Subscription refund error:', subErr);
    }

    await order.save();
    const io = req.app.get('io');
    const rider = await releaseAssignedRider(order, io);

    // ─── Cancellation notifications (customer + released rider) ───
    try {
      await pushNotification.notifyOrderCancelled({
        order, customer: await loadCustomer(order.userId), rider, reason: 'Cancelled by you', io,
      });
    } catch (notifErr) {
      console.error('Cancellation notification error:', notifErr);
    }

    if (io) {
      const payload = { orderId: order._id, orderNumber: order.orderNumber, status: 'cancelled', timestamp: new Date() };
      io.to(`seller_${order.sellerId}`).emit('order_cancelled', { orderId: order._id });
      io.to(`seller_${order.sellerId}`).emit('order_status_update', payload);
      io.to(`user_${order.userId}`).emit('order_status_update', payload);
      io.to(`order_${order._id}`).emit('order_status_update', payload);
      io.to('delivery_partners').emit('delivery_request_taken', { orderId: order._id, orderNumber: order.orderNumber });
    }
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/seller/orders/:id/status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const existing = await Order.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Order not found' });
    if (existing.sellerId.toString() !== req.user.sellerId.toString())
      return res.status(403).json({ message: 'Unauthorized' });

    const check = validateSellerTransition(existing, status);
    if (!check.ok) return res.status(400).json({ success: false, message: check.message });

    const io = req.app.get('io');

    // ─── Restaurant accepts → confirm + offer to nearby riders ──────
    if (status === 'confirmed') {
      const confirmed = await confirmOrder(existing._id, { io, updatedBy: req.user._id });
      if (!confirmed) return res.status(409).json({ success: false, message: 'Order status changed. Please refresh.' });
      return res.json({ success: true, order: confirmed });
    }

    // Conditional update so a concurrent rider pickup / customer cancel is never overwritten
    const now = new Date();
    const filter = { _id: existing._id, status: existing.status };
    if (['out_for_delivery', 'delivered'].includes(status)) filter.deliveryPartnerId = null; // self-delivery only
    if (status === 'cancelled') filter.deliveryStatus = { $ne: 'picked_up' };
    const set = { status };
    if (status === 'delivered') {
      set.actualDelivery = now;
      if (existing.paymentMethod === 'cod') set.paymentStatus = 'paid';
    }
    const order = await Order.findOneAndUpdate(
      filter,
      { $set: set, $push: { statusHistory: { status, timestamp: now, updatedBy: req.user._id } } },
      { new: true },
    ).populate('sellerId', 'businessName');
    if (!order) return res.status(409).json({ success: false, message: 'Order status changed. Please refresh.' });

    // ─── Send Real-time Status Updates to All Parties ──────
    if (io) {
      const payload = {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status,
        deliveryStatus: order.deliveryStatus || null,
        message: `Order status updated to: ${status}`,
        timestamp: now,
      };
      io.to(`user_${order.userId}`).emit('order_status_update', payload);
      io.to(`order_${order._id}`).emit('order_status_update', payload);
      io.to(`seller_${req.user.sellerId}`).emit('order_status_update', payload);
      if (order.deliveryPartnerId) {
        io.to(`delivery_partner_${order.deliveryPartnerId}`).emit('order_status_update', payload);
      }
    }
    console.log(`📡 Order ${order.orderNumber} status updated to: ${status}`);

    const customer = await loadCustomer(order.userId);

    if (status === 'preparing') {
      await pushNotification.createAndSendNotification({
        userId: order.userId,
        pushToken: customer?.pushToken || customer?.fcmToken,
        title: '📦 Order Status Updated',
        message: `Your order #${order.orderNumber} is now: PREPARING`,
        type: 'order',
        orderId: order._id,
        data: { status: 'preparing', screen: 'Orders' },
        io,
        dedupeKey: `${order._id}:preparing:${order.userId}`,
      });
    }

    // ─── Restaurant Marks Order Ready → Notify customer + rider ──────
    if (status === 'ready') {
      const rider = order.deliveryPartnerId ? await DeliveryPartner.findById(order.deliveryPartnerId) : null;
      if (rider && io) {
        const readyPayload = {
          orderId: order._id,
          orderNumber: order.orderNumber,
          restaurantName: order.sellerId?.businessName,
          message: 'Order is ready for pickup!'
        };
        io.to(`delivery_partner_${rider._id}`).emit('order_ready', readyPayload);
        io.to(`delivery_partner_${rider.userId}`).emit('order_ready', readyPayload);
      }
      await pushNotification.notifyOrderReady({ order, customer, rider, io });

      if (!rider) {
        // No rider accepted yet — offer it again now that food is ready
        const deliveryResult = await sendOrderToRiders(order._id, io);
        console.log(`🛵 Re-dispatch on ready for ${order.orderNumber}:`, deliveryResult.message || `${deliveryResult.notified || 0} notified`);
      }
    }

    // ─── Seller self-delivery ──────
    if (status === 'out_for_delivery') {
      await pushNotification.notifyOutForDelivery({ order, customer, riderName: order.sellerId?.businessName || 'The restaurant', io });
      if (io) io.to('delivery_partners').emit('delivery_request_taken', { orderId: order._id, orderNumber: order.orderNumber });
    }

    if (status === 'delivered') {
      // Invoice, seller/admin split and cashback — exactly once, shared with rider OTP delivery
      await settleDeliveredOrder(order._id).catch((e) => console.error('settleDeliveredOrder error:', e.message));

      await pushNotification.notifyOrderDelivered({ order, customer, rider: null, io });
    }

    // ─── Seller cancels → refund to wallet + release rider ──────
    if (status === 'cancelled') {
      if (order.paymentStatus === 'paid' && order.paymentMethod !== 'cod') {
        const user = await User.findByIdAndUpdate(order.userId, { $inc: { wallet: order.total } }, { new: true });
        await WalletTransaction.create({
          userId: order.userId, type: 'credit', amount: order.total,
          description: `Refund for cancelled order #${order.orderNumber}`,
          referenceId: order._id.toString(), referenceType: 'refund', balance: user.wallet,
        });
        order.paymentStatus = 'refunded';
        await order.save();
        await Notification.create({
          userId: order.userId, type: 'wallet',
          title: 'Refund Credited', message: `₹${order.total} refunded to your wallet for order #${order.orderNumber}`,
        });
      }
      const rider = await releaseAssignedRider(order, io);
      await pushNotification.notifyOrderCancelled({ order, customer, rider, reason: 'Cancelled by the restaurant', io });
      if (io) io.to('delivery_partners').emit('delivery_request_taken', { orderId: order._id, orderNumber: order.orderNumber });
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/seller/orders/bulk/status
exports.bulkUpdateOrderStatus = async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Order IDs required' });
    }
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status required' });
    }

    const result = await Order.updateMany(
      { _id: { $in: ids }, sellerId: req.user.sellerId },
      { status, updatedAt: new Date() }
    );

    // Emit status updates via socket
    const io = req.app.get('io');
    if (io) {
      ids.forEach(orderId => {
        io.emit('order_status_update', { orderId, status });
      });
    }

    res.json({ success: true, message: `${result.modifiedCount} orders updated to ${status}` });
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
