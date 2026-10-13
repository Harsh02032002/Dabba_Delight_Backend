const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSellerTransition,
  validateCustomerCancel,
  validateRiderTransition,
  validateDeliveryCompletion,
  normalizeRiderStatus,
  getRiderPayout,
} = require('../services/order-lifecycle.service');

test('seller transitions follow the dashboard flow', () => {
  assert.equal(validateSellerTransition({ status: 'pending' }, 'confirmed').ok, true);
  assert.equal(validateSellerTransition({ status: 'confirmed' }, 'preparing').ok, true);
  assert.equal(validateSellerTransition({ status: 'preparing' }, 'ready').ok, true);
  assert.equal(validateSellerTransition({ status: 'ready' }, 'out_for_delivery').ok, true);
  assert.equal(validateSellerTransition({ status: 'out_for_delivery' }, 'delivered').ok, true);
});

test('seller cannot skip backwards or move terminal orders', () => {
  assert.equal(validateSellerTransition({ status: 'ready' }, 'pending').ok, false);
  assert.equal(validateSellerTransition({ status: 'delivered' }, 'cancelled').ok, false);
  assert.equal(validateSellerTransition({ status: 'cancelled' }, 'confirmed').ok, false);
  assert.equal(validateSellerTransition({ status: 'pending' }, 'pending').ok, false);
  assert.equal(validateSellerTransition({ status: 'pending' }, 'bogus').ok, false);
});

test('seller cannot take over pickup/delivery once a rider is assigned', () => {
  const order = { status: 'ready', deliveryPartnerId: 'rider1', deliveryStatus: 'assigned' };
  assert.equal(validateSellerTransition(order, 'out_for_delivery').ok, false);
  assert.equal(validateSellerTransition(order, 'cancelled').ok, true);
  assert.equal(validateSellerTransition({ ...order, deliveryStatus: 'picked_up' }, 'cancelled').ok, false);
});

test('customer may cancel only before the food is ready and before pickup', () => {
  assert.equal(validateCustomerCancel({ status: 'pending' }).ok, true);
  assert.equal(validateCustomerCancel({ status: 'preparing' }).ok, true);
  assert.equal(validateCustomerCancel({ status: 'ready' }).ok, false);
  assert.equal(validateCustomerCancel({ status: 'out_for_delivery' }).ok, false);
  assert.equal(validateCustomerCancel({ status: 'preparing', deliveryStatus: 'picked_up' }).ok, false);
});

test('rider leg: assigned → arrived → picked up; aliases accepted', () => {
  assert.deepEqual(validateRiderTransition({ status: 'preparing', deliveryStatus: 'assigned' }, 'arrived_at_restaurant'), { ok: true, next: 'arrived_at_restaurant' });
  assert.deepEqual(validateRiderTransition({ status: 'ready', deliveryStatus: 'arrived_at_restaurant' }, 'order_picked_up'), { ok: true, next: 'picked_up' });
  assert.deepEqual(validateRiderTransition({ status: 'ready', deliveryStatus: 'assigned' }, 'picked'), { ok: true, next: 'picked_up' });
  assert.equal(normalizeRiderStatus('accepted'), 'assigned');
  assert.equal(normalizeRiderStatus('nope'), null);
});

test('rider leg rejects invalid or repeated steps', () => {
  assert.equal(validateRiderTransition({ status: 'ready', deliveryStatus: 'picked_up' }, 'arrived_at_restaurant').ok, false);
  const repeat = validateRiderTransition({ status: 'ready', deliveryStatus: 'arrived_at_restaurant' }, 'arrived_at_restaurant');
  assert.equal(repeat.ok, false);
  assert.equal(repeat.idempotent, true);
  assert.equal(validateRiderTransition({ status: 'cancelled', deliveryStatus: 'assigned' }, 'picked_up').ok, false);
  assert.equal(validateRiderTransition({ status: 'pending', deliveryStatus: 'assigned' }, 'picked_up').ok, false);
});

test('delivery completion requires pickup and is idempotent', () => {
  assert.equal(validateDeliveryCompletion({ status: 'ready', deliveryStatus: 'assigned' }).ok, false);
  assert.equal(validateDeliveryCompletion({ status: 'out_for_delivery', deliveryStatus: 'picked_up' }).ok, true);
  assert.equal(validateDeliveryCompletion({ status: 'out_for_delivery' }).ok, true); // legacy orders
  const again = validateDeliveryCompletion({ status: 'delivered' });
  assert.equal(again.ok, false);
  assert.equal(again.idempotent, true);
  assert.equal(validateDeliveryCompletion({ status: 'cancelled' }).ok, false);
});

test('rider payout uses riderPayout, then deliveryFee, then 30', () => {
  assert.equal(getRiderPayout({ riderPayout: 45, deliveryFee: 60 }), 45);
  assert.equal(getRiderPayout({ deliveryFee: 60 }), 60);
  assert.equal(getRiderPayout({}), 30);
});
