/**
 * End-to-end business flow over real HTTP against the real server.js
 * (isolated in-memory MongoDB, no third-party services).
 *
 *   seller registers (pending) → excluded from discovery → admin approves → seller adds menu →
 *   customer registers → website + app discovery agree (21 km rule) → order placed and
 *   validated server-side → receipt identical for website, app and stored order.
 *
 * Human-only step: email/SMS verification OTP. The test reads the code the server generated
 * from the test database (the same code a user would receive) and submits it through the
 * normal /auth/verify-email endpoint — the security check itself is not bypassed.
 * Fixture: the admin account is inserted directly (admins are created by setup scripts, not
 * by public registration).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const User = require('../models/User');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const Order = require('../models/Order');

// ── Fixtures ([lng, lat]) ───────────────────────────────────────────────────
const CUSTOMER_POINT = [76.7720, 30.7320]; // Sector 22, Chandigarh
const NEAR_POINT = [76.7794, 30.7333]; // Sector 17, ~0.7 km
const northOf = ([lng, lat], km) => [lng, lat + (km / 6371) * (180 / Math.PI)];
const JUST_INSIDE = northOf(CUSTOMER_POINT, 20.95);
const JUST_OUTSIDE = northOf(CUSTOMER_POINT, 21.05);
const PASSWORD = 'Test-pass-123';

let server;
let base;
const state = {};

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  srv.on('error', reject);
});

/** JSON request helper → { status, body } */
const api = async (method, url, { token, body, headers = {} } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
};

const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();

/** Register through the public endpoint, verify with the server-issued code, sign in */
const registerVerifyLogin = async (payload) => {
  const reg = await api('POST', '/auth/register', { body: { password: PASSWORD, ...payload } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const userDoc = await User.findOne({ email: payload.email.toLowerCase() }).lean();
  const ver = await api('POST', '/auth/verify-email', { body: { email: payload.email, code: userDoc.emailVerificationCode } });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const login = await api('POST', '/auth/login', { body: { email: payload.email, password: PASSWORD, role: payload.role || 'user' } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { token: login.body.token, userId: login.body.user._id, registration: reg.body };
};

const registerSellerAt = async (n, point) => {
  const s = await registerVerifyLogin({
    role: 'seller', name: `Chef ${n}`, email: `seller${n}@e2e.test`, phone: `98100000${String(n).padStart(2, '0')}`,
    businessName: `Kitchen ${n}`, type: 'home_chef', address: `House ${n}`,
  });
  const profile = await api('PUT', '/seller/profile', {
    token: s.token,
    body: { address: { street: `House ${n}`, city: '', state: 'Chandigarh', pincode: '160017', fullAddress: `House ${n}, Chandigarh`, location: { type: 'Point', coordinates: point } } },
  });
  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  const seller = await Seller.findOne({ userId: s.userId }).lean();
  return { ...s, sellerId: String(seller._id) };
};

// The exact query shapes each client sends (dabba-delights UserHome.tsx / user-app HomeScreen.tsx)
const websiteDiscovery = async (point) => {
  const sellers = await api('GET', `/user/sellers/nearby?${query({ lat: point[1], lng: point[0], radius: 50000, city: 'Sector 22, Chandigarh' })}`);
  const ids = (sellers.body.sellers || []).map(s => s._id);
  const menu = ids.length ? await api('GET', `/user/menu?${query({ sellerIds: ids.join(',') })}`) : { body: { products: [] } };
  return { sellers: sellers.body.sellers || [], products: menu.body.products || [] };
};
const appDiscovery = async (point) => {
  const sellers = await api('GET', `/user/sellers/nearby?${query({ lat: point[1], lng: point[0], city: 'Sector 22, Chandigarh' })}`);
  const ids = (sellers.body.sellers || []).map(s => s._id);
  const menu = ids.length ? await api('GET', `/user/menu?${query({ sellerIds: ids.join(','), lat: point[1], lng: point[0], city: 'Sector 22, Chandigarh' })}`) : { body: { products: [] } };
  return { sellers: sellers.body.sellers || [], products: menu.body.products || [] };
};
const summarize = ({ sellers, products }) => ({
  sellerIds: sellers.map(s => String(s._id)).sort(),
  items: products.map(p => ({ id: String(p._id), sellerId: String(p.sellerId?._id || p.sellerId), name: p.name, price: p.sellingPrice }))
    .sort((a, b) => a.id.localeCompare(b.id)),
});

const deliveryAddress = (point = CUSTOMER_POINT) => ({
  street: 'House 12, Sector 22-A', city: 'Chandigarh', state: 'Chandigarh', pincode: '160022',
  location: point ? { type: 'Point', coordinates: point } : undefined,
});

before(async () => {
  const port = await freePort();
  server = spawn(process.execPath, [path.join(__dirname, 'helpers', 'test-server.js'), String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`test server did not start:\n${log.slice(-3000)}`)), 120000);
    server.stdout.on('data', (d) => {
      log += d;
      const m = String(log).match(/TEST_SERVER_READY (\{.*\})/);
      if (m) { clearTimeout(timer); resolve(JSON.parse(m[1])); }
    });
    server.stderr.on('data', (d) => { log += d; });
    server.on('exit', (code) => reject(new Error(`test server exited ${code}:\n${log.slice(-3000)}`)));
  });
  base = `http://127.0.0.1:${ready.port}/api`;
  await mongoose.connect(ready.mongoUri);

  // Admin fixture (admins are never created through public registration)
  await User.create({ name: 'E2E Admin', email: 'admin@e2e.test', password: PASSWORD, role: 'admin', isVerified: true });
  const adminLogin = await api('POST', '/auth/login', { body: { email: 'admin@e2e.test', password: PASSWORD, role: 'admin' } });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
  state.adminToken = adminLogin.body.token;
});

after(async () => {
  await mongoose.disconnect().catch(() => {});
  if (server && server.exitCode === null) server.kill('SIGTERM');
});

// ── Security regressions found during the audit ────────────────────────────
test('seed endpoints that wipe data are not reachable', async () => {
  const sellersBefore = await Seller.countDocuments();
  assert.equal((await api('GET', '/seed-all')).status, 404);
  assert.equal((await api('POST', '/seed-all')).status, 404);
  assert.equal((await api('POST', '/seed-all', { token: state.adminToken })).status, 404);
  assert.equal(await Seller.countDocuments(), sellersBefore);
});

test('public registration cannot create admin or delivery accounts', async () => {
  const r = await api('POST', '/auth/register', { body: { name: 'Mallory', email: 'mallory@e2e.test', password: PASSWORD, role: 'admin' } });
  assert.equal(r.status, 403);
  assert.equal(await User.countDocuments({ email: 'mallory@e2e.test' }), 0);
});

// ── Step 1: seller registration ────────────────────────────────────────────
test('step 1: seller registers and starts pending approval', async () => {
  const invalid = await api('POST', '/auth/register', { body: { role: 'seller', name: 'X', email: 'bad', password: PASSWORD } });
  assert.equal(invalid.status, 400);

  state.seller = await registerSellerAt(1, NEAR_POINT);
  assert.equal(state.seller.registration.seller.kycStatus, 'pending');

  const user = await User.findById(state.seller.userId).select('+password').lean();
  assert.equal(user.role, 'seller');
  assert.notEqual(user.password, PASSWORD);
  assert.match(user.password, /^\$2[aby]\$/); // bcrypt hash
  const seller = await Seller.findById(state.seller.sellerId).lean();
  assert.equal(seller.kycStatus, 'pending');
  assert.equal(seller.isActive, false);
  assert.deepEqual(seller.address.location.coordinates, NEAR_POINT);

  // Duplicate email is rejected and does not touch the existing account
  const dup = await api('POST', '/auth/register', { body: { role: 'seller', name: 'Dup', email: 'seller1@e2e.test', password: 'Other-pass-1', phone: '9810000001', businessName: 'Dup' } });
  assert.equal(dup.status, 409);
  assert.equal(await Seller.countDocuments({ userId: state.seller.userId }), 1);
});

test('step 1: pending seller cannot add menu items and is invisible to customers', async () => {
  const create = await api('POST', '/products', { token: state.seller.token, body: { name: 'Early Thali', category: 'Thali', sellingPrice: 120 } });
  assert.equal(create.status, 403);
  assert.equal(create.body.requiresKYC, true);
  assert.equal(await Product.countDocuments({ sellerId: state.seller.sellerId }), 0);

  const web = await websiteDiscovery(CUSTOMER_POINT);
  const app = await appDiscovery(CUSTOMER_POINT);
  assert.ok(!web.sellers.some(s => s._id === state.seller.sellerId));
  assert.ok(!app.sellers.some(s => s._id === state.seller.sellerId));
  assert.equal((await api('GET', `/user/sellers/${state.seller.sellerId}`)).status, 404);
  const all = await api('GET', '/user/sellers');
  assert.ok(!all.body.sellers.some(s => s._id === state.seller.sellerId));
});

// ── Step 2: admin approval ─────────────────────────────────────────────────
test('step 2: only an admin can approve; approval is persisted and visible to the seller', async () => {
  const pendingList = await api('GET', '/admin/sellers?status=pending', { token: state.adminToken });
  assert.equal(pendingList.status, 200);
  const listed = pendingList.body.sellers.find(s => s._id === state.seller.sellerId);
  assert.ok(listed, 'new seller appears in the admin pending list');
  assert.equal(listed.businessName, 'Kitchen 1');
  assert.equal(listed.userId.email, 'seller1@e2e.test');

  const someone = await registerVerifyLogin({ name: 'Nosy', email: 'nosy@e2e.test', phone: '9810000099' });
  for (const [label, token] of [['anonymous', undefined], ['customer', someone.token], ['seller', state.seller.token]]) {
    const r = await api('POST', `/admin/sellers/${state.seller.sellerId}/approve`, { token });
    assert.ok([401, 403].includes(r.status), `${label} got ${r.status}`);
  }
  assert.equal((await Seller.findById(state.seller.sellerId).lean()).kycStatus, 'pending');

  const approve = await api('POST', `/admin/sellers/${state.seller.sellerId}/approve`, { token: state.adminToken });
  assert.equal(approve.status, 200);
  const seller = await Seller.findById(state.seller.sellerId).lean();
  assert.equal(seller.kycStatus, 'verified');
  assert.equal(seller.isActive, true);

  const kyc = await api('GET', '/seller/kyc', { token: state.seller.token });
  assert.equal(kyc.status, 200);
  assert.equal(JSON.stringify(kyc.body).includes('verified'), true);
});

test('step 2: a rejected seller stays undiscoverable', async () => {
  const rejected = await registerSellerAt(5, NEAR_POINT);
  const r = await api('POST', `/admin/sellers/${rejected.sellerId}/reject`, { token: state.adminToken });
  assert.equal(r.status, 200);
  assert.equal((await Seller.findById(rejected.sellerId).lean()).kycStatus, 'rejected');
  const app = await appDiscovery(CUSTOMER_POINT);
  assert.ok(!app.sellers.some(s => s._id === rejected.sellerId));
  state.rejected = rejected;
});

// ── Step 3: menu management ────────────────────────────────────────────────
test('step 3: approved seller creates menu items (validated, owned, persisted)', async () => {
  const bad = await api('POST', '/products', { token: state.seller.token, body: { name: 'Bad', category: 'Thali', sellingPrice: -5 } });
  assert.equal(bad.status, 400);
  const noName = await api('POST', '/products', { token: state.seller.token, body: { category: 'Thali', sellingPrice: 50 } });
  assert.equal(noName.status, 400);

  // Spoofed sellerId / approval flags are ignored
  const thali = await api('POST', '/products', {
    token: state.seller.token,
    body: { name: 'Rajma Chawal Thali', description: 'Rajma, rice, 2 rotis', category: 'Thali', sellingPrice: 149, isVeg: true, sellerId: state.rejected.sellerId, isAdminApproved: true, rating: 5 },
  });
  assert.equal(thali.status, 201, JSON.stringify(thali.body));
  const paratha = await api('POST', '/products', { token: state.seller.token, body: { name: 'Aloo Paratha', category: 'Breakfast', sellingPrice: 99, isVeg: true } });
  const kheer = await api('POST', '/products', { token: state.seller.token, body: { name: 'Kheer', category: 'Dessert', sellingPrice: 60, isVeg: true } });
  state.items = { thali: thali.body.product._id, paratha: paratha.body.product._id, kheer: kheer.body.product._id };

  const dbThali = await Product.findById(state.items.thali).lean();
  assert.equal(String(dbThali.sellerId), state.seller.sellerId);
  assert.equal(dbThali.isAdminApproved, false);
  assert.equal(dbThali.rating, 0);
  assert.equal(dbThali.sellingPrice, 149);
  assert.equal(await Product.countDocuments({ sellerId: state.seller.sellerId }), 3);

  // The seller's own list returns exactly their items
  const mine = await api('GET', '/products?limit=100', { token: state.seller.token });
  assert.deepEqual(mine.body.products.map(p => String(p.sellerId?._id || p.sellerId)).filter(id => id !== state.seller.sellerId), []);
});

test('step 3: another seller cannot modify this seller\'s menu', async () => {
  state.inside = await registerSellerAt(3, JUST_INSIDE);
  await api('POST', `/admin/sellers/${state.inside.sellerId}/approve`, { token: state.adminToken });
  const insideItem = await api('POST', '/products', { token: state.inside.token, body: { name: 'Boundary Biryani', category: 'Main', sellingPrice: 199 } });
  assert.equal(insideItem.status, 201);
  state.items.boundary = insideItem.body.product._id;

  const attempts = [
    ['PUT', `/products/${state.items.thali}`, { sellingPrice: 1 }],
    ['PATCH', `/products/${state.items.thali}/price`, { sellingPrice: 1 }],
    ['PATCH', `/products/${state.items.thali}/toggle`, undefined],
    ['PATCH', `/products/${state.items.thali}/out-of-stock`, undefined],
    ['PATCH', `/products/${state.items.thali}/archive`, undefined],
    ['DELETE', `/products/${state.items.thali}`, undefined],
  ];
  for (const [method, url, body] of attempts) {
    const r = await api(method, url, { token: state.inside.token, body });
    assert.equal(r.status, 404, `${method} ${url} -> ${r.status}`);
  }
  const dbThali = await Product.findById(state.items.thali).lean();
  assert.equal(dbThali.sellingPrice, 149);
  assert.equal(dbThali.isAvailable, true);
});

// ── Step 4: customer registration ──────────────────────────────────────────
test('step 4: customer registers, verifies and signs in with a separate role', async () => {
  state.customer = await registerVerifyLogin({ name: 'Aarav Sharma', email: 'Aarav@E2E.test', phone: '+91 98765 00001' });
  const user = await User.findById(state.customer.userId).select('+password').lean();
  assert.equal(user.role, 'user');
  assert.equal(user.email, 'aarav@e2e.test');
  assert.match(user.password, /^\$2[aby]\$/);
  assert.equal(user.isVerified, true);

  const dup = await api('POST', '/auth/register', { body: { name: 'Again', email: 'aarav@e2e.test', password: PASSWORD } });
  assert.equal(dup.status, 409);

  // Account-takeover attempt: "register as seller" with the customer's email but another password
  const takeover = await api('POST', '/auth/register', {
    body: { role: 'seller', name: 'Evil', email: 'aarav@e2e.test', password: 'Evil-pass-999', phone: '9810000077', businessName: 'Evil Eats' },
  });
  assert.equal(takeover.status, 409);
  const after = await User.findById(state.customer.userId).lean();
  assert.equal(after.role, 'user');
  const relogin = await api('POST', '/auth/login', { body: { email: 'aarav@e2e.test', password: PASSWORD, role: 'user' } });
  assert.equal(relogin.status, 200);

  // A customer token cannot act as a seller
  const asSeller = await api('POST', '/products', { token: state.customer.token, body: { name: 'x', category: 'y', sellingPrice: 10 } });
  assert.equal(asSeller.status, 403);
});

// ── Steps 5 & 6: discovery and menus on both platforms ─────────────────────
test('steps 5-6: website and app return the same eligible sellers and menus (21 km rule)', async () => {
  state.outside = await registerSellerAt(2, JUST_OUTSIDE);
  await api('POST', `/admin/sellers/${state.outside.sellerId}/approve`, { token: state.adminToken });
  await api('POST', '/products', { token: state.outside.token, body: { name: 'Far Dal', category: 'Main', sellingPrice: 120 } });
  state.pending = await registerSellerAt(4, CUSTOMER_POINT); // never approved

  const web = summarize(await websiteDiscovery(CUSTOMER_POINT));
  const app = summarize(await appDiscovery(CUSTOMER_POINT));

  assert.deepEqual(web, app, 'website and app see identical sellers, items and prices');
  assert.deepEqual(web.sellerIds, [state.seller.sellerId, state.inside.sellerId].sort());
  assert.ok(!web.sellerIds.includes(state.outside.sellerId), '21.05 km seller excluded');
  assert.ok(!web.sellerIds.includes(state.pending.sellerId), 'pending seller excluded');
  assert.ok(!web.sellerIds.includes(state.rejected.sellerId), 'rejected seller excluded');

  const thali = web.items.find(i => i.id === state.items.thali);
  assert.equal(thali.price, 149);
  assert.equal(thali.name, 'Rajma Chawal Thali');

  // Menu data comes from persisted records
  const dbIds = (await Product.find({ sellerId: { $in: [state.seller.sellerId, state.inside.sellerId] } }).distinct('_id')).map(String).sort();
  assert.deepEqual(web.items.map(i => i.id).sort(), dbIds);

  // Distance is reported from the server, not the client
  const nearby = await api('GET', `/user/sellers/nearby?${query({ lat: CUSTOMER_POINT[1], lng: CUSTOMER_POINT[0] })}`);
  const boundary = nearby.body.sellers.find(s => s._id === state.inside.sellerId);
  assert.ok(boundary.distanceKm >= 20.9 && boundary.distanceKm <= 21, String(boundary.distanceKm));

  // Seller detail is the same record for both clients
  const detail = await api('GET', `/user/sellers/${state.seller.sellerId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.seller.businessName, 'Kitchen 1');
  assert.equal(detail.body.seller.type, 'home_chef');
});

test('steps 5-6: missing or invalid customer coordinates never leak distant sellers', async () => {
  for (const q of ['', 'lat=0&lng=0', 'lat=abc&lng=xyz']) {
    const r = await api('GET', `/user/sellers/nearby?${q}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.sellers, [], q);
  }
});

test('step 6: price and availability changes propagate to both platforms', async () => {
  const price = await api('PATCH', `/products/${state.items.thali}/price`, { token: state.seller.token, body: { sellingPrice: 159 } });
  assert.equal(price.status, 200);
  const off = await api('PATCH', `/products/${state.items.kheer}/out-of-stock`, { token: state.seller.token });
  assert.equal(off.status, 200);

  const web = summarize(await websiteDiscovery(CUSTOMER_POINT));
  const app = summarize(await appDiscovery(CUSTOMER_POINT));
  assert.deepEqual(web, app);
  assert.equal(web.items.find(i => i.id === state.items.thali).price, 159);
  assert.ok(!web.items.some(i => i.id === state.items.kheer), 'unavailable item hidden');
  assert.equal((await Product.findById(state.items.kheer).lean()).isAvailable, false);
});

// ── Step 7: order placement ────────────────────────────────────────────────
const appOrderPayload = (overrides = {}) => ({
  // Shape sent by user-app CheckoutScreen (client prices are informational only)
  items: [
    { menuItemId: state.items.thali, name: 'Rajma Chawal Thali', sellingPrice: 159, quantity: 2 },
    { menuItemId: state.items.paratha, name: 'Aloo Paratha', sellingPrice: 99, quantity: 1 },
  ],
  sellerId: state.seller.sellerId,
  deliveryAddress: deliveryAddress(),
  paymentMethod: 'cod',
  subtotal: 417,
  totalAmount: 0,
  ...overrides,
});

test('step 7: invalid orders are rejected by the backend and create nothing', async () => {
  const before = await Order.countDocuments();
  const cases = [
    ['no token', { token: null, body: appOrderPayload() }, 401],
    ['modified price', { body: appOrderPayload({ subtotal: 10, items: [{ menuItemId: state.items.thali, sellingPrice: 1, quantity: 2 }] }) }, 409],
    ['missing coordinates', { body: appOrderPayload({ deliveryAddress: deliveryAddress(null) }) }, 400],
    ['invalid coordinates', { body: appOrderPayload({ deliveryAddress: { ...deliveryAddress(), location: { type: 'Point', coordinates: [0, 0] } } }) }, 400],
    ['missing street', { body: appOrderPayload({ deliveryAddress: { ...deliveryAddress(), street: '' } }) }, 400],
    ['seller outside 21 km', { body: { ...appOrderPayload(), sellerId: state.outside.sellerId, items: [{ menuItemId: (await Product.findOne({ sellerId: state.outside.sellerId }).lean())._id, quantity: 1 }], subtotal: 120 } }, 400],
    ['unapproved seller', { body: { ...appOrderPayload(), sellerId: state.pending.sellerId, subtotal: undefined } }, 409],
    ['unavailable item', { body: appOrderPayload({ items: [{ menuItemId: state.items.kheer, quantity: 1 }], subtotal: 60 }) }, 409],
    ['item of another seller', { body: appOrderPayload({ items: [{ menuItemId: state.items.thali, quantity: 1 }, { menuItemId: state.items.boundary, quantity: 1 }], subtotal: undefined }) }, 400],
    ['zero quantity', { body: appOrderPayload({ items: [{ menuItemId: state.items.thali, quantity: 0 }], subtotal: undefined }) }, 400],
    ['unknown payment method', { body: appOrderPayload({ paymentMethod: 'bitcoin' }) }, 400],
    ['wallet without balance', { body: appOrderPayload({ paymentMethod: 'wallet' }) }, 400],
  ];
  for (const [label, opts, expected] of cases) {
    const token = 'token' in opts ? opts.token : state.customer.token;
    const r = await api('POST', '/user/orders/place', { token, body: opts.body });
    assert.equal(r.status, expected, `${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  assert.equal(await Order.countDocuments(), before, 'no partial orders');
  assert.equal((await User.findById(state.customer.userId).lean()).wallet, 0, 'wallet untouched');
});

test('step 7: valid order is priced server-side and persisted with the right customer and seller', async () => {
  // The checkout screens on both platforms display this quote
  const quote = await api('POST', '/user/orders/quote', { token: state.customer.token, body: appOrderPayload() });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  const webQuote = await api('POST', '/user/orders/quote', {
    token: state.customer.token,
    body: { sellerId: state.seller.sellerId, items: [{ menuItemId: state.items.thali, quantity: 2 }, { menuItemId: state.items.paratha, quantity: 1 }], deliveryAddress: deliveryAddress() },
  });
  assert.deepEqual(webQuote.body.quote, quote.body.quote, 'same cart → same quote regardless of client');
  // Checkout shows the price before the street is typed; placing still requires it (tested above)
  const noStreet = await api('POST', '/user/orders/quote', { token: state.customer.token, body: { ...appOrderPayload(), deliveryAddress: { location: deliveryAddress().location } } });
  assert.equal(noStreet.status, 200, JSON.stringify(noStreet.body));
  assert.equal(noStreet.body.quote.grandTotal, quote.body.quote.grandTotal);
  assert.equal(quote.body.quote.subtotal, 417);
  assert.equal(quote.body.quote.deliveryFee, 30);

  const placed = await api('POST', '/user/orders/place', {
    token: state.customer.token,
    body: appOrderPayload({ idempotencyKey: 'checkout-1' }),
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const orderId = placed.body.order._id;
  state.orderId = orderId;

  const order = await Order.findById(orderId).lean();
  assert.equal(String(order.userId), state.customer.userId);
  assert.equal(String(order.sellerId), state.seller.sellerId);
  assert.match(order.orderNumber, /^DN-\d{8}-\d{4}$/);
  assert.deepEqual(order.items.map(i => [String(i.menuItemId), i.sellingPrice, i.quantity]), [
    [state.items.thali, 159, 2],
    [state.items.paratha, 99, 1],
  ]);
  assert.equal(order.subtotal, 417);
  assert.equal(order.deliveryFee, 30); // 0.7 km → first slab
  assert.ok(order.deliveryDistanceKm > 0.5 && order.deliveryDistanceKm < 1, String(order.deliveryDistanceKm));
  assert.equal(order.total, Math.round((order.subtotal + (order.gstAmount || 0) + order.deliveryFee) * 100) / 100);
  assert.equal(order.total, quote.body.quote.grandTotal, 'customer is charged exactly the quoted total');
  assert.equal(order.paymentMethod, 'cod');
  assert.equal(order.paymentStatus, 'pending');
  assert.equal(order.status, 'pending');
  assert.equal(order.discount, 0);
  assert.deepEqual(order.dropLocation.coordinates, CUSTOMER_POINT);
  assert.deepEqual(order.pickupLocation.coordinates, NEAR_POINT);

  // Retry with the same idempotency key returns the same order
  const retry = await api('POST', '/user/orders/place', { token: state.customer.token, body: appOrderPayload({ idempotencyKey: 'checkout-1' }) });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.order._id, orderId);
  assert.equal(await Order.countDocuments({ userId: state.customer.userId }), 1);
});

test('step 7: a seller just inside the radius can be ordered from (web payload shape)', async () => {
  const web = await api('POST', '/user/orders/place', {
    token: state.customer.token,
    body: {
      // Shape sent by dabba-delights CheckoutPage (hybrid → online, payment pending verification)
      items: [{ menuItemId: state.items.boundary, name: 'Boundary Biryani', sellingPrice: 199, quantity: 1, selectedSize: undefined }],
      sellerId: state.inside.sellerId,
      deliveryAddress: deliveryAddress(),
      paymentMethod: 'hybrid',
      totalAmount: 999,
      subtotal: 199,
      platformFee: 0,
      transactionId: 'UTR123456789',
    },
  });
  assert.equal(web.status, 201, JSON.stringify(web.body));
  const order = await Order.findById(web.body.order._id).lean();
  assert.equal(order.paymentMethod, 'online');
  assert.equal(order.paymentStatus, 'pending', 'unverified UPI payment is not marked paid');
  assert.equal(order.paymentReference, 'UTR123456789');
  assert.ok(order.deliveryDistanceKm > 20.9 && order.deliveryDistanceKm <= 21);
  state.onlineOrderId = order._id.toString();
});

test('step 7: seller that becomes unapproved before checkout is rejected', async () => {
  await api('POST', `/admin/sellers/${state.inside.sellerId}/reject`, { token: state.adminToken });
  const r = await api('POST', '/user/orders/place', {
    token: state.customer.token,
    body: { items: [{ menuItemId: state.items.boundary, quantity: 1 }], sellerId: state.inside.sellerId, deliveryAddress: deliveryAddress(), paymentMethod: 'cod' },
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'SELLER_UNAVAILABLE');
});

test('step 7: payment verification — forged Razorpay signature rejected, only admins confirm UPI', async () => {
  const forged = await api('POST', '/payment/razorpay/verify', {
    token: state.customer.token,
    body: { orderId: state.onlineOrderId, razorpayOrderId: 'order_x', razorpayPaymentId: 'pay_x', razorpaySignature: 'f'.repeat(64) },
  });
  assert.equal(forged.status, 400);
  assert.equal((await Order.findById(state.onlineOrderId).lean()).paymentStatus, 'pending');

  const byCustomer = await api('PATCH', `/admin/orders/${state.onlineOrderId}/payment`, { token: state.customer.token, body: { status: 'paid' } });
  assert.equal(byCustomer.status, 403);
  const byAdmin = await api('PATCH', `/admin/orders/${state.onlineOrderId}/payment`, { token: state.adminToken, body: { status: 'paid' } });
  assert.equal(byAdmin.status, 200);
  const order = await Order.findById(state.onlineOrderId).lean();
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.paymentVerifiedBy, 'admin');
});

// ── Step 8: receipts ───────────────────────────────────────────────────────
test('step 8: receipt matches the persisted order and is identical for website and app', async () => {
  const order = await Order.findById(state.orderId).lean();
  // Both clients call the same endpoint (dabba-delights userAPI.getOrderReceipt, user-app api.user.getOrderReceipt)
  const forWeb = await api('GET', `/invoice/receipt/${state.orderId}`, { token: state.customer.token });
  const forApp = await api('GET', `/invoice/receipt/${state.orderId}`, { token: state.customer.token });
  assert.equal(forWeb.status, 200, JSON.stringify(forWeb.body));
  assert.deepEqual(forWeb.body.receipt, forApp.body.receipt);

  const r = forWeb.body.receipt;
  assert.equal(r.orderId, state.orderId);
  assert.equal(r.orderNumber, order.orderNumber);
  assert.equal(r.customer.name, 'Aarav Sharma');
  assert.equal(r.seller.name, 'Kitchen 1');
  assert.deepEqual(r.items.map(i => [i.name, i.quantity, i.unitPrice, i.lineTotal]), [
    ['Rajma Chawal Thali', 2, 159, 318],
    ['Aloo Paratha', 1, 99, 99],
  ]);
  assert.equal(r.summary.itemTotal, order.subtotal);
  assert.equal(r.summary.deliveryFee, order.deliveryFee);
  assert.equal(r.summary.grandTotal, order.total);
  assert.equal(r.payment.method, 'cod');
  assert.equal(r.payment.status, 'pending');
  assert.equal(r.integrity.itemsMatchSubtotal, true);
  assert.equal(r.integrity.componentsMatchTotal, true);

  // Order detail endpoint (used by both order screens) agrees with the receipt
  const detail = await api('GET', `/user/orders/${state.orderId}`, { token: state.customer.token });
  const d = detail.body.order || detail.body;
  assert.equal(d.total, r.summary.grandTotal);
  assert.equal(d.orderNumber, r.orderNumber);
});

test('step 8: receipts and invoices are private to the order\'s customer, seller and admins', async () => {
  const stranger = await registerVerifyLogin({ name: 'Stranger', email: 'stranger@e2e.test', phone: '9810000098' });
  const url = `/invoice/receipt/${state.orderId}`;
  assert.equal((await api('GET', url, { token: stranger.token })).status, 404);
  assert.equal((await api('GET', url, { token: state.outside.token })).status, 404, 'other seller');
  assert.equal((await api('GET', url)).status, 401);
  assert.equal((await api('GET', url, { token: state.seller.token })).status, 200, 'fulfilling seller');
  assert.equal((await api('GET', url, { token: state.adminToken })).status, 200, 'admin');
  assert.equal((await api('POST', `/invoice/generate/${state.orderId}`, { token: stranger.token })).status, 404);
  assert.equal((await api('GET', `/invoice/download/${state.orderId}?token=${stranger.token}`)).status, 403);
});

test('step 8: invoice PDF downloads for the customer', { timeout: 180000 }, async () => {
  const res = await fetch(`${base}/invoice/download/${state.orderId}?token=${state.customer.token}`);
  if (res.status !== 200) {
    const body = await res.text();
    assert.fail(`invoice download returned ${res.status}: ${body.slice(0, 300)}`);
  }
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  assert.ok(buf.length > 1000);
});

test('steps 7-8 with GST on: quote, stored order and receipt agree to the paisa', async () => {
  const gst = await api('POST', '/admin/gst', {
    token: state.adminToken,
    body: { gstApplicable: true, foodGSTEnabled: true, foodGST: 5, deliveryGSTEnabled: true, deliveryCGSTRate: 9, deliverySGSTRate: 9 },
  });
  assert.equal(gst.status, 200, JSON.stringify(gst.body));

  const cart = { sellerId: state.seller.sellerId, items: [{ menuItemId: state.items.paratha, quantity: 3 }], deliveryAddress: deliveryAddress(), paymentMethod: 'cod' };
  const quote = await api('POST', '/user/orders/quote', { token: state.customer.token, body: cart });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  const q = quote.body.quote;
  assert.equal(q.subtotal, 297);
  assert.equal(q.foodGst, 14.85); // 5% of 297
  assert.equal(q.deliveryGst, 5.4); // 18% of ₹30 delivery
  assert.equal(q.grandTotal, 297 + 14.85 + 30 + 5.4);

  const placed = await api('POST', '/user/orders/place', { token: state.customer.token, body: { ...cart, idempotencyKey: 'gst-order-1' } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const order = await Order.findById(placed.body.order._id).lean();
  assert.equal(Math.round(order.total * 100) / 100, q.grandTotal);
  assert.equal(order.gstMode, 'intra');

  const receipt = (await api('GET', `/invoice/receipt/${order._id}`, { token: state.customer.token })).body.receipt;
  assert.equal(receipt.summary.grandTotal, q.grandTotal);
  assert.equal(receipt.summary.taxTotal, q.taxTotal);
  assert.equal(receipt.integrity.componentsMatchTotal, true);
});
