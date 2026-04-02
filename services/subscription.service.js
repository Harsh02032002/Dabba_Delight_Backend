const Subscription = require('../models/Subscription');
const SubscriptionUsage = require('../models/SubscriptionUsage');

function getActiveSubscriptionQuery(userId) {
  return {
    user_id: userId,
    status: 'active',
    remaining_amount: { $gt: 0 },
    remaining_days: { $gt: 0 },
  };
}

async function getActiveSubscription(userId, session = null) {
  let q = Subscription.findOne(getActiveSubscriptionQuery(userId));
  if (session) q = q.session(session);
  return q;
}

/**
 * Apply subscription credit to an order total (full grand total in rupees).
 * Must be called inside a transaction when paired with order creation.
 */
async function applySubscriptionToOrder(userId, orderGrandTotal, session = null) {
  if (!orderGrandTotal || orderGrandTotal <= 0) {
    return { amountUsed: 0, daysUsed: 0, payableRemainder: 0, subscriptionId: null };
  }

  let q = Subscription.findOne(getActiveSubscriptionQuery(userId));
  if (session) q = q.session(session);
  const sub = await q;

  if (!sub) {
    return { amountUsed: 0, daysUsed: 0, payableRemainder: orderGrandTotal, subscriptionId: null };
  }

  const amountUsed = Math.min(orderGrandTotal, sub.remaining_amount);
  const perDay =
    Number(sub.per_day_value) || (sub.total_days > 0 ? sub.total_amount / sub.total_days : 0);
  let daysUsed = perDay > 0 ? Math.ceil(amountUsed / perDay) : 0;
  daysUsed = Math.min(daysUsed, sub.remaining_days);

  let remainingAmount = sub.remaining_amount - amountUsed;
  let remainingDays = sub.remaining_days - daysUsed;
  let status = sub.status;

  if (remainingAmount <= 0 || remainingDays <= 0) {
    status = 'expired';
    remainingAmount = 0;
    remainingDays = 0;
  }

  sub.remaining_amount = remainingAmount;
  sub.remaining_days = remainingDays;
  sub.status = status;
  const saveOpts = session ? { session } : {};
  await sub.save(saveOpts);

  return {
    amountUsed,
    daysUsed,
    payableRemainder: Math.max(0, orderGrandTotal - amountUsed),
    subscriptionId: sub._id,
  };
}

async function recordUsage({ userId, orderId, amountUsed, daysUsed }, session = null) {
  if (!amountUsed && !daysUsed) return null;
  const doc = {
    user_id: userId,
    order_id: orderId,
    amount_used: amountUsed,
    days_used: daysUsed,
    date: new Date(),
  };
  if (session) {
    const [row] = await SubscriptionUsage.create([doc], { session });
    return row;
  }
  return SubscriptionUsage.create(doc);
}

async function createSubscriptionPurchase(userId, { totalAmount, totalDays }, session = null) {
  if (!totalAmount || totalAmount <= 0 || !totalDays || totalDays < 1) {
    const err = new Error('Invalid subscription plan');
    err.status = 400;
    throw err;
  }

  const perDay = totalAmount / totalDays;

  let q = Subscription.updateMany({ user_id: userId, status: 'active' }, { status: 'expired' });
  if (session) q = q.session(session);
  await q;

  const doc = {
    user_id: userId,
    total_amount: totalAmount,
    remaining_amount: totalAmount,
    total_days: totalDays,
    remaining_days: totalDays,
    per_day_value: perDay,
    status: 'active',
  };

  if (session) {
    const [created] = await Subscription.create([doc], { session });
    return created;
  }
  return Subscription.create(doc);
}

module.exports = {
  getActiveSubscriptionQuery,
  getActiveSubscription,
  applySubscriptionToOrder,
  recordUsage,
  createSubscriptionPurchase,
};
