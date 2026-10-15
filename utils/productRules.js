/**
 * Menu item rules shared by product management and checkout.
 */

// Fields a seller/admin may never set through create/update payloads
const PROTECTED_PRODUCT_FIELDS = [
  '_id', 'sellerId', 'createdAt', 'updatedAt', '__v',
  'isAdminApproved', 'adminApprovalDate', 'adminApprovalBy',
  'rating', 'totalRatings', 'totalOrders', 'reviews',
  'isDeleted', 'deletedAt', 'deletedBy',
];

const PRICE_FIELDS = ['sellingPrice', 'discountPrice', 'halfPlatePrice', 'fullPlatePrice', 'mrp', 'costPrice'];

/** Copy of a create/update payload without protected fields */
const sanitizeProductInput = (data = {}) => {
  const out = { ...data };
  for (const k of PROTECTED_PRODUCT_FIELDS) delete out[k];
  return out;
};

const toNumberOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Validate a product payload.
 * @param {object} data  sanitized payload (multipart values arrive as strings)
 * @param {{ partial?: boolean }} opts  partial=true for updates (only validate fields present)
 * @returns {{ ok: true, value: object } | { ok: false, message: string, field: string }}
 */
const validateProductInput = (data = {}, { partial = false } = {}) => {
  const value = { ...data };

  if (!partial || 'name' in data) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) return { ok: false, field: 'name', message: 'Item name is required' };
    if (name.length > 120) return { ok: false, field: 'name', message: 'Item name is too long' };
    value.name = name;
  }
  if (!partial || 'category' in data) {
    const category = typeof data.category === 'string' ? data.category.trim() : '';
    if (!category) return { ok: false, field: 'category', message: 'Category is required' };
    value.category = category;
  }

  for (const field of PRICE_FIELDS) {
    if (!(field in data)) continue;
    const n = toNumberOrNull(data[field]);
    if (Number.isNaN(n) || (n !== null && n < 0)) {
      return { ok: false, field, message: `${field} must be a positive number` };
    }
    // Empty / zero optional prices mean "not offered" (e.g. no half plate)
    // (on update, null clears a previously offered size)
    if (field !== 'sellingPrice' && (n === null || n === 0)) { value[field] = partial ? null : undefined; continue; }
    value[field] = n;
  }

  // The seller panel always sends sellingPrice (half-plate price for sized items)
  if (!partial || 'sellingPrice' in data) {
    const sp = Number(value.sellingPrice);
    if (!Number.isFinite(sp) || sp <= 0) {
      return { ok: false, field: 'sellingPrice', message: 'Selling price must be greater than 0' };
    }
    if (sp > 100000) return { ok: false, field: 'sellingPrice', message: 'Selling price is too high' };
  }

  if ('stock' in data) {
    const st = toNumberOrNull(data.stock);
    if (Number.isNaN(st) || (st !== null && (st < -1 || !Number.isInteger(st)))) {
      return { ok: false, field: 'stock', message: 'Stock must be a whole number (-1 = unlimited)' };
    }
    value.stock = st === null ? -1 : st;
  }

  for (const k of Object.keys(value)) if (value[k] === undefined) delete value[k];
  return { ok: true, value };
};

/**
 * Authoritative unit price for an item (what checkout charges).
 * - half/full plate price when that size was chosen and is offered
 * - otherwise discountPrice when it is a real discount (0 < discountPrice < sellingPrice)
 * - otherwise sellingPrice
 * Returns null when the requested size isn't offered.
 */
const getUnitPrice = (product, selectedSize) => {
  const selling = Number(product?.sellingPrice) || 0;
  if (selectedSize === 'half' || selectedSize === 'full') {
    const sized = Number(selectedSize === 'half' ? product?.halfPlatePrice : product?.fullPlatePrice) || 0;
    if (sized > 0) return sized;
    if (selectedSize === 'half') return null;
    // "full" without a full-plate price is the regular portion
  }
  const discount = Number(product?.discountPrice) || 0;
  const price = discount > 0 && discount < selling ? discount : selling;
  return price > 0 ? price : null;
};

/** Is this product currently orderable by customers? */
const getAvailabilityProblem = (product) => {
  if (!product) return 'This item no longer exists';
  if (product.isDeleted) return 'This item was removed from the menu';
  if (product.isAvailable === false) return 'This item is currently unavailable';
  if (product.status === 'draft' || product.status === 'archived') return 'This item is not on the menu';
  if (product.stock === 0) return 'This item is out of stock';
  return null;
};

module.exports = {
  PROTECTED_PRODUCT_FIELDS,
  sanitizeProductInput,
  validateProductInput,
  getUnitPrice,
  getAvailabilityProblem,
};
