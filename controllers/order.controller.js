const mongoose = require('mongoose');
const Order = require('../models/Order');
const Seller = require('../models/Seller');
const User = require('../models/User');
const { Invoice, Settlement, CommissionConfig, WalletTransaction, Notification, PlatformConfig } = require('../models/Others');
const { generateInvoice } = require('../services/html-invoice.service');
const { sendOrderToRiders } = require('../services/delivery-assignment.service');
const { computeOrderGSTAndCommission, getGSTSettingsDoc } = require('../services/gst-order.service');
const subscriptionService = require('../services/subscription.service');
const walletController = require('../controllers/wallet.controller');

// POST /api/user/orders/place
exports.placeOrder = async (req, res) => {
  const io = req.app.get('io');
  try {
    const {
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

    const seller = await Seller.findById(sellerId);
    if (!seller) {
      return res.status(404).json({ success: false, message: 'Seller not found' });
    }

    const settings = await getGSTSettingsDoc();
    const platformDoc = await PlatformConfig.findOne();
    const numSubtotal = Number(subtotal) || 0;
    let numDel = Number(deliveryFee);
    if (!Number.isFinite(numDel) || numDel < 0) numDel = 0;
    if (platformDoc && platformDoc.deliveryFee != null && Number(platformDoc.deliveryFee) >= 0) {
      numDel = Number(platformDoc.deliveryFee);
    }
    const numPlat =
      platformDoc && platformDoc.platformFee != null
        ? Number(platformDoc.platformFee)
        : Number(platformFee) || 0;

    const tax = computeOrderGSTAndCommission({
      subtotal: numSubtotal,
      deliveryFee: numDel,
      platformFeeRupee: numPlat,
      sellerState: seller.address?.state,
      customerState: deliveryAddress?.state,
      settings,
    });

    const grandTotal = tax.customerPayable;

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

      order = new Order({
        userId: req.user._id,
        sellerId,
        items,
        deliveryAddress,
        paymentMethod,
        paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
        subtotal: numSubtotal,
        deliveryFee: numDel,
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
        discount: discount || 0,
        total: grandTotal,
        specialInstructions,
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
    await order.populate('sellerId', 'businessName type logo phone email');

    try {
      if (io) {
        await Notification.create({
          userId: sellerId,
          type: 'new_order',
          title: '🍔 New Order Received',
          message: `Order #${order.orderNumber} - ₹${grandTotal}`,
          orderId: order._id,
          isRead: false,
        });

        io.to(`seller_${sellerId}`).emit('new_order', {
          orderId: order._id,
          orderNumber: order.orderNumber,
          totalAmount: grandTotal,
          customerName: order.userId?.name,
          itemCount: items?.length || 0,
          timestamp: new Date(),
        });

        console.log(`✅ Notification sent to restaurant for order ${order.orderNumber}`);
      }

      // ─── Create Notification for User ───
      await Notification.create({
        userId: req.user._id,
        type: 'order',
        title: '🎉 Order Placed Successfully!',
        message: `Your order #${order.orderNumber} for ₹${grandTotal} has been placed successfully.`,
        orderId: order._id,
        isRead: false,
      });
      console.log(`✅ Notification created for user for order ${order.orderNumber}`);

    } catch (notifErr) {
      console.log(`❌ Failed to send notification: ${notifErr.message}`);
    }

    try {
      await generateInvoice(order);
      console.log(`✅ Invoice generated for order ${order.orderNumber}`);
    } catch (invoiceErr) {
      console.log(`❌ Invoice generation failed for order ${order.orderNumber}:`, invoiceErr.message);
    }

    const preparationTime = 5 * 60 * 1000;
    const orderRef = order;
    setTimeout(async () => {
      try {
        const updatedOrder = await Order.findById(orderRef._id);
        if (updatedOrder) {
          if (updatedOrder.status === 'pending') {
            updatedOrder.status = 'confirmed';
            updatedOrder.statusHistory.push({
              status: 'confirmed',
              timestamp: new Date(),
              updatedBy: 'system',
            });
            await updatedOrder.save();
            const ioLater = req.app.get('io');
            if (ioLater) {
              ioLater.to(`user_${orderRef.userId}`).emit('order_status_update', {
                orderId: orderRef._id,
                status: 'confirmed',
                message: 'Your order has been confirmed and is being prepared!',
              });
              
              // ─── Create Notification for User ───
              await Notification.create({
                userId: orderRef.userId,
                type: 'order',
                title: '👨‍🍳 Order Confirmed',
                message: `Your order #${orderRef.orderNumber} has been confirmed and is being prepared!`,
                orderId: orderRef._id,
                isRead: false,
              });

              ioLater.to(`seller_${sellerId}`).emit('order_confirmed', {
                order: updatedOrder,
                message: `Order #${orderRef.orderNumber} is ready for preparation!`,
              });
            }
          }
        }
      } catch (err) {
        console.log(`❌ Auto-confirmation failed for order ${orderRef.orderNumber}:`, err.message);
      }
    }, preparationTime);

    if (io) {
      io.to(`seller_${sellerId}`).emit('new_order', {
        order: order,
        message: `New order #${order.orderNumber} received!`,
      });
    }

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
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.userId.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Unauthorized' });
    
    const cancellable = ['pending', 'confirmed', 'preparing'];
    if (!cancellable.includes(order.status))
      return res.status(400).json({ message: 'Order cannot be cancelled at this stage' });

    order.status = 'cancelled';
    order.statusHistory.push({ status: 'cancelled', timestamp: new Date(), updatedBy: req.user._id });

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

    // ─── Create Main Cancellation Notification ───
    try {
      await Notification.create({
        userId: order.userId,
        type: 'order',
        title: '🚫 Order Cancelled',
        message: `Your order #${order.orderNumber} has been successfully cancelled.`,
        orderId: order._id,
        isRead: false,
      });
    } catch (notifErr) {
      console.error('Cancellation notification error:', notifErr);
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
    order.statusHistory.push({ 
      status, 
      timestamp: new Date(), 
      updatedBy: status === 'confirmed' ? 'system' : req.user._id 
    });

    // ─── Send Real-time Status Updates to All Parties ──────
    const io = req.app.get('io');
    
    // Send to user
    if (order.userId) {
      io.to(`user_${order.userId}`).emit('order_status_update', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: status,
        message: `Order status updated to: ${status}`
      });

      // ─── Create Notification for User ───
      await Notification.create({
        userId: order.userId,
        type: 'order',
        title: '📦 Order Status Updated',
        message: `Your order #${order.orderNumber} is now: ${status.toUpperCase()}`,
        orderId: order._id,
        isRead: false,
      });
    }
    
    // Send to seller
    if (order.sellerId) {
      io.to(`seller_${order.sellerId}`).emit('order_status_update', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: status,
        message: `Order status updated to: ${status}`
      });
    }
    
    // Send to delivery partner if assigned
    if (order.deliveryPartnerId) {
      io.to(`delivery_partner_${order.deliveryPartnerId}`).emit('order_status_update', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: status,
        message: `Order status updated to: ${status}`
      });
    }

    console.log(`📡 Order ${order.orderNumber} status updated to: ${status}`);
    console.log(`👥 Notifications sent to: user=${!!order.userId}, seller=${!!order.sellerId}, partner=${!!order.deliveryPartnerId}`);

    // ─── Step 2: Restaurant Accepts Order → Find Delivery Partner ──────
    if (status === 'confirmed') {
      console.log(`🍔 Restaurant accepted order ${order.orderNumber}, finding delivery partner...`);
      console.log(`📍 Restaurant location:`, order.sellerId?.address?.location?.coordinates);
      console.log(`🏠 Customer location:`, order.deliveryAddress?.location?.coordinates);
      
      // Send to delivery partners
      const io = req.app.get('io');
      const deliveryResult = await sendOrderToRiders(order._id, io);
      
      if (deliveryResult.success) {
        console.log(`✅ Delivery partner assigned: ${deliveryResult.assignedTo}`);
      } else {
        console.log(`⚠️ Delivery assignment failed: ${deliveryResult.message}`);
        // Order stays confirmed, will be assigned manually
      }
    }

    // ─── Step 3: Restaurant Marks Order Ready → Notify Delivery Partner ──────
    if (status === 'ready') {
      console.log(`🍕 Restaurant marked order ${order.orderNumber} as ready, notifying delivery partner...`);
      
      // If delivery partner already assigned, notify them to pick up
      if (order.deliveryPartnerId) {
        const io = req.app.get('io');
        
        // Send real-time notification to assigned delivery partner
        io.to(`delivery_partner_${order.deliveryPartnerId}`).emit('order_ready', {
          orderId: order._id,
          orderNumber: order.orderNumber,
          restaurantName: order.sellerId?.businessName,
          customerName: order.userId?.name,
          message: 'Order is ready for pickup!'
        });

        // Create notification
        // Get the delivery partner to find their userId
        const deliveryPartner = await DeliveryPartner.findById(order.deliveryPartnerId);
        if (deliveryPartner) {
          await Notification.create({
            userId: deliveryPartner.userId, // Use deliveryPartner.userId not order.deliveryPartnerId
            type: 'order_ready',
            title: '🍕 Order Ready for Pickup',
            message: `Order #${order.orderNumber} is ready for pickup from ${order.sellerId?.businessName}`,
            orderId: order._id,
            isRead: false
          });

          console.log(`✅ Ready notification sent to delivery partner ${deliveryPartner.name}`);
        }
      } else {
        // If no delivery partner assigned yet, try to assign one now
        console.log(`📍 No delivery partner assigned, finding one now...`);
        const io = req.app.get('io');
        const deliveryResult = await sendOrderToRiders(order._id, io);
        
        if (deliveryResult.success) {
          console.log(`✅ Delivery partner assigned on ready: ${deliveryResult.assignedTo}`);
        } else {
          console.log(`⚠️ Delivery assignment failed on ready: ${deliveryResult.message}`);
        }
      }
    }

    if (status === 'delivered') {
      order.actualDelivery = new Date();
      if (order.paymentMethod === 'cod') { order.paymentStatus = 'paid'; await generateInvoice(order); }

      // NEW WALLET SYSTEM: Process payment through wallet controller
      try {
        console.log('💰 Processing order payment through wallet system:', order.orderNumber);
        
        // Only process if payment was made (not COD pending)
        if (order.paymentStatus === 'paid') {
          await walletController.processOrderPayment({
            orderId: order._id,
            userId: order.userId,
            sellerId: order.sellerId,
            totalAmount: order.total,
            paymentMethod: order.paymentMethod,
            orderNumber: order.orderNumber,
            itemsCount: order.items?.length || 0
          });
          
          console.log('✅ Order payment processed through wallet system');
        }
      } catch (walletError) {
        console.error('❌ Wallet processing error:', walletError);
        // Don't fail the order update if wallet processing fails
        // It can be reconciled later
      }

      // Legacy settlement code removed - now handled by wallet system above
      try {
        // Keep any additional post-delivery logic here if needed
        console.log('✅ Order delivered and processed through wallet system');

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
    if (io) io.to(`user_${order.userId}`).emit('order_status_update', { orderId: order._id, status });
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
