/**
 * Order lifecycle rules (single source of truth for status transitions).
 *
 * Two dimensions are tracked on an Order:
 *  - `status`         : the kitchen / overall order state shown everywhere
 *                       pending → confirmed → preparing → ready → out_for_delivery → delivered
 *                       (cancelled is terminal and reachable before pickup)
 *  - `deliveryStatus` : the rider leg, which runs in parallel with cooking
 *                       null → assigned → arrived_at_restaurant → picked_up → delivered
 *
 * A rider can be assigned while the kitchen is still preparing, so the rider leg cannot
 * live inside `status` without regressing it. `status` only becomes `out_for_delivery`
 * when the rider actually picks the food up.
 */

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];
const DELIVERY_STATUSES = ['assigned', 'arrived_at_restaurant', 'picked_up', 'delivered'];
const TERMINAL_STATUSES = ['delivered', 'cancelled'];

/** Kitchen states in which an unassigned order is offered to riders */
const RIDER_ELIGIBLE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];

/** Max simultaneous active deliveries per rider (existing model holds one activeOrderId) */
const MAX_ACTIVE_ORDERS_PER_RIDER = 1;

/** Seller-driven transitions (matches the buttons in the seller dashboard) */
const SELLER_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'ready', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Customer may cancel only before the kitchen finishes (existing rule) */
const CUSTOMER_CANCELLABLE = ['pending', 'confirmed', 'preparing'];

/** Rider-driven delivery leg transitions; `delivered` goes through OTP confirmation only */
const RIDER_TRANSITIONS = {
  assigned: ['arrived_at_restaurant', 'picked_up'],
  arrived_at_restaurant: ['picked_up'],
  picked_up: [],
  delivered: [],
};

/** Map legacy / app-specific status names onto the delivery leg vocabulary */
const RIDER_STATUS_ALIASES = {
  accepted: 'assigned',
  reached_pickup: 'arrived_at_restaurant',
  arrived: 'arrived_at_restaurant',
  arrived_at_restaurant: 'arrived_at_restaurant',
  picked: 'picked_up',
  picked_up: 'picked_up',
  order_picked_up: 'picked_up',
  out_for_delivery: 'picked_up',
};

const normalizeRiderStatus = (status) => RIDER_STATUS_ALIASES[String(status || '').trim()] || null;

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function validateSellerTransition(order, nextStatus) {
  if (!ORDER_STATUSES.includes(nextStatus)) {
    return { ok: false, message: `Unknown status "${nextStatus}"` };
  }
  const current = order.status;
  if (current === nextStatus) {
    return { ok: false, message: `Order is already ${nextStatus}` };
  }
  const allowed = SELLER_TRANSITIONS[current] || [];
  if (!allowed.includes(nextStatus)) {
    return { ok: false, message: `Cannot change order from ${current} to ${nextStatus}` };
  }
  // Once a rider owns the delivery, pickup/delivery are driven by the rider app
  if (order.deliveryPartnerId && ['out_for_delivery', 'delivered'].includes(nextStatus)) {
    return { ok: false, message: 'A delivery partner is assigned; pickup and delivery are updated by the rider' };
  }
  if (nextStatus === 'cancelled' && order.deliveryStatus === 'picked_up') {
    return { ok: false, message: 'Order has already been picked up and cannot be cancelled' };
  }
  return { ok: true };
}

function validateCustomerCancel(order) {
  if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
    return { ok: false, message: 'Order cannot be cancelled at this stage' };
  }
  if (order.deliveryStatus === 'picked_up') {
    return { ok: false, message: 'Order has already been picked up and cannot be cancelled' };
  }
  return { ok: true };
}

/**
 * Validate a rider-requested delivery leg step.
 * @returns {{ ok: true, next: string } | { ok: false, message: string }}
 */
function validateRiderTransition(order, requestedStatus) {
  const next = normalizeRiderStatus(requestedStatus);
  if (!next) return { ok: false, message: `Unsupported delivery status "${requestedStatus}"` };
  if (TERMINAL_STATUSES.includes(order.status)) {
    return { ok: false, message: `Order is already ${order.status}` };
  }
  const current = order.deliveryStatus || 'assigned';
  if (current === next) return { ok: false, message: `Order is already ${next}`, idempotent: true };
  const allowed = RIDER_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    return { ok: false, message: `Cannot change delivery from ${current} to ${next}` };
  }
  if (next === 'picked_up' && !RIDER_ELIGIBLE_STATUSES.includes(order.status)) {
    return { ok: false, message: `Order cannot be picked up while it is ${order.status}` };
  }
  return { ok: true, next };
}

/** Delivery confirmation is valid only after pickup */
function validateDeliveryCompletion(order) {
  if (order.status === 'delivered') return { ok: false, message: 'Order is already delivered', idempotent: true };
  if (order.status === 'cancelled') return { ok: false, message: 'Order was cancelled' };
  if (order.deliveryStatus !== 'picked_up' && order.status !== 'out_for_delivery') {
    return { ok: false, message: 'Pick up the order before confirming delivery' };
  }
  return { ok: true };
}

/** Amount credited to the rider for a delivery (schema: riderPayout = rider earnings credit) */
const getRiderPayout = (order) => {
  const payout = Number(order?.riderPayout);
  if (Number.isFinite(payout) && payout > 0) return payout;
  const fee = Number(order?.deliveryFee);
  return Number.isFinite(fee) && fee > 0 ? fee : 30;
};

module.exports = {
  ORDER_STATUSES,
  DELIVERY_STATUSES,
  TERMINAL_STATUSES,
  RIDER_ELIGIBLE_STATUSES,
  MAX_ACTIVE_ORDERS_PER_RIDER,
  CUSTOMER_CANCELLABLE,
  normalizeRiderStatus,
  validateSellerTransition,
  validateCustomerCancel,
  validateRiderTransition,
  validateDeliveryCompletion,
  getRiderPayout,
};
