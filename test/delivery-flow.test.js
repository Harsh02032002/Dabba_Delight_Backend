/**
 * End-to-end order → rider → customer flow against an in-memory MongoDB.
 * Never touches the real database. Push delivery is not exercised (no device tokens).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'dummy';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Order = require('../models/Order');
const User = require('../models/User');
const Seller = require('../models/Seller');
const { DeliveryPartner, Notification, WalletTransaction } = require('../models/Others');
const deliveryController = require('../controllers/delivery.controller');
const orderController = require('../controllers/order.controller');
const { createAndSendNotification } = require('../utils/pushNotification.service');

let mongod;

// Chandigarh fixtures ([lng, lat])
const SELLER_POINT = [76.7794, 30.7333];
const CUSTOMER_POINT = [76.7720, 30.7320];
const NEAR_RIDER = [76.7750, 30.7350];
const FAR_RIDER = [77.2090, 28.6139]; // Delhi

const makeIo = () => {
  const events = [];
  return {
    events,
    to: (room) => ({ emit: (event, payload) => events.push({ room, event, payload }) }),
    emit: (event, payload) => events.push({ room: '*', event, payload }),
  };
};

const call = (handler, { params = {}, body = {}, user, io }) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
  };
  const req = { params, body, user, app: { get: (k) => (k === 'io' ? io : undefined) } };
  Promise.resolve(handler(req, res)).catch(reject);
});

let seq = 0;
const mkUser = (role, extra = {}) => {
  seq += 1;
  return User.create({ name: `${role}${seq}`, email: `${role}${seq}@test.dev`, password: 'secret123', phone: `90000000${String(seq).padStart(2, '0')}`, role, ...extra });
};

const mkRider = async (point, name) => {
  const user = await mkUser('delivery');
  const partner = await DeliveryPartner.create({
    userId: user._id, name, phone: `98${String(seq).padStart(8, '0')}`,
    isOnline: true, isAvailable: true,
    // Riders must be KYC-verified and admin-approved to receive/accept orders
    kycStatus: 'verified', isApproved: true,
    currentLocation: { type: 'Point', coordinates: point },
  });
  return { user, partner };
};

let customer, sellerUser, seller;

const mkOrder = (extra = {}) => Order.create({
  userId: customer._id,
  sellerId: seller._id,
  items: [{ name: 'Thali', sellingPrice: 120, quantity: 1 }],
  status: 'confirmed',
  deliveryAddress: {
    street: 'House 12', city: 'Chandigarh', state: 'Chandigarh', pincode: '160022',
    location: { type: 'Point', coordinates: CUSTOMER_POINT },
  },
  subtotal: 120, deliveryFee: 50, riderPayout: 40, total: 175,
  paymentMethod: 'cod', paymentStatus: 'pending',
  statusHistory: [{ status: 'pending' }, { status: 'confirmed' }],
  ...extra,
});

const notificationsFor = (userId, title) => Notification.find({ userId, ...(title ? { title } : {}) }).lean();

before(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all([Order.init(), User.init(), Seller.init(), DeliveryPartner.init(), Notification.init(), WalletTransaction.init()]);
});

after(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([Order.deleteMany({}), User.deleteMany({}), Seller.deleteMany({}), DeliveryPartner.deleteMany({}), Notification.deleteMany({}), WalletTransaction.deleteMany({})]);
  customer = await mkUser('user');
  sellerUser = await mkUser('seller');
  seller = await Seller.create({
    userId: sellerUser._id, businessName: 'Test Kitchen', phone: '9111111111',
    address: { street: 'Sector 17', city: 'Chandigarh', state: 'Chandigarh', location: { type: 'Point', coordinates: SELLER_POINT } },
  });
});

test('seller confirm offers the order to nearby riders only, without assigning it', async () => {
  const io = makeIo();
  const near = await mkRider(NEAR_RIDER, 'Near');
  const far = await mkRider(FAR_RIDER, 'Far');
  const order = await mkOrder({ status: 'pending', statusHistory: [{ status: 'pending' }] });

  const res = await call(orderController.updateOrderStatus, {
    params: { id: order._id.toString() }, body: { status: 'confirmed' },
    user: { _id: sellerUser._id, role: 'seller', sellerId: seller._id }, io,
  });
  assert.equal(res.status, 200);

  const saved = await Order.findById(order._id);
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.deliveryPartnerId, undefined);

  const requestRooms = io.events.filter((e) => e.event === 'delivery_request').map((e) => e.room);
  assert.ok(requestRooms.includes(`delivery_partner_${near.partner._id}`));
  assert.ok(!requestRooms.includes(`delivery_partner_${far.partner._id}`));

  const payload = io.events.find((e) => e.event === 'delivery_request').payload;
  assert.equal(payload.customerPhone, undefined, 'no customer contact before acceptance');
  assert.ok(!String(payload.dropAddress).includes('House 12'), 'no street address before acceptance');

  assert.equal((await notificationsFor(near.user._id, 'New Delivery Request Nearby')).length, 1);
  assert.equal((await notificationsFor(far.user._id)).length, 0);
  assert.equal((await notificationsFor(customer._id, 'Order Confirmed & Cooking')).length, 1);
});

test('two riders accepting at the same time: exactly one wins', async () => {
  const io = makeIo();
  const a = await mkRider(NEAR_RIDER, 'A');
  const b = await mkRider(NEAR_RIDER, 'B');
  const order = await mkOrder();

  const [ra, rb] = await Promise.all([
    call(deliveryController.acceptOrder, { params: { orderId: order._id.toString() }, user: a.user, io }),
    call(deliveryController.acceptOrder, { params: { orderId: order._id.toString() }, user: b.user, io }),
  ]);
  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [200, 409]);

  const winner = ra.status === 200 ? a : b;
  const loser = ra.status === 200 ? b : a;
  const saved = await Order.findById(order._id);
  assert.equal(String(saved.deliveryPartnerId), String(winner.partner._id));
  assert.equal(saved.deliveryStatus, 'assigned');
  assert.equal(saved.status, 'confirmed', 'acceptance does not mark out_for_delivery before pickup');

  const loserDoc = await DeliveryPartner.findById(loser.partner._id);
  assert.equal(loserDoc.activeOrderId, null);
  assert.equal(loserDoc.isAvailable, true);

  assert.equal((await notificationsFor(customer._id, 'Delivery Partner Assigned')).length, 1);
  assert.equal((await notificationsFor(winner.user._id, 'Order Assigned to You')).length, 1);
  assert.ok(io.events.some((e) => e.room === 'delivery_partners' && e.event === 'delivery_request_taken'));
  assert.ok(io.events.some((e) => e.room === `user_${customer._id}` && e.event === 'order_status_update' && e.payload.deliveryStatus === 'assigned'));
});

test('a rider cannot hold more than one active delivery; re-accepting is idempotent', async () => {
  const io = makeIo();
  const a = await mkRider(NEAR_RIDER, 'A');
  const first = await mkOrder();
  const second = await mkOrder();

  assert.equal((await call(deliveryController.acceptOrder, { params: { orderId: first._id.toString() }, user: a.user, io })).status, 200);
  const again = await call(deliveryController.acceptOrder, { params: { orderId: first._id.toString() }, user: a.user, io });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyAccepted, true);

  const blocked = await call(deliveryController.acceptOrder, { params: { orderId: second._id.toString() }, user: a.user, io });
  assert.equal(blocked.status, 409);
  assert.equal((await Order.findById(second._id)).deliveryPartnerId, undefined);
});

test('pickup → out for delivery → OTP delivery credits the rider exactly once', async () => {
  const io = makeIo();
  const a = await mkRider(NEAR_RIDER, 'A');
  const order = await mkOrder({ status: 'ready' });
  const orderId = order._id.toString();
  await call(deliveryController.acceptOrder, { params: { orderId }, user: a.user, io });

  const realOtp = (await Order.findById(orderId).lean()).deliveryOtp;
  assert.match(realOtp, /^\d{4}$/);

  // Delivery cannot be confirmed before pickup
  const early = await call(deliveryController.confirmDeliveryOTP, { body: { orderId, otp: realOtp }, user: a.user, io });
  assert.equal(early.status, 409, JSON.stringify(early.body));

  // Another rider cannot drive this order
  const other = await mkRider(NEAR_RIDER, 'Other');
  const hijack = await call(deliveryController.updateDeliveryStatus, { body: { orderId, status: 'picked_up' }, user: other.user, io });
  assert.equal(hijack.status, 403);

  const arrived = await call(deliveryController.updateDeliveryStatus, { body: { orderId, status: 'arrived_at_restaurant' }, user: a.user, io });
  assert.equal(arrived.status, 200);
  assert.equal(arrived.body.order.deliveryStatus, 'arrived_at_restaurant');

  const picked = await call(deliveryController.updateDeliveryStatus, { body: { orderId, status: 'picked' }, user: a.user, io });
  assert.equal(picked.status, 200);
  assert.equal(picked.body.order.status, 'out_for_delivery');
  assert.equal((await notificationsFor(customer._id, 'Out for Delivery')).length, 1);

  // Only the customer's OTP completes the delivery; there is no universal fallback code
  for (const guess of ['1234', '0000'].filter(g => g !== realOtp)) {
    const wrong = await call(deliveryController.confirmDeliveryOTP, { body: { orderId, otp: guess }, user: a.user, io });
    assert.equal(wrong.status, 400, `OTP ${guess} must be rejected`);
  }
  const skip = await call(deliveryController.updateDeliveryStatus, { body: { orderId, status: 'delivered' }, user: a.user, io });
  assert.equal(skip.status, 400, 'status update cannot complete a delivery without the OTP');
  assert.equal((await Order.findById(orderId).lean()).status, 'out_for_delivery');

  // Double tap / retry: both succeed, money moves once
  const [d1, d2] = await Promise.all([
    call(deliveryController.confirmDeliveryOTP, { body: { orderId, otp: realOtp }, user: a.user, io }),
    call(deliveryController.confirmDeliveryOTP, { body: { orderId, otp: realOtp }, user: a.user, io }),
  ]);
  assert.equal(d1.status, 200);
  assert.equal(d2.status, 200);
  const d3 = await call(deliveryController.updateDeliveryStatus, { body: { orderId, status: 'delivered' }, user: a.user, io });
  assert.equal(d3.status, 200);

  const rider = await DeliveryPartner.findById(a.partner._id);
  assert.equal(rider.earnings, 40, 'riderPayout credited once');
  assert.equal(rider.todayEarnings, 40);
  assert.equal(rider.wallet, 40, 'payout lands in the withdrawable wallet');
  assert.equal(rider.totalDeliveries, 1);
  assert.equal(rider.activeOrderId, null);
  assert.equal(await WalletTransaction.countDocuments({ deliveryPartnerId: a.partner._id, referenceType: 'delivery_payout' }), 1);

  const saved = await Order.findById(orderId);
  assert.equal(saved.status, 'delivered');
  assert.equal(saved.paymentStatus, 'paid');
  assert.equal((await notificationsFor(customer._id, 'Order Delivered! Enjoy your meal')).length, 1);
  assert.equal((await notificationsFor(a.user._id, 'Delivery Completed')).length, 1);

  // Rider-completed delivery settles the seller exactly once (it used to only happen on seller self-delivery)
  const SellerWallet = require('../models/SellerWallet');
  assert.ok(saved.sellerSettledAt, 'order is marked settled');
  const sw = await SellerWallet.findOne({ seller_id: seller._id }).lean();
  assert.ok(sw && sw.total_earnings > 0 && sw.total_earnings <= 175, `seller credited: ${JSON.stringify(sw)}`);
  const cashback = await WalletTransaction.find({ userId: customer._id, description: /Cashback for order/ }).lean();
  assert.equal(cashback.length, 1, 'customer cashback once');
  const { settleDeliveredOrder } = require('../services/order-settlement.service');
  assert.equal((await settleDeliveredOrder(orderId)).settled, false, 'second settlement is a no-op');
  assert.equal((await SellerWallet.findOne({ seller_id: seller._id }).lean()).total_earnings, sw.total_earnings);
});

test('rider withdrawals never exceed the wallet balance', async () => {
  const io = makeIo();
  const r = await mkRider(NEAR_RIDER, 'Wallet');
  await DeliveryPartner.updateOne({ _id: r.partner._id }, { $set: { wallet: 100 } });

  const tooMuch = await call(deliveryController.withdrawFromWallet, { body: { amount: 150 }, user: r.user, io });
  assert.equal(tooMuch.status, 400);
  for (const bad of [0, -5, 'abc']) {
    const res = await call(deliveryController.withdrawFromWallet, { body: { amount: bad }, user: r.user, io });
    assert.equal(res.status, 400, `amount ${bad} rejected`);
  }
  assert.equal((await DeliveryPartner.findById(r.partner._id)).wallet, 100);

  // Two withdrawals of 70 at the same time: only one fits in 100
  const results = await Promise.all([
    call(deliveryController.withdrawFromWallet, { body: { amount: 70 }, user: r.user, io }),
    call(deliveryController.withdrawFromWallet, { body: { amount: 70 }, user: r.user, io }),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 400]);
  assert.equal((await DeliveryPartner.findById(r.partner._id)).wallet, 30);
  assert.equal(await WalletTransaction.countDocuments({ deliveryPartnerId: r.partner._id, referenceType: 'withdrawal' }), 1);
});

test('customer cancellation releases the assigned rider and cannot be repeated', async () => {
  const io = makeIo();
  const a = await mkRider(NEAR_RIDER, 'A');
  const order = await mkOrder({ status: 'preparing' });
  const orderId = order._id.toString();
  await call(deliveryController.acceptOrder, { params: { orderId }, user: a.user, io });

  const res = await call(orderController.cancelOrder, { params: { id: orderId }, user: customer, io });
  assert.equal(res.status, 200);
  assert.equal((await Order.findById(orderId)).status, 'cancelled');

  const rider = await DeliveryPartner.findById(a.partner._id);
  assert.equal(rider.activeOrderId, null);
  assert.equal(rider.isAvailable, true);
  assert.ok(io.events.some((e) => e.room === `delivery_partner_${a.partner._id}` && e.event === 'orderCancelled'));
  assert.equal((await notificationsFor(customer._id, 'Order Cancelled')).length, 1);
  assert.equal((await notificationsFor(a.user._id, 'Order Cancelled')).length, 1);

  const again = await call(orderController.cancelOrder, { params: { id: orderId }, user: customer, io });
  assert.equal(again.status, 400);
});

test('picked-up orders cannot be cancelled by customer or seller', async () => {
  const io = makeIo();
  const a = await mkRider(NEAR_RIDER, 'A');
  const order = await mkOrder({ status: 'ready' });
  const orderId = order._id.toString();
  await call(deliveryController.acceptOrder, { params: { orderId }, user: a.user, io });
  await call(deliveryController.updateDeliveryStatus, { body: { orderId, status: 'picked_up' }, user: a.user, io });

  assert.equal((await call(orderController.cancelOrder, { params: { id: orderId }, user: customer, io })).status, 400);
  const sellerCancel = await call(orderController.updateOrderStatus, {
    params: { id: orderId }, body: { status: 'cancelled' },
    user: { _id: sellerUser._id, role: 'seller', sellerId: seller._id }, io,
  });
  assert.equal(sellerCancel.status, 400);
  assert.equal((await Order.findById(orderId)).status, 'out_for_delivery');
});

test('seller ready notifies the customer and the assigned rider', async () => {
  const io = makeIo();
  const a = await mkRider(NEAR_RIDER, 'A');
  const order = await mkOrder({ status: 'preparing' });
  const orderId = order._id.toString();
  await call(deliveryController.acceptOrder, { params: { orderId }, user: a.user, io });

  const res = await call(orderController.updateOrderStatus, {
    params: { id: orderId }, body: { status: 'ready' },
    user: { _id: sellerUser._id, role: 'seller', sellerId: seller._id }, io,
  });
  assert.equal(res.status, 200);
  assert.equal((await notificationsFor(customer._id, 'Food is Ready')).length, 1);
  assert.equal((await notificationsFor(a.user._id, 'Order Ready for Pickup')).length, 1);
  assert.ok(io.events.some((e) => e.room === `delivery_partner_${a.partner._id}` && e.event === 'order_ready'));

  // Seller can no longer hand it out themselves
  const takeover = await call(orderController.updateOrderStatus, {
    params: { id: orderId }, body: { status: 'out_for_delivery' },
    user: { _id: sellerUser._id, role: 'seller', sellerId: seller._id }, io,
  });
  assert.equal(takeover.status, 400);
});

test('invalid seller transitions are rejected', async () => {
  const io = makeIo();
  const order = await mkOrder({ status: 'pending', statusHistory: [{ status: 'pending' }] });
  const res = await call(orderController.updateOrderStatus, {
    params: { id: order._id.toString() }, body: { status: 'delivered' },
    user: { _id: sellerUser._id, role: 'seller', sellerId: seller._id }, io,
  });
  assert.equal(res.status, 400);
  assert.equal((await Order.findById(order._id)).status, 'pending');
});

test('rider list hides customer identity until the order is accepted', async () => {
  const io = makeIo();
  const a = await mkRider(NEAR_RIDER, 'A');
  await mkOrder();
  const far = await mkRider(FAR_RIDER, 'Far');

  const list = await call(deliveryController.getAvailableOrders, { user: a.user, io });
  assert.equal(list.status, 200);
  assert.equal(list.body.orders.length, 1);
  const item = list.body.orders[0];
  assert.equal(item.customerPhone, '');
  assert.equal(item.deliveryAddress, undefined);
  assert.equal(item.isAssignedToMe, false);

  const farList = await call(deliveryController.getAvailableOrders, { user: far.user, io });
  assert.equal(farList.body.orders.length, 0, 'orders outside the service radius are not offered');

  await call(deliveryController.acceptOrder, { params: { orderId: item._id.toString() }, user: a.user, io });
  const mine = await call(deliveryController.getAvailableOrders, { user: a.user, io });
  assert.equal(mine.body.orders[0].isAssignedToMe, true);
  assert.ok(mine.body.orders[0].customerPhone);
});

test('lifecycle notifications are deduplicated per order/event/recipient', async () => {
  const io = makeIo();
  const orderId = new mongoose.Types.ObjectId();
  const args = { userId: customer._id, title: 'T', message: 'M', orderId, io, dedupeKey: `${orderId}:x:${customer._id}` };
  const results = await Promise.all([createAndSendNotification(args), createAndSendNotification(args)]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(await Notification.countDocuments({ userId: customer._id }), 1);
  // Socket emits go only to the recipient's room
  assert.ok(io.events.every((e) => e.room === `user_${customer._id}`));
});
