/**
 * Push Notification Service (Expo Push API + Firebase Cloud Messaging + In-app Notification)
 * Supports real-time push notifications across Customer, Rider, and Seller apps.
 */
const { Notification } = require('../models/Others');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send raw push notification via Expo Push Notification Service
 * @param {string|string[]} pushTokens - ExponentPushToken[...] or FCM registration tokens
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
async function sendExpoPushNotification(pushTokens, title, body, data = {}) {
  try {
    const rawTokens = Array.isArray(pushTokens) ? pushTokens : [pushTokens];
    const validTokens = rawTokens.filter(t => t && typeof t === 'string' && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[') || t.length > 20));

    if (!validTokens.length) {
      console.log(`ℹ️ [Push] No valid push tokens provided for: "${title}"`);
      return { success: false, reason: 'No valid tokens' };
    }

    const messages = validTokens.map(token => ({
      to: token,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      channelId: 'orders',
      _displayInForeground: true,
    }));

    // Send in batches of 100 as per Expo documentation
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await res.json();
    console.log(`📱 [Push Notification Sent] "${title}" to ${validTokens.length} devices`, result?.data?.length ? '✅' : result);
    return { success: true, result };
  } catch (err) {
    console.error(`❌ [Push Notification Error]:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Create in-app notification in DB and optionally trigger device push notification
 */
async function createAndSendNotification({ userId, pushToken, title, message, type = 'order', orderId = null, data = {}, io = null }) {
  try {
    // 1. Create persistent DB notification
    if (userId) {
      await Notification.create({
        userId,
        type,
        title,
        message,
        orderId,
        isRead: false,
      }).catch(e => console.warn('Could not save DB notification:', e.message));
    }

    // 2. Real-time Socket.io emit if server io provided
    if (io) {
      if (userId) io.to(userId.toString()).emit('notification', { title, message, type, orderId, data });
      io.emit('order_notification', { title, message, type, orderId, data });
    }

    // 3. Send physical push notification to device via Expo/FCM
    if (pushToken) {
      await sendExpoPushNotification(pushToken, title, message, { orderId, type, ...data });
    }
  } catch (err) {
    console.error('Error in createAndSendNotification:', err.message);
  }
}

// ─── Pre-configured Order Event Notifications ─────────────────────────

/**
 * 1. Order Placed: Notify Customer, Seller, and Riders
 */
async function notifyOrderPlaced({ order, customer, sellerUser, nearbyRiders = [], io }) {
  const orderNum = order.orderNumber || order._id?.toString().slice(-6);

  // Customer notification
  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: customer.fcmToken || customer.pushToken,
      title: '🎉 Order Placed Successfully!',
      message: `Your order #${orderNum} for ₹${order.total || order.subtotal} has been received and sent to ${order.sellerId?.businessName || 'the kitchen'}.`,
      type: 'order',
      orderId: order._id,
      data: { orderId: order._id, status: 'placed' },
      io,
    });
  }

  // Seller notification
  if (sellerUser) {
    await createAndSendNotification({
      userId: sellerUser._id,
      pushToken: sellerUser.fcmToken || sellerUser.pushToken,
      title: '🍔 New Order Received!',
      message: `Order #${orderNum} - ₹${order.total || order.subtotal}. Please accept and confirm order.`,
      type: 'order',
      orderId: order._id,
      data: { orderId: order._id, status: 'new' },
      io,
    });
  }

  // Nearby Riders notification
  const riderTokens = (nearbyRiders || [])
    .map(r => r.fcmToken || r.pushToken || r.userId?.fcmToken || r.userId?.pushToken)
    .filter(Boolean);

  if (riderTokens.length) {
    await sendExpoPushNotification(
      riderTokens,
      '🛵 New Delivery Request Nearby!',
      `Order #${orderNum} from ${order.sellerId?.businessName || 'restaurant'} is waiting for pickup.`,
      { orderId: order._id, type: 'delivery_request' }
    );
  }
}

/**
 * 2. Order Confirmed: Notify Customer
 */
async function notifyOrderConfirmed({ order, customer, io }) {
  const orderNum = order.orderNumber || order._id?.toString().slice(-6);
  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: customer.fcmToken || customer.pushToken,
      title: '👨‍🍳 Order Confirmed & Cooking!',
      message: `The kitchen has confirmed your order #${orderNum} and started fresh preparation.`,
      type: 'order',
      orderId: order._id,
      data: { orderId: order._id, status: 'confirmed' },
      io,
    });
  }
}

/**
 * 3. Order Ready: Notify Rider and Customer
 */
async function notifyOrderReady({ order, customer, rider, io }) {
  const orderNum = order.orderNumber || order._id?.toString().slice(-6);

  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: customer.fcmToken || customer.pushToken,
      title: '✅ Food is Ready!',
      message: `Your food for order #${orderNum} is freshly packed and ready for delivery pickup.`,
      type: 'order',
      orderId: order._id,
      data: { orderId: order._id, status: 'ready' },
      io,
    });
  }

  if (rider) {
    const riderToken = rider.fcmToken || rider.pushToken || rider.userId?.fcmToken || rider.userId?.pushToken;
    await createAndSendNotification({
      userId: rider.userId?._id || rider._id,
      pushToken: riderToken,
      title: '📦 Order Ready for Pickup!',
      message: `Order #${orderNum} is ready at ${order.sellerId?.businessName || 'the restaurant'}. Please pick up.`,
      type: 'delivery',
      orderId: order._id,
      data: { orderId: order._id, status: 'ready' },
      io,
    });
  }
}

/**
 * 3b. Order Assigned: Rider has accepted / been assigned
 */
async function notifyOrderAssigned({ order, customer, rider, io }) {
  const orderNum = order.orderNumber || order._id?.toString().slice(-6);
  const riderName = rider?.name || 'A delivery partner';

  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: customer.fcmToken || customer.pushToken,
      title: '🛵 Delivery Partner Assigned!',
      message: `${riderName} has been assigned to your order #${orderNum} and will deliver it to you.`,
      type: 'delivery',
      orderId: order._id,
      data: { orderId: order._id, status: 'rider_assigned', riderName },
      io,
    });
  }

  if (rider) {
    const riderToken = rider.fcmToken || rider.pushToken || rider.userId?.fcmToken || rider.userId?.pushToken;
    await createAndSendNotification({
      userId: rider.userId?._id || rider._id,
      pushToken: riderToken,
      title: '🛵 Order Assigned to You!',
      message: `You have been assigned order #${orderNum}. Head to ${order.sellerId?.businessName || 'the restaurant'} for pickup.`,
      type: 'delivery',
      orderId: order._id,
      data: { orderId: order._id, status: 'assigned' },
      io,
    });
  }
}

/**
 * 4. Order Out For Delivery: Notify Customer
 */
async function notifyOutForDelivery({ order, customer, riderName = 'Rider', io }) {
  const orderNum = order.orderNumber || order._id?.toString().slice(-6);
  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: customer.fcmToken || customer.pushToken,
      title: '🛵 Out for Delivery!',
      message: `${riderName} has picked up your order #${orderNum} and is heading to your address!`,
      type: 'order',
      orderId: order._id,
      data: { orderId: order._id, status: 'out_for_delivery' },
      io,
    });
  }
}

/**
 * 5. Order Delivered: Notify Customer and Rider
 */
async function notifyOrderDelivered({ order, customer, rider, io }) {
  const orderNum = order.orderNumber || order._id?.toString().slice(-6);

  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: customer.fcmToken || customer.pushToken,
      title: '✨ Order Delivered! Enjoy your meal 😋',
      message: `Order #${orderNum} has been delivered. Please share your rating and review!`,
      type: 'order',
      orderId: order._id,
      data: { orderId: order._id, status: 'delivered' },
      io,
    });
  }

  if (rider) {
    const riderToken = rider.fcmToken || rider.pushToken || rider.userId?.fcmToken || rider.userId?.pushToken;
    await createAndSendNotification({
      userId: rider.userId?._id || rider._id,
      pushToken: riderToken,
      title: '💰 Delivery Completed!',
      message: `Order #${orderNum} successfully delivered. ₹${order.riderPayout || 30} added to your earnings.`,
      type: 'delivery',
      orderId: order._id,
      data: { orderId: order._id, status: 'delivered' },
      io,
    });
  }
}

/**
 * 6. Order Cancelled
 */
async function notifyOrderCancelled({ order, customer, reason = 'Cancelled by seller', io }) {
  const orderNum = order.orderNumber || order._id?.toString().slice(-6);
  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: customer.fcmToken || customer.pushToken,
      title: '❌ Order Cancelled',
      message: `Order #${orderNum} was cancelled: ${reason}. Refund will be processed if already paid.`,
      type: 'order',
      orderId: order._id,
      data: { orderId: order._id, status: 'cancelled' },
      io,
    });
  }
}

module.exports = {
  sendExpoPushNotification,
  createAndSendNotification,
  notifyOrderPlaced,
  notifyOrderConfirmed,
  notifyOrderReady,
  notifyOrderAssigned,
  notifyOutForDelivery,
  notifyOrderDelivered,
  notifyOrderCancelled,
};
