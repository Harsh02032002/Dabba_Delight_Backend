const Subscription = require('../models/Subscription');
const SubscriptionUsage = require('../models/SubscriptionUsage');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Order = require('../models/Order');

function getActiveSubscriptionQuery(userId) {
  return {
    user_id: userId,
    status: 'active',
    remaining_amount: { $gt: 0 },
    remaining_days: { $gt: 0 },
  };
}

function getActiveSubscriptionForSellerQuery(userId, sellerId) {
  return {
    user_id: userId,
    seller_id: sellerId,
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

async function getActiveSubscriptionForSeller(userId, sellerId, session = null) {
  let q = Subscription.findOne(getActiveSubscriptionForSellerQuery(userId, sellerId));
  if (session) q = q.session(session);
  return q;
}

/**
 * Check if subscription is applicable for a given order context
 * Returns validation result with details
 */
async function validateSubscriptionApplicability(subscription, orderContext) {
  const { sellerId, items, orderAmount, orderDate = new Date() } = orderContext;
  
  if (!subscription) {
    return { applicable: false, reason: 'No active subscription' };
  }
  
  // Check plan restrictions if plan_id exists
  if (subscription.plan_id) {
    const plan = await SubscriptionPlan.findById(subscription.plan_id);
    if (plan) {
      // Check vendor restrictions
      if (plan.allowed_vendors?.length > 0) {
        const vendorAllowed = plan.allowed_vendors.some(
          v => v.toString() === sellerId.toString()
        );
        if (!vendorAllowed) {
          return { 
            applicable: false, 
            reason: 'Subscription not valid for this restaurant/home chef' 
          };
        }
      }
      
      // Check category restrictions
      if (plan.allowed_categories?.length > 0) {
        const itemCategoryIds = items.map(item => item.category?.toString()).filter(Boolean);
        const hasAllowedCategory = itemCategoryIds.some(catId =>
          plan.allowed_categories.some(ac => ac.toString() === catId)
        );
        if (!hasAllowedCategory) {
          return { 
            applicable: false, 
            reason: 'Subscription not valid for these item categories' 
          };
        }
      }
      
      // Check item restrictions
      if (plan.allowed_items?.length > 0) {
        const itemIds = items.map(item => item.menuItemId?.toString()).filter(Boolean);
        const hasAllowedItem = itemIds.some(itemId =>
          plan.allowed_items.some(ai => ai.toString() === itemId)
        );
        if (!hasAllowedItem) {
          return { 
            applicable: false, 
            reason: 'Subscription not valid for these items' 
          };
        }
      }
      
      // Check min order value
      if (plan.min_order_value > 0 && orderAmount < plan.min_order_value) {
        return { 
          applicable: false, 
          reason: `Minimum order value ₹${plan.min_order_value} required for subscription` 
        };
      }
      
      // Check applicable days
      if (plan.applicable_days?.length > 0) {
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const orderDay = dayNames[orderDate.getDay()];
        if (!plan.applicable_days.includes(orderDay)) {
          return { 
            applicable: false, 
            reason: `Subscription not valid on ${orderDay}` 
          };
        }
      }
      
      // Check time restrictions
      if (plan.applicable_time_start && plan.applicable_time_end) {
        const currentTime = orderDate.getHours() * 60 + orderDate.getMinutes();
        const [startH, startM] = plan.applicable_time_start.split(':').map(Number);
        const [endH, endM] = plan.applicable_time_end.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        
        if (currentTime < startMinutes || currentTime > endMinutes) {
          return { 
            applicable: false, 
            reason: `Subscription valid only between ${plan.applicable_time_start} and ${plan.applicable_time_end}` 
          };
        }
      }
      
      // Check max orders per day
      if (plan.max_orders_per_day > 0) {
        const startOfDay = new Date(orderDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(orderDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        const todayOrders = await Order.countDocuments({
          userId: subscription.user_id,
          subscriptionAmountUsed: { $gt: 0 },
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        });
        
        if (todayOrders >= plan.max_orders_per_day) {
          return { 
            applicable: false, 
            reason: `Daily limit of ${plan.max_orders_per_day} orders reached` 
          };
        }
      }
    }
  }
  
  return { applicable: true, reason: null };
}

/**
 * Apply subscription credit to an order total (full grand total in rupees).
 * Must be called inside a transaction when paired with order creation.
 * 
 * Enhanced with:
 * - Vendor/category/item validation
 * - Hybrid payment support
 * - Detailed breakdown
 */
async function applySubscriptionToOrder(userId, orderGrandTotal, orderContext = {}, session = null) {
  if (!orderGrandTotal || orderGrandTotal <= 0) {
    return { 
      amountUsed: 0, 
      daysUsed: 0, 
      payableRemainder: 0, 
      subscriptionId: null,
      applicable: false,
      reason: null
    };
  }

  // Use seller-specific query if sellerId is provided in orderContext
  const sellerId = orderContext.sellerId;
  let q;
  if (sellerId) {
    q = Subscription.findOne(getActiveSubscriptionForSellerQuery(userId, sellerId));
  } else {
    q = Subscription.findOne(getActiveSubscriptionQuery(userId));
  }
  if (session) q = q.session(session);
  const sub = await q;

  if (!sub) {
    return { 
      amountUsed: 0, 
      daysUsed: 0, 
      payableRemainder: orderGrandTotal, 
      subscriptionId: null,
      applicable: false,
      reason: 'No active subscription'
    };
  }

  // Validate subscription applicability
  const validation = await validateSubscriptionApplicability(sub, orderContext);
  
  if (!validation.applicable) {
    return { 
      amountUsed: 0, 
      daysUsed: 0, 
      payableRemainder: orderGrandTotal, 
      subscriptionId: sub._id,
      applicable: false,
      reason: validation.reason
    };
  }

  // Check for max_discount_per_order limit from plan
  let maxUsable = sub.remaining_amount;
  if (sub.plan_id) {
    const plan = await SubscriptionPlan.findById(sub.plan_id);
    if (plan?.max_discount_per_order) {
      maxUsable = Math.min(maxUsable, plan.max_discount_per_order);
    }
  }

  const amountUsed = Math.min(orderGrandTotal, maxUsable);
  const perDay =
    Number(sub.per_day_value) || (sub.total_days > 0 ? sub.total_amount / sub.total_days : 0);
  let daysUsed = perDay > 0 ? Math.ceil(amountUsed / perDay) : 0;
  daysUsed = Math.min(daysUsed, sub.remaining_days);

  let remainingAmount = sub.remaining_amount - amountUsed;
  let remainingDays = sub.remaining_days - daysUsed;
  let status = sub.status;

  // Check expiry
  if (remainingAmount <= 0 || remainingDays <= 0) {
    status = 'expired';
    remainingAmount = 0;
    remainingDays = 0;
  }

  sub.remaining_amount = remainingAmount;
  sub.remaining_days = remainingDays;
  sub.status = status;
  const saveOpts = session ? { session } : {};
  
  console.log('💾 Saving subscription with new values:', {
    subscriptionId: sub._id,
    oldRemaining: sub.remaining_amount,
    newRemaining: remainingAmount,
    oldDays: sub.remaining_days,
    newDays: remainingDays,
    amountUsed: amountUsed,
    daysUsed: daysUsed
  });
  
  await sub.save(saveOpts);
  console.log('✅ Subscription saved successfully');

  return {
    amountUsed,
    daysUsed,
    payableRemainder: Math.max(0, orderGrandTotal - amountUsed),
    subscriptionId: sub._id,
    applicable: true,
    reason: null,
    remainingAfter: remainingAmount,
    daysRemainingAfter: remainingDays,
    perDayValue: perDay
  };
}

async function applySubscriptionToOrderWithSub(sub, orderTotal, options = {}, session = null) {
  if (!sub || !sub._id) {
    return {
      applicable: false,
      reason: 'No active subscription',
      creditApplied: 0,
      payableRemainder: orderTotal,
    };
  }

  const remainingAmount = Math.max(0, sub.remaining_amount - orderTotal);
  const remainingDays = Math.max(0, sub.remaining_days - 1);
  const perDay = sub.per_day_value || (sub.total_amount / sub.total_days);

  // Update the subscription object
  sub.remaining_amount = remainingAmount;
  sub.remaining_days = remainingDays;
  if (remainingAmount <= 0 || remainingDays <= 0) {
    sub.status = 'expired';
  }

  // Save with session
  const saveOpts = session ? { session } : {};
  await sub.save(saveOpts);
  console.log('💾 Subscription saved via applySubscriptionToOrderWithSub:', { remainingAmount, remainingDays });

  return {
    creditApplied: orderTotal,
    payableRemainder: 0,
    subscription: sub,
    subscriptionId: sub._id,
    applicable: true,
    reason: null,
    remainingAfter: remainingAmount,
    daysRemainingAfter: remainingDays,
    perDayValue: perDay
  };
}

async function recordUsage({ userId, orderId, amountUsed, daysUsed, paymentType = 'hybrid', onlinePaidAmount = 0 }, session = null) {
  if (!amountUsed && !daysUsed) return null;
  const doc = {
    user_id: userId,
    order_id: orderId,
    amount_used: amountUsed,
    days_used: daysUsed,
    payment_type: paymentType, // 'full', 'hybrid', 'none'
    online_paid_amount: onlinePaidAmount,
    date: new Date(),
  };
  if (session) {
    const [row] = await SubscriptionUsage.create([doc], { session });
    return row;
  }
  return SubscriptionUsage.create(doc);
}

async function createSubscriptionPurchase(userId, { totalAmount, totalDays, planId = null, sellerId = null, seller_name = null, seller_type = null }, session = null) {
  console.log('🚀 createSubscriptionPurchase called with:', {
    userId,
    totalAmount,
    totalDays,
    planId,
    sellerId,
    seller_name,
    seller_type
  });

  if (!totalAmount || totalAmount <= 0 || !totalDays || totalDays < 1) {
    console.log('❌ Invalid subscription plan:', { totalAmount, totalDays });
    const err = new Error('Invalid subscription plan');
    err.status = 400;
    throw err;
  }

  const perDay = totalAmount / totalDays;
  console.log('💰 Per day value calculated:', perDay);

  // Expire any existing active subscriptions for the same seller
  const expireFilter = { user_id: userId, status: 'active' };
  if (sellerId) {
    expireFilter.seller_id = sellerId;
  }
  console.log('🔄 Expiring existing subscriptions with filter:', expireFilter);
  let q = Subscription.updateMany(expireFilter, { status: 'expired' });
  if (session) q = q.session(session);
  await q;

  const doc = {
    user_id: userId,
    plan_id: planId,
    seller_id: sellerId,
    seller_name: seller_name,
    seller_type: seller_type,
    total_amount: totalAmount,
    remaining_amount: totalAmount,
    total_days: totalDays,
    remaining_days: totalDays,
    per_day_value: perDay,
    status: 'active',
  };

  console.log('📄 Creating subscription document:', doc);

  try {
    let created;
    if (session) {
      console.log('💾 Creating with session');
      [created] = await Subscription.create([doc], { session });
    } else {
      console.log('💾 Creating without session');
      created = await Subscription.create(doc);
    }
    
    console.log('✅ Subscription created successfully:', created._id);
    return created;
  } catch (error) {
    console.error('❌ Failed to create subscription:', error);
    throw error;
  }
}

/**
 * Get subscription with plan details
 */
async function getSubscriptionWithPlan(userId) {
  const subscription = await Subscription.findOne(getActiveSubscriptionQuery(userId))
    .populate('plan_id', 'plan_name description features badge allowed_vendors allowed_categories');
  return subscription;
}

/**
 * Manually adjust subscription (admin use)
 */
async function adjustSubscription(subscriptionId, { addBalance = 0, addDays = 0, reason = '' }, session = null) {
  const sub = await Subscription.findById(subscriptionId);
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    throw err;
  }

  if (sub.status === 'expired' && (addBalance > 0 || addDays > 0)) {
    sub.status = 'active';
  }

  sub.remaining_amount = Math.max(0, sub.remaining_amount + addBalance);
  sub.remaining_days = Math.max(0, sub.remaining_days + addDays);
  
  // Recalculate per_day_value if needed
  if (sub.remaining_days > 0) {
    sub.per_day_value = sub.remaining_amount / sub.remaining_days;
  }

  const saveOpts = session ? { session } : {};
  await sub.save(saveOpts);

  return sub;
}

/**
 * Force expire a subscription (admin use)
 */
async function forceExpireSubscription(subscriptionId, reason = '', session = null) {
  const sub = await Subscription.findById(subscriptionId);
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    throw err;
  }

  sub.status = 'expired';
  sub.remaining_amount = 0;
  sub.remaining_days = 0;

  const saveOpts = session ? { session } : {};
  await sub.save(saveOpts);

  return sub;
}

module.exports = {
  getActiveSubscriptionQuery,
  getActiveSubscription,
  getActiveSubscriptionForSeller,
  getSubscriptionWithPlan,
  validateSubscriptionApplicability,
  applySubscriptionToOrder,
  applySubscriptionToOrderWithSub,
  recordUsage,
  createSubscriptionPurchase,
  adjustSubscription,
  forceExpireSubscription,
};
