/**
 * Unit tests for the seller → admin → menu → customer → order → receipt business rules.
 * Pure functions only (no database). The HTTP flow is covered by e2e-business-flow.test.js.
 */
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'unit-test-secret';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { validateRegistration, isValidPhone } = require('../utils/registration');
const {
  SERVICE_RADIUS_KM, haversineKm, isValidCoords, isSellerEligible, isWithinServiceRadius, clampRadiusKm,
} = require('../utils/sellerGeo');
const { validateProductInput, sanitizeProductInput, getUnitPrice, getAvailabilityProblem } = require('../utils/productRules');
const { getCustomerDeliveryFee, computeDeliveryPricing } = require('../utils/deliveryPricing');
const { normalizePaymentMethod, initialPaymentStatus } = require('../services/order-pricing.service');
const { buildOrderReceipt } = require('../services/order-receipt.service');
const { computeOrderGSTAndCommission } = require('../services/gst-order.service');
const { isValidRazorpaySignature } = require('../controllers/payment.controller');

/** Point `km` kilometres due north of [lng, lat] (same longitude => pure latitude delta) */
const northOf = ([lng, lat], km) => [lng, lat + (km / 6371) * (180 / Math.PI)];
const SECTOR_17 = [76.7794, 30.7333];

describe('registration validation', () => {
  const base = { name: 'Asha', email: 'Asha@Example.com', password: 'secret12', phone: '9876543210' };

  test('customer registration defaults to role user and lower-cases email', () => {
    const r = validateRegistration(base);
    assert.equal(r.ok, true);
    assert.equal(r.value.role, 'user');
    assert.equal(r.value.email, 'asha@example.com');
  });

  test('admin and delivery roles cannot self-register', () => {
    for (const role of ['admin', 'delivery', 'superuser']) {
      const r = validateRegistration({ ...base, role });
      assert.equal(r.ok, false, role);
      assert.equal(r.status, 403);
    }
  });

  test('rejects missing name, bad email, short password, bad phone', () => {
    assert.equal(validateRegistration({ ...base, name: '  ' }).field, 'name');
    assert.equal(validateRegistration({ ...base, email: 'not-an-email' }).field, 'email');
    assert.equal(validateRegistration({ ...base, password: '123' }).field, 'password');
    assert.equal(validateRegistration({ ...base, phone: '12345' }).field, 'phone');
  });

  test('seller needs business name and phone; type is validated', () => {
    assert.equal(validateRegistration({ ...base, role: 'seller' }).field, 'businessName');
    assert.equal(validateRegistration({ ...base, role: 'seller', businessName: 'Ghar', phone: '' }).field, 'phone');
    assert.equal(validateRegistration({ ...base, role: 'seller', businessName: 'Ghar', type: 'spaceship' }).field, 'type');
    const ok = validateRegistration({ ...base, role: 'seller', businessName: ' Ghar ', type: 'home-chef' });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.businessName, 'Ghar');
    assert.equal(ok.value.type, 'home_chef');
  });

  test('phone formats', () => {
    assert.equal(isValidPhone('+91 98765 43210'), true);
    assert.equal(isValidPhone('09876543210'), true);
    assert.equal(isValidPhone('5876543210'), false);
  });
});

describe('seller eligibility', () => {
  test('only approved (verified + active) sellers are eligible', () => {
    assert.equal(isSellerEligible({ isActive: true, kycStatus: 'verified' }), true);
    assert.equal(isSellerEligible({ isActive: false, kycStatus: 'verified' }), false);
    assert.equal(isSellerEligible({ isActive: true, kycStatus: 'pending' }), false);
    assert.equal(isSellerEligible({ isActive: true, kycStatus: 'submitted' }), false);
    assert.equal(isSellerEligible({ isActive: false, kycStatus: 'rejected' }), false);
    assert.equal(isSellerEligible(null), false);
  });
});

describe('geographic distance and the 12 km radius', () => {
  test('service radius is 12 km', () => {
    assert.equal(SERVICE_RADIUS_KM, 12);
  });

  test('haversine matches known distances', () => {
    assert.equal(haversineKm(SECTOR_17, SECTOR_17), 0);
    const tenKm = haversineKm(SECTOR_17, northOf(SECTOR_17, 10));
    assert.ok(Math.abs(tenKm - 10) < 1e-6, String(tenKm));
    // Chandigarh -> Delhi is ~240 km straight line
    const delhi = haversineKm(SECTOR_17, [77.2090, 28.6139]);
    assert.ok(delhi > 230 && delhi < 250, String(delhi));
  });

  test('boundary is inclusive: 12 km in, anything above out', () => {
    assert.equal(isWithinServiceRadius(11.9), true);
    assert.equal(isWithinServiceRadius(12), true);
    assert.equal(isWithinServiceRadius(11.999), true);
    assert.equal(isWithinServiceRadius(12.001), false);
    assert.equal(isWithinServiceRadius(12.1), false);
    assert.equal(isWithinServiceRadius(NaN), false);
    assert.equal(isWithinServiceRadius(-1), false);
    assert.equal(isWithinServiceRadius(haversineKm(SECTOR_17, northOf(SECTOR_17, 11.95))), true);
    assert.equal(isWithinServiceRadius(haversineKm(SECTOR_17, northOf(SECTOR_17, 12.05))), false);
  });

  test('clients cannot widen the radius', () => {
    assert.equal(clampRadiusKm(50000), 12);
    assert.equal(clampRadiusKm(12000), 12);
    assert.equal(clampRadiusKm(8000), 8);
    assert.equal(clampRadiusKm(undefined), 12);
    assert.equal(clampRadiusKm('abc'), 12);
  });

  test('invalid coordinates are rejected', () => {
    assert.equal(isValidCoords([0, 0]), false);
    assert.equal(isValidCoords([200, 10]), false);
    assert.equal(isValidCoords([76.7, 95]), false);
    assert.equal(isValidCoords(['x', 1]), false);
    assert.equal(isValidCoords([76.7794, 30.7333]), true);
  });

  test('delivery pricing is serviceable up to the radius and not beyond', () => {
    assert.equal(getCustomerDeliveryFee(3), 30);
    assert.equal(getCustomerDeliveryFee(5), 45);
    assert.equal(getCustomerDeliveryFee(11.9), 60);
    assert.equal(getCustomerDeliveryFee(12), 60);
    assert.equal(getCustomerDeliveryFee(12.1), null);
    assert.equal(getCustomerDeliveryFee(18), null);
    const far = computeDeliveryPricing(SECTOR_17, northOf(SECTOR_17, 25));
    assert.equal(far.serviceable, false);
  });
});

describe('menu item validation and ownership fields', () => {
  test('create requires name, category and a positive price', () => {
    assert.equal(validateProductInput({ category: 'Thali', sellingPrice: 100 }).field, 'name');
    assert.equal(validateProductInput({ name: 'Thali', sellingPrice: 100 }).field, 'category');
    assert.equal(validateProductInput({ name: 'Thali', category: 'Thali' }).field, 'sellingPrice');
    assert.equal(validateProductInput({ name: 'Thali', category: 'Thali', sellingPrice: -5 }).field, 'sellingPrice');
    assert.equal(validateProductInput({ name: 'Thali', category: 'Thali', sellingPrice: 'abc' }).field, 'sellingPrice');
    assert.equal(validateProductInput({ name: 'Thali', category: 'Thali', sellingPrice: '0' }).field, 'sellingPrice');
    const ok = validateProductInput({ name: ' Thali ', category: 'Thali', sellingPrice: '149' });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.sellingPrice, 149);
    assert.equal(ok.value.name, 'Thali');
  });

  test('partial updates only validate the fields sent', () => {
    assert.equal(validateProductInput({ isAvailable: false }, { partial: true }).ok, true);
    assert.equal(validateProductInput({ sellingPrice: 0 }, { partial: true }).ok, false);
    assert.equal(validateProductInput({ stock: 2.5 }, { partial: true }).ok, false);
    assert.equal(validateProductInput({ stock: -1 }, { partial: true }).ok, true);
  });

  test('protected fields are stripped (no seller reassignment or self-approval)', () => {
    const clean = sanitizeProductInput({ name: 'x', sellerId: 'other', isAdminApproved: true, rating: 5, totalOrders: 999, isDeleted: true });
    assert.deepEqual(Object.keys(clean), ['name']);
  });
});

describe('server-side prices', () => {
  test('discount only applies when it is lower than the selling price', () => {
    assert.equal(getUnitPrice({ sellingPrice: 100 }), 100);
    assert.equal(getUnitPrice({ sellingPrice: 100, discountPrice: 80 }), 80);
    assert.equal(getUnitPrice({ sellingPrice: 60, discountPrice: 70 }), 60);
    assert.equal(getUnitPrice({ sellingPrice: 100, discountPrice: 0 }), 100);
  });

  test('half/full plate prices', () => {
    const p = { sellingPrice: 120, halfPlatePrice: 120, fullPlatePrice: 200 };
    assert.equal(getUnitPrice(p, 'half'), 120);
    assert.equal(getUnitPrice(p, 'full'), 200);
    assert.equal(getUnitPrice({ sellingPrice: 150 }, 'half'), null);
    assert.equal(getUnitPrice({ sellingPrice: 150 }, 'full'), 150);
  });

  test('availability problems', () => {
    assert.equal(getAvailabilityProblem({ isAvailable: true, status: 'published', stock: -1 }), null);
    assert.ok(getAvailabilityProblem({ isAvailable: false }));
    assert.ok(getAvailabilityProblem({ isAvailable: true, stock: 0 }));
    assert.ok(getAvailabilityProblem({ isAvailable: true, status: 'draft' }));
    assert.ok(getAvailabilityProblem({ isAvailable: true, isDeleted: true }));
    assert.ok(getAvailabilityProblem(null));
  });
});

describe('order totals', () => {
  test('without GST the customer pays items + delivery; platform fee is not added', () => {
    const t = computeOrderGSTAndCommission({ subtotal: 298, deliveryFee: 30, platformFeeRupee: 5, settings: { gstApplicable: false } });
    assert.equal(t.customerPayable, 328);
    assert.equal(t.gstAmount, 0);
  });

  test('with 5% food GST (intra-state) GST is added to the total', () => {
    const settings = { gstApplicable: true, foodGSTEnabled: true, foodCGSTRate: 2.5, foodSGSTRate: 2.5, deliveryGSTEnabled: false };
    const t = computeOrderGSTAndCommission({ subtotal: 200, deliveryFee: 30, sellerState: 'Chandigarh', customerState: 'chandigarh', settings });
    assert.equal(t.gstMode, 'intra');
    assert.equal(t.foodCgst, 5);
    assert.equal(t.foodSgst, 5);
    assert.equal(t.customerPayable, 240);
  });
});

describe('payment status', () => {
  test('payment methods are whitelisted; hybrid maps to online', () => {
    assert.equal(normalizePaymentMethod('COD'), 'cod');
    assert.equal(normalizePaymentMethod('hybrid'), 'online');
    assert.equal(normalizePaymentMethod('bitcoin'), null);
    assert.equal(normalizePaymentMethod(undefined), null);
  });

  test('only server-moved money counts as paid', () => {
    assert.equal(initialPaymentStatus({ paymentMethod: 'cod', payableAfterSubscription: 200 }), 'pending');
    assert.equal(initialPaymentStatus({ paymentMethod: 'online', payableAfterSubscription: 200 }), 'pending');
    assert.equal(initialPaymentStatus({ paymentMethod: 'razorpay', payableAfterSubscription: 200 }), 'pending');
    assert.equal(initialPaymentStatus({ paymentMethod: 'wallet', payableAfterSubscription: 200 }), 'paid');
    assert.equal(initialPaymentStatus({ paymentMethod: 'online', payableAfterSubscription: 0 }), 'paid');
  });

  test('Razorpay signature check', () => {
    const secret = 'unit-test-secret';
    const sig = crypto.createHmac('sha256', secret).update('order_1|pay_1').digest('hex');
    assert.equal(isValidRazorpaySignature('order_1', 'pay_1', sig, secret), true);
    assert.equal(isValidRazorpaySignature('order_1', 'pay_2', sig, secret), false);
    assert.equal(isValidRazorpaySignature('order_1', 'pay_1', 'short', secret), false);
    assert.equal(isValidRazorpaySignature('order_1', 'pay_1', undefined, secret), false);
  });
});

describe('order receipt', () => {
  const order = {
    _id: '64b000000000000000000001',
    orderNumber: 'DN-20261016-0001',
    createdAt: new Date('2026-10-16T08:00:00Z'),
    status: 'pending',
    userId: { name: 'Asha', phone: '9876543210', email: 'a@x.dev' },
    sellerId: { _id: '64b0000000000000000000aa', businessName: 'Ghar', type: 'home_chef', gstNumber: 'N/A', address: { fullAddress: 'Sector 17' } },
    items: [
      { menuItemId: '64b0000000000000000000b1', name: 'Thali', sellingPrice: 149, quantity: 2 },
      { menuItemId: '64b0000000000000000000b2', name: 'Paratha', sellingPrice: 99, quantity: 1 },
    ],
    subtotal: 397,
    deliveryFee: 30,
    platformFee: 5,
    gstAmount: 19.85,
    foodCgst: 9.925,
    foodSgst: 9.925,
    total: 446.85,
    paymentMethod: 'cod',
    paymentStatus: 'pending',
  };

  test('line totals, summary and grand total come from the stored order', () => {
    const r = buildOrderReceipt(order, { invoiceNumber: 'DN-INV-1' });
    assert.equal(r.documentType, 'order_receipt');
    assert.equal(r.invoiceNumber, 'DN-INV-1');
    assert.deepEqual(r.items.map(i => i.lineTotal), [298, 99]);
    assert.equal(r.summary.itemTotal, 397);
    assert.equal(r.summary.taxTotal, 19.85);
    assert.equal(r.summary.grandTotal, 446.85);
    assert.equal(r.payment.methodLabel, 'Cash on delivery');
    assert.equal(r.seller.gstNumber, null); // 'N/A' is not a GSTIN
    assert.equal(r.integrity.itemsMatchSubtotal, true);
    assert.equal(r.integrity.componentsMatchTotal, true);
  });

  test('platform fee is not part of the charged total', () => {
    const r = buildOrderReceipt(order);
    assert.equal(r.summary.grandTotal, order.total);
    assert.ok(!('platformFee' in r.summary));
  });

  test('an internally inconsistent order is flagged, not hidden', () => {
    const r = buildOrderReceipt({ ...order, total: 999 });
    assert.equal(r.integrity.componentsMatchTotal, false);
  });
});
