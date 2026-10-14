/**
 * Push Notification Service (Expo Push API + Firebase Cloud Messaging + In-app Notification)
 * Supports real-time push notifications across Customer, Rider, and Seller apps.
 *
 * Every order lifecycle notification is:
 *   1. persisted as an in-app Notification (deduplicated per order/event/recipient),
 *   2. emitted over Socket.IO to the recipient's own `user_<id>` room only,
 *   3. pushed to the device when a token exists and the user has not disabled push.
 */
const { Notification, NotificationPreference } = require('../models/Others');
const { getRiderPayout } = require('../services/order-lifecycle.service');

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
    const validTokens = [...new Set(rawTokens.filter(t => t && typeof t === 'string' && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[') || t.length > 20)))];

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

    // Expo accepts at most 100 messages per request
    const results = [];
    for (let i = 0; i < messages.length; i += 100) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      results.push(await res.json());
    }

    console.log(`📱 [Push Notification Sent] "${title}" to ${validTokens.length} devices`);
    return { success: true, result: results };
  } catch (err) {
    console.error(`❌ [Push Notification Error]:`, err.message);
    return { success: false, error: err.message };
  }
}

async function isPushAllowed(userId) {
  if (!userId) return true;
  try {
    const pref = await NotificationPreference.findOne({ userId }).select('pushNotifications orderAlerts').lean();
    if (!pref) return true;
    return pref.pushNotifications !== false && pref.orderAlerts !== false;
  } catch {
    return true;
  }
}

/**
 * Create in-app notification in DB and optionally trigger device push notification.
 * When `dedupeKey` is given, a repeated call for the same key is a no-op.
 * @returns {Promise<boolean>} true when the notification was created (not a duplicate)
 */
async function createAndSendNotification({ userId, pushToken, title, message, type = 'order', orderId = null, data = {}, io = null, dedupeKey = null }) {
  try {
    // 1. Create persistent DB notification
    if (userId) {
      try {
        await Notification.create({
          userId,
          type,
          title,
          message,
          orderId: orderId || undefined,
          data: { ...data, orderId: orderId ? String(orderId) : undefined },
          isRead: false,
          ...(dedupeKey ? { dedupeKey } : {}),
        });
      } catch (e) {
        if (e && e.code === 11000) {
          console.log(`ℹ️ [Notify] Duplicate skipped: ${dedupeKey}`);
          return false;
        }
        console.warn('Could not save DB notification:', e.message);
      }
    }

    // 2. Real-time Socket.io emit to the recipient only
    if (io && userId) {
      io.to(`user_${userId}`).emit('notification', { title, message, type, orderId, data });
    }

    // 3. Send physical push notification to device via Expo/FCM
    if (pushToken && (await isPushAllowed(userId))) {
      await sendExpoPushNotification(pushToken, title, message, { orderId: orderId ? String(orderId) : undefined, type, ...data });
    }
    return true;
  } catch (err) {
    console.error('Error in createAndSendNotification:', err.message);
    return false;
  }
}

// ─── Recipient helpers ────────────────────────────────────────────────

const orderNumberOf = (order) => order.orderNumber || order._id?.toString().slice(-6);
const businessNameOf = (order, fallback) =>
  (order.sellerId && typeof order.sellerId === 'object' && order.sellerId.businessName) || fallback;
const keyFor = (order, event, recipientId) => `${order._id}:${event}:${recipientId}`;

/** Resolve the User id + push token for a DeliveryPartner document */
async function resolveRiderRecipient(rider) {
  if (!rider) return null;
  const userId = rider.userId?._id || rider.userId;
  let token = rider.pushToken || rider.fcmToken || rider.userId?.pushToken || rider.userId?.fcmToken;
  if (!token && userId) {
    try {
      const User = require('../models/User');
      const u = await User.findById(userId).select('pushToken fcmToken').lean();
      token = u?.pushToken || u?.fcmToken;
    } catch {}
  }
  return userId ? { userId, token } : null;
}

const userToken = (u) => u?.pushToken || u?.fcmToken;

// ─── Pre-configured Order Event Notifications ─────────────────────────

/**
 * 1. Order Placed: Notify Customer and Seller
 */
async function notifyOrderPlaced({ order, customer, sellerUser, io }) {
  const orderNum = orderNumberOf(order);

  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: userToken(customer),
      title: 'Order Placed Successfully',
      message: `Your order #${orderNum} for ₹${order.total || order.subtotal} has been received and sent to ${businessNameOf(order, 'the kitchen')}.`,
      type: 'order',
      orderId: order._id,
      data: { status: 'placed', screen: 'Orders' },
      io,
      dedupeKey: keyFor(order, 'placed', customer._id),
    });
  }

  if (sellerUser) {
    await createAndSendNotification({
      userId: sellerUser._id,
      pushToken: userToken(sellerUser),
      title: 'New Order Received',
      message: `Order #${orderNum} - ₹${order.total || order.subtotal}. Please accept and confirm order.`,
      type: 'new_order',
      orderId: order._id,
      data: { status: 'new', screen: 'SellerOrders' },
      io,
      dedupeKey: keyFor(order, 'placed', sellerUser._id),
    });
  }
}

/**
 * 1b. Delivery request: Notify eligible nearby riders (no customer contact details)
 */
async function notifyRidersNewRequest({ order, riders = [], io }) {
  const orderNum = orderNumberOf(order);
  for (const rider of riders) {
    const recipient = await resolveRiderRecipient(rider);
    if (!recipient) continue;
    await createAndSendNotification({
      userId: recipient.userId,
      pushToken: recipient.token,
      title: 'New Delivery Request Nearby',
      message: `Order #${orderNum} from ${businessNameOf(order, 'a restaurant')} is waiting for a delivery partner.`,
      type: 'delivery_request',
      orderId: order._id,
      data: { status: 'delivery_request', screen: 'Orders' },
      io,
      dedupeKey: keyFor(order, 'delivery_request', recipient.userId),
    });
  }
}

/**
 * 2. Order Confirmed: Notify Customer
 */
async function notifyOrderConfirmed({ order, customer, io }) {
  if (!customer) return;
  await createAndSendNotification({
    userId: customer._id,
    pushToken: userToken(customer),
    title: 'Order Confirmed & Cooking',
    message: `The kitchen has confirmed your order #${orderNumberOf(order)} and started fresh preparation.`,
    type: 'order',
    orderId: order._id,
    data: { status: 'confirmed', screen: 'Orders' },
    io,
    dedupeKey: keyFor(order, 'confirmed', customer._id),
  });
}

/**
 * 3. Order Ready: Notify Rider and Customer
 */
async function notifyOrderReady({ order, customer, rider, io }) {
  const orderNum = orderNumberOf(order);

  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: userToken(customer),
      title: 'Food is Ready',
      message: `Your food for order #${orderNum} is freshly packed and ready for delivery pickup.`,
      type: 'order',
      orderId: order._id,
      data: { status: 'ready', screen: 'Orders' },
      io,
      dedupeKey: keyFor(order, 'ready', customer._id),
    });
  }

  const recipient = await resolveRiderRecipient(rider);
  if (recipient) {
    await createAndSendNotification({
      userId: recipient.userId,
      pushToken: recipient.token,
      title: 'Order Ready for Pickup',
      message: `Order #${orderNum} is ready at ${businessNameOf(order, 'the restaurant')}. Please pick up.`,
      type: 'delivery',
      orderId: order._id,
      data: { status: 'ready', screen: 'ActiveOrder' },
      io,
      dedupeKey: keyFor(order, 'ready', recipient.userId),
    });
  }
}

/**
 * 3b. Order Assigned: Rider has accepted / been assigned
 */
async function notifyOrderAssigned({ order, customer, rider, io }) {
  const orderNum = orderNumberOf(order);
  const riderName = rider?.name || 'A delivery partner';

  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: userToken(customer),
      title: 'Delivery Partner Assigned',
      message: `${riderName} has been assigned to your order #${orderNum} and will deliver it to you.`,
      type: 'delivery',
      orderId: order._id,
      data: { status: 'rider_assigned', riderName, screen: 'Orders' },
      io,
      dedupeKey: keyFor(order, 'assigned', customer._id),
    });
  }

  const recipient = await resolveRiderRecipient(rider);
  if (recipient) {
    await createAndSendNotification({
      userId: recipient.userId,
      pushToken: recipient.token,
      title: 'Order Assigned to You',
      message: `You have been assigned order #${orderNum}. Head to ${businessNameOf(order, 'the restaurant')} for pickup.`,
      type: 'delivery',
      orderId: order._id,
      data: { status: 'assigned', screen: 'ActiveOrder' },
      io,
      dedupeKey: keyFor(order, 'assigned', recipient.userId),
    });
  }
}

/**
 * 4. Order Out For Delivery: Notify Customer
 */
async function notifyOutForDelivery({ order, customer, riderName = 'Rider', io }) {
  if (!customer) return;
  await createAndSendNotification({
    userId: customer._id,
    pushToken: userToken(customer),
    title: 'Out for Delivery',
    message: `${riderName} has picked up your order #${orderNumberOf(order)} and is heading to your address!`,
    type: 'order',
    orderId: order._id,
    data: { status: 'out_for_delivery', screen: 'Orders' },
    io,
    dedupeKey: keyFor(order, 'out_for_delivery', customer._id),
  });
}

/**
 * 5. Order Delivered: Notify Customer and Rider
 */
async function notifyOrderDelivered({ order, customer, rider, io }) {
  const orderNum = orderNumberOf(order);

  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: userToken(customer),
      title: 'Order Delivered! Enjoy your meal',
      message: `Order #${orderNum} has been delivered. Please share your rating and review!`,
      type: 'order',
      orderId: order._id,
      data: { status: 'delivered', screen: 'Orders' },
      io,
      dedupeKey: keyFor(order, 'delivered', customer._id),
    });
  }

  const recipient = await resolveRiderRecipient(rider);
  if (recipient) {
    await createAndSendNotification({
      userId: recipient.userId,
      pushToken: recipient.token,
      title: 'Delivery Completed',
      message: `Order #${orderNum} successfully delivered. ₹${getRiderPayout(order)} added to your earnings.`,
      type: 'delivery',
      orderId: order._id,
      data: { status: 'delivered', screen: 'Earnings' },
      io,
      dedupeKey: keyFor(order, 'delivered', recipient.userId),
    });
  }
}

/**
 * 6. Order Cancelled: Notify Customer (and the assigned rider, if any)
 */
async function notifyOrderCancelled({ order, customer, rider = null, reason = 'Cancelled by seller', io }) {
  const orderNum = orderNumberOf(order);
  if (customer) {
    await createAndSendNotification({
      userId: customer._id,
      pushToken: userToken(customer),
      title: 'Order Cancelled',
      message: `Order #${orderNum} was cancelled: ${reason}. Refund will be processed if already paid.`,
      type: 'order',
      orderId: order._id,
      data: { status: 'cancelled', screen: 'Orders' },
      io,
      dedupeKey: keyFor(order, 'cancelled', customer._id),
    });
  }

  const recipient = await resolveRiderRecipient(rider);
  if (recipient) {
    await createAndSendNotification({
      userId: recipient.userId,
      pushToken: recipient.token,
      title: 'Order Cancelled',
      message: `Order #${orderNum} was cancelled. You are free to accept other orders.`,
      type: 'delivery',
      orderId: order._id,
      data: { status: 'cancelled', screen: 'Orders' },
      io,
      dedupeKey: keyFor(order, 'cancelled', recipient.userId),
    });
  }
}

module.exports = {
  sendExpoPushNotification,
  createAndSendNotification,
  notifyOrderPlaced,
  notifyRidersNewRequest,
  notifyOrderConfirmed,
  notifyOrderReady,
  notifyOrderAssigned,
  notifyOutForDelivery,
  notifyOrderDelivered,
  notifyOrderCancelled,
};
