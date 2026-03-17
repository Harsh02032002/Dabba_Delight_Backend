const Order = require('../models/Order');
const Seller = require('../models/Seller');
const User = require('../models/User');
const { Invoice, Settlement, CommissionConfig, WalletTransaction, Notification, PlatformConfig } = require('../models/Others');
const { generateInvoice } = require('../services/html-invoice.service');
const { sendOrderToRiders } = require('../services/delivery-assignment.service');

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

    // Populate order data for invoice generation
    await order.populate('userId', 'name phone email');
    await order.populate('sellerId', 'businessName type logo phone email');

    // Update wallet transaction with order reference
    if (paymentMethod === 'wallet') {
      await WalletTransaction.findOneAndUpdate(
        { userId: req.user._id, referenceType: 'order', referenceId: null },
        { referenceId: order._id.toString(), description: `Payment for order #${order.orderNumber}` },
        { sort: { createdAt: -1 } }
      );
    }

    // ─── Send Notification to Restaurant (Step 2) ──────
    try {
      const io = req.app.get('io');
      if (io) {
        // Create notification for seller
        await Notification.create({
          userId: sellerId,
          type: 'new_order',
          title: '🍔 New Order Received',
          message: `Order #${order.orderNumber} - ₹${totalAmount}`,
          orderId: order._id,
          read: false
        });

        // Send real-time notification to seller
        io.to(`seller_${sellerId}`).emit('new_order', {
          orderId: order._id,
          orderNumber: order.orderNumber,
          totalAmount,
          customerName: order.userId?.name,
          itemCount: items?.length || 0,
          timestamp: new Date()
        });

        console.log(`✅ Notification sent to restaurant for order ${order.orderNumber}`);
      }
    } catch (notifErr) {
      console.log(`❌ Failed to send notification: ${notifErr.message}`);
    }

    // Generate invoice for all orders (COD and online payments)
    try {
      await generateInvoice(order);
      console.log(`✅ Invoice generated for order ${order.orderNumber}`);
    } catch (invoiceErr) {
      console.log(`❌ Invoice generation failed for order ${order.orderNumber}:`, invoiceErr.message);
      // Don't fail the order if invoice generation fails
    }
    
    // Auto-update order status after preparation time
    const preparationTime = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    setTimeout(async () => {
      try {
        console.log(`⏰ Checking order ${order.orderNumber} for automatic status update...`);
        const updatedOrder = await Order.findById(order._id);
        
        if (updatedOrder) {
          if (updatedOrder.status === 'pending') {
            console.log(`🔄 Auto-updating order ${order.orderNumber} from pending to confirmed`);
            updatedOrder.status = 'confirmed';
            updatedOrder.statusHistory.push({ 
              status: 'confirmed', 
              timestamp: new Date(), 
              updatedBy: 'system'
            });
            await updatedOrder.save();
            
            const io = req.app.get('io');
            if (io) {
              console.log(`📡 Emitting status update to user_${order.userId} and seller_${sellerId}`);
              io.to(`user_${order.userId}`).emit('order_status_update', { 
                orderId: order._id, 
                status: 'confirmed',
                message: 'Your order has been confirmed and is being prepared!'
              });
              io.to(`seller_${sellerId}`).emit('order_confirmed', { 
                order: updatedOrder,
                message: `Order #${order.orderNumber} is ready for preparation!`
              });
            }
            console.log(`✅ Order ${order.orderNumber} auto-confirmed after preparation time`);
          } else {
            console.log(`ℹ️ Order ${order.orderNumber} already updated to ${updatedOrder.status}, skipping auto-confirmation`);
          }
        } else {
          console.log(`❌ Order ${order.orderNumber} not found for status update`);
        }
      } catch (err) {
        console.log(`❌ Auto-confirmation failed for order ${order.orderNumber}:`, err.message);
        // Try to emit error notification
        const io = req.app.get('io');
        if (io) {
          io.to(`seller_${sellerId}`).emit('order_error', { 
            orderId: order._id,
            error: 'Failed to auto-confirm order',
            message: err.message
          });
        }
      }
    }, preparationTime);
    
    const io = req.app.get('io');
    if (io) {
      console.log(`📡 Emitting new_order to seller_${sellerId}`);
      io.to(`seller_${sellerId}`).emit('new_order', { 
        order: order,
        message: `New order #${order.orderNumber} received!`
      });
    }
    
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
    
    console.log('🔍 getUserOrders Debug:');
    console.log('- User ID:', req.user._id);
    console.log('- Status filter:', status);
    console.log('- Final filter:', filter);
    
    const orders = await Order.find(filter)
      .populate('sellerId', 'businessName type logo')
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
            read: false
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

      // Auto-create settlement record
      try {
        const seller = await Seller.findById(order.sellerId);
        const platformConfig = await PlatformConfig.findOne();
        const commConfig = await CommissionConfig.findOne();
        const commissionRate = seller?.commissionRate || commConfig?.defaultRate || 15;
        const platformFeeRate = platformConfig?.platformFee || 5;
        
        const grossAmount = order.total;
        const commission = Math.round(grossAmount * commissionRate / 100);
        const platformFee = Math.round(grossAmount * platformFeeRate / 100);
        const gst = Math.round(commission * 0.18); // 18% GST on commission
        const tds = Math.round(grossAmount * 0.01); // 1% TDS
        const netAmount = grossAmount - commission - platformFee - gst - tds;

        // Update seller wallet with net amount
        await Seller.findByIdAndUpdate(order.sellerId, { 
          $inc: { wallet: netAmount },
          $inc: { totalOrders: 1, totalRevenue: grossAmount }
        });

        // Create seller wallet transaction
        await WalletTransaction.create({
          sellerId: order.sellerId,
          type: 'credit',
          amount: netAmount,
          description: `Order payment for #${order.orderNumber} (after platform fee & commission)`,
          referenceType: 'order',
          referenceId: order._id.toString(),
          balance: (seller?.wallet || 0) + netAmount,
        });

        // Find admin user (assuming first admin user)
        const adminUser = await User.findOne({ role: 'admin' });
        if (adminUser) {
          // Update admin wallet with platform fee
          await User.findByIdAndUpdate(adminUser._id, { 
            $inc: { wallet: platformFee }
          });

          // Create admin wallet transaction for platform fee
          await WalletTransaction.create({
            userId: adminUser._id,
            type: 'credit',
            amount: platformFee,
            description: `Platform fee from order #${order.orderNumber}`,
            referenceType: 'order',
            referenceId: order._id.toString(),
            balance: (adminUser.wallet || 0) + platformFee,
          });

          console.log(`💰 Platform fee ₹${platformFee} credited to admin wallet`);
        }

        await Settlement.create({
          sellerId: order.sellerId,
          period: { startDate: order.createdAt, endDate: new Date() },
          totalOrders: 1, grossAmount, commission, platformFee, gst, tds, netAmount,
          status: 'pending', orderIds: [order._id],
        });

        console.log(`💰 Seller wallet credited with ₹${netAmount} (platform fee ₹${platformFee} deducted)`);

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
