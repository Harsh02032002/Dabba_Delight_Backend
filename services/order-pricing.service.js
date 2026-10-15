/**
 * Server-side checkout validation and pricing.
 *
 * Nothing the client says about prices, totals, distance or availability is trusted:
 * the seller, every item and the delivery point are re-read from the database and the
 * quote is computed here. Used by POST /api/user/orders/place.
 */
const mongoose = require('mongoose');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const {
  SERVICE_RADIUS_KM, haversineKm, isValidCoords, getEffectiveSellerCoords, isSellerEligible, isWithinServiceRadius,
} = require('../utils/sellerGeo');
const { getUnitPrice, getAvailabilityProblem } = require('../utils/productRules');
const { computeDeliveryPricing, getDeliverySlabsFromDB } = require('../utils/deliveryPricing');
const { computeOrderGSTAndCommission, getGSTSettingsDoc } = require('./gst-order.service');

const MAX_QTY_PER_ITEM = 50;
const MAX_LINES = 50;
/** Client subtotal may differ by rounding only */
const PRICE_TOLERANCE = 1;

const fail = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });

/** [lng, lat] from deliveryAddress.location.coordinates, or null */
const readCustomerPoint = (deliveryAddress) => {
  const raw = deliveryAddress?.location?.coordinates;
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const point = [Number(raw[0]), Number(raw[1])];
  return isValidCoords(point) ? point : null;
};

/**
 * @param {object} input
 * @param {string} input.sellerId
 * @param {Array}  input.items           [{ menuItemId, quantity, selectedSize? }]
 * @param {object} input.deliveryAddress must contain location.coordinates [lng, lat]
 * @param {number} [input.clientSubtotal] what the client displayed (compared, never used)
 * @param {boolean} [input.requireStreet=true] false for price quotes before the address is typed
 */
async function buildOrderQuote({ sellerId, items, deliveryAddress, clientSubtotal, requireStreet = true }) {
  if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
    return fail(400, 'INVALID_SELLER', 'Invalid or missing restaurant. Please re-add items to your cart and try again.');
  }
  const seller = await Seller.findById(sellerId);
  if (!seller) return fail(404, 'SELLER_NOT_FOUND', 'Seller not found');
  if (!isSellerEligible(seller)) {
    return fail(409, 'SELLER_UNAVAILABLE', `${seller.businessName} is not accepting orders right now.`);
  }

  // ── Delivery location + service radius ───────────────────────────────────
  const customerPoint = readCustomerPoint(deliveryAddress);
  if (!customerPoint) {
    return fail(400, 'LOCATION_REQUIRED', 'Please set your delivery location on the map so we can check the kitchen delivers to you.');
  }
  const { coords: sellerPoint } = getEffectiveSellerCoords(seller.toObject());
  if (!sellerPoint) {
    return fail(409, 'SELLER_LOCATION_UNKNOWN', `${seller.businessName} has no delivery location set yet, so it can't take orders.`);
  }
  const distanceKm = haversineKm(sellerPoint, customerPoint);
  if (!isWithinServiceRadius(distanceKm)) {
    return fail(400, 'OUT_OF_RANGE', `${seller.businessName} is ${distanceKm.toFixed(1)} km away. We deliver only within ${SERVICE_RADIUS_KM} km of your location.`, {
      distanceKm: Number(distanceKm.toFixed(1)), maxKm: SERVICE_RADIUS_KM,
    });
  }

  // Pricing only needs the delivery point; placing the order also needs a street address
  const street = String(deliveryAddress?.street || deliveryAddress?.address || '').trim();
  if (requireStreet && !street) return fail(400, 'ADDRESS_REQUIRED', 'Please enter your street address');

  // ── Items ────────────────────────────────────────────────────────────────
  if (!Array.isArray(items) || items.length === 0) return fail(400, 'EMPTY_CART', 'Your cart is empty');
  if (items.length > MAX_LINES) return fail(400, 'TOO_MANY_ITEMS', `An order can have at most ${MAX_LINES} different items`);

  const wanted = [];
  for (const raw of items) {
    const id = String(raw?.menuItemId || raw?.id || raw?._id || '');
    const quantity = Number(raw?.quantity);
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'INVALID_ITEM', 'One of the items in your cart is invalid. Please re-add it.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_ITEM) {
      return fail(400, 'INVALID_QUANTITY', `Quantity must be between 1 and ${MAX_QTY_PER_ITEM}`);
    }
    const selectedSize = raw?.selectedSize === 'half' || raw?.selectedSize === 'full' ? raw.selectedSize : null;
    wanted.push({ id, quantity, selectedSize });
  }

  // includeDeleted so removed items produce a clear message instead of "not found"
  const products = await Product.find({ _id: { $in: wanted.map(w => w.id) }, includeDeleted: true }).lean();
  const byId = new Map(products.map(p => [String(p._id), p]));

  const lineItems = [];
  for (const w of wanted) {
    const product = byId.get(w.id);
    if (product && String(product.sellerId) !== String(seller._id)) {
      return fail(400, 'MIXED_SELLERS', 'All items in one order must come from the same kitchen.');
    }
    const problem = getAvailabilityProblem(product);
    if (problem) {
      return fail(409, 'ITEM_UNAVAILABLE', `${product?.name || 'An item'}: ${problem}. Please update your cart.`, { menuItemId: w.id });
    }
    if (product.stock > 0 && w.quantity > product.stock) {
      return fail(409, 'INSUFFICIENT_STOCK', `Only ${product.stock} × ${product.name} left. Please reduce the quantity.`, { menuItemId: w.id });
    }
    const unitPrice = getUnitPrice(product, w.selectedSize);
    if (unitPrice === null) return fail(409, 'ITEM_UNAVAILABLE', `${product.name} isn't offered in that size.`, { menuItemId: w.id });

    const sizeLabel = w.selectedSize && (w.selectedSize === 'half' || Number(product.fullPlatePrice) > 0)
      ? ` (${w.selectedSize === 'half' ? 'Half' : 'Full'} Plate)` : '';
    lineItems.push({
      menuItemId: product._id,
      name: `${product.name}${sizeLabel}`,
      sellingPrice: unitPrice,
      quantity: w.quantity,
      image: product.image,
      lineTotal: round2(unitPrice * w.quantity),
    });
  }

  const subtotal = round2(lineItems.reduce((sum, l) => sum + l.lineTotal, 0));

  if (clientSubtotal !== undefined && clientSubtotal !== null && clientSubtotal !== '') {
    const shown = Number(clientSubtotal);
    if (!Number.isFinite(shown) || Math.abs(shown - subtotal) > PRICE_TOLERANCE) {
      return fail(409, 'PRICE_CHANGED', 'Prices in your cart have changed. Please review your cart and try again.', {
        serverSubtotal: subtotal,
        items: lineItems.map(l => ({ menuItemId: l.menuItemId, name: l.name, unitPrice: l.sellingPrice, quantity: l.quantity })),
      });
    }
  }

  return {
    ok: true,
    seller,
    lineItems,
    subtotal,
    customerPoint,
    sellerPoint,
    distanceKm: Number(distanceKm.toFixed(2)),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Full authoritative pricing of a cart: validation (buildOrderQuote) + distance-based delivery
 * fee + GST. Used both to place orders and to show checkout totals (POST /orders/quote), so the
 * amount a customer sees is exactly the amount the order is created with.
 */
async function priceOrder(input) {
  const quote = await buildOrderQuote(input);
  if (!quote.ok) return quote;

  const { slabs, maxKm, maxCap } = await getDeliverySlabsFromDB();
  const delivery = computeDeliveryPricing(quote.sellerPoint, quote.customerPoint, slabs, maxKm, maxCap);
  if (!delivery.serviceable) {
    return fail(400, 'OUT_OF_RANGE', `Order not serviceable — your location is ${delivery.distanceKm} km away. We deliver only up to ${maxKm} km.`, {
      distanceKm: delivery.distanceKm, maxKm,
    });
  }

  const { PlatformConfig } = require('../models/Others');
  const [settings, platformDoc] = await Promise.all([getGSTSettingsDoc(), PlatformConfig.findOne().lean()]);
  // Recorded on the order for settlement; not charged to the customer (see gst-order.service)
  const platformFee = platformDoc && platformDoc.platformFee != null ? Number(platformDoc.platformFee) || 0 : 0;

  const tax = computeOrderGSTAndCommission({
    subtotal: quote.subtotal,
    deliveryFee: delivery.customerFee,
    platformFeeRupee: platformFee,
    sellerState: quote.seller.address?.state,
    customerState: input.deliveryAddress?.state,
    settings,
  });

  return {
    ...quote,
    deliveryFee: delivery.customerFee,
    riderPayout: delivery.riderPayout,
    platformFee,
    tax,
    grandTotal: tax.customerPayable,
  };
}

/** Public shape of a price quote (no internal documents) */
const toQuoteResponse = (priced) => ({
  sellerId: String(priced.seller._id),
  distanceKm: priced.distanceKm,
  items: priced.lineItems.map(l => ({ menuItemId: String(l.menuItemId), name: l.name, unitPrice: l.sellingPrice, quantity: l.quantity, lineTotal: l.lineTotal })),
  subtotal: priced.subtotal,
  deliveryFee: priced.deliveryFee,
  foodGst: round2(priced.tax.foodGSTTotal),
  deliveryGst: round2(priced.tax.deliveryGSTTotal),
  taxTotal: round2(priced.tax.gstAmount),
  grandTotal: round2(priced.grandTotal),
});

/**
 * Payment status the server may set when an order is created.
 * Only money the server itself moved counts as paid (wallet debit, subscription credit).
 * Online / UPI payments stay 'pending' until verified (Razorpay signature + amount, or an admin).
 */
const ONLINE_METHODS = ['online', 'online_qr', 'upi', 'razorpay', 'stripe'];
const ACCEPTED_METHODS = ['cod', 'wallet', 'subscription', ...ONLINE_METHODS];

const normalizePaymentMethod = (method) => {
  const m = String(method || '').toLowerCase();
  if (m === 'hybrid') return 'online'; // web: subscription credit + online remainder
  return ACCEPTED_METHODS.includes(m) ? m : null;
};

const initialPaymentStatus = ({ paymentMethod, payableAfterSubscription }) => {
  if (Number(payableAfterSubscription) <= 0) return 'paid'; // fully covered by subscription credit
  if (paymentMethod === 'wallet') return 'paid'; // debited inside the order transaction
  return 'pending'; // cod, online, upi, ...
};

module.exports = {
  SERVICE_RADIUS_KM,
  MAX_QTY_PER_ITEM,
  PRICE_TOLERANCE,
  ONLINE_METHODS,
  readCustomerPoint,
  buildOrderQuote,
  priceOrder,
  toQuoteResponse,
  normalizePaymentMethod,
  initialPaymentStatus,
};
