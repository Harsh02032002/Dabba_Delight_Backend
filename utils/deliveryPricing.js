/**
 * ============================================================
 *  DABBA NATION — Delivery Pricing Logic
 *  Lock Date: 2026-09-18  |  Dynamic slabs supported from Admin Panel
 * ============================================================
 *
 *  DEFAULT SLABS (can be overridden via Admin → Platform Settings):
 *
 *  CUSTOMER CHARGE (what customer pays):
 *    0  – 4  km  →  ₹30
 *    4.1 – 6  km  →  ₹45
 *    6.1 – 12 km  →  ₹60
 *    > 12 km      →  NOT SERVICEABLE  (returns null)
 *
 *  RIDER PAYOUT (what rider earns per delivery):
 *    0  – 4  km  →  ₹30
 *    4  – 6  km  →  ₹40
 *    6  – 12 km  →  ₹50
 * ============================================================
 */

/** Default hardcoded slabs (used when DB slabs are unavailable) */
const DEFAULT_SLABS = [
  { upToKm: 4,  customerFee: 30, riderPayout: 30 },
  { upToKm: 6,  customerFee: 45, riderPayout: 40 },
  { upToKm: 12, customerFee: 60, riderPayout: 50 },
];

const DEFAULT_MAX_KM = 12;
const DEFAULT_MAX_CAP = 90;

/**
 * Validate and normalise a slabs array from the DB.
 * Returns DEFAULT_SLABS if the input is missing or invalid.
 *
 * @param {Array} slabs - Array of { upToKm, customerFee, riderPayout }
 * @returns {Array} Sorted, valid slab array
 */
function normaliseSlabs(slabs) {
  if (!Array.isArray(slabs) || slabs.length === 0) return DEFAULT_SLABS;
  const valid = slabs.filter(
    (s) =>
      typeof s.upToKm === 'number' && s.upToKm > 0 &&
      typeof s.customerFee === 'number' && s.customerFee >= 0 &&
      typeof s.riderPayout === 'number' && s.riderPayout >= 0
  );
  if (valid.length === 0) return DEFAULT_SLABS;
  return valid.slice().sort((a, b) => a.upToKm - b.upToKm);
}

/**
 * Calculate the delivery fee charged to the customer based on km distance.
 * Returns null when the order is not serviceable (beyond maxKm).
 *
 * @param {number} distanceKm
 * @param {Array}  slabs        - Optional dynamic slabs from DB
 * @param {number} maxKm        - Optional max serviceable km from DB
 * @returns {number|null}
 */
function getCustomerDeliveryFee(distanceKm, slabs, maxKm, maxCap) {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km < 0) return null;

  const effectiveSlabs = normaliseSlabs(slabs);
  const effectiveMax = (typeof maxKm === 'number' && maxKm > 0) ? maxKm : DEFAULT_MAX_KM;
  const effectiveCap = (typeof maxCap === 'number' && maxCap > 0) ? maxCap : DEFAULT_MAX_CAP;

  if (km > effectiveMax) return null; // Not serviceable

  let fee = effectiveSlabs[effectiveSlabs.length - 1].customerFee;
  for (const slab of effectiveSlabs) {
    if (km <= slab.upToKm) {
      fee = slab.customerFee;
      break;
    }
  }

  // Max cap safety
  if (fee > effectiveCap) fee = effectiveCap;

  return fee;
}

/**
 * Calculate the payout credited to the rider after delivery.
 * Always returns a value (minimum from first slab).
 *
 * @param {number} distanceKm
 * @param {Array}  slabs  - Optional dynamic slabs from DB
 * @returns {number}
 */
function getRiderPayout(distanceKm, slabs) {
  const km = Number(distanceKm);
  const effectiveSlabs = normaliseSlabs(slabs);

  if (!Number.isFinite(km) || km < 0) return effectiveSlabs[0].riderPayout;

  for (const slab of effectiveSlabs) {
    if (km <= slab.upToKm) return slab.riderPayout;
  }
  // Beyond all slabs → use last slab's payout (still pay the rider)
  return effectiveSlabs[effectiveSlabs.length - 1].riderPayout;
}

/**
 * Haversine formula — calculate straight-line distance in km.
 *
 * @param {[number, number]} coord1 - [longitude, latitude]
 * @param {[number, number]} coord2 - [longitude, latitude]
 * @returns {number}
 */
function haversineDistanceKm(coord1, coord2) {
  if (!coord1 || !coord2 || coord1.length < 2 || coord2.length < 2) return 0;

  const R = 6371;
  const dLat = (coord2[1] - coord1[1]) * (Math.PI / 180);
  const dLon = (coord2[0] - coord1[0]) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1[1] * (Math.PI / 180)) *
      Math.cos(coord2[1] * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

/**
 * One-shot helper: compute full delivery pricing from coords + optional DB slabs.
 *
 * @param {[number, number]} sellerCoords   - [lng, lat]
 * @param {[number, number]} customerCoords - [lng, lat]
 * @param {Array}  slabs    - Dynamic slabs from DB (optional)
 * @param {number} maxKm    - Max serviceable km from DB (optional)
 * @returns {{ distanceKm, customerFee, riderPayout, serviceable }}
 */
function computeDeliveryPricing(sellerCoords, customerCoords, slabs, maxKm, maxCap) {
  const distanceKm = haversineDistanceKm(sellerCoords, customerCoords);
  const customerFee = getCustomerDeliveryFee(distanceKm, slabs, maxKm, maxCap);
  const serviceable = customerFee !== null;
  const riderPayout = getRiderPayout(distanceKm, slabs);

  return { distanceKm, customerFee: serviceable ? customerFee : null, riderPayout, serviceable };
}

/**
 * Fetch current delivery slabs from the PlatformConfig document in DB.
 * Returns { slabs, maxKm, maxCap } — uses defaults if not set in DB.
 *
 * @returns {Promise<{ slabs: Array, maxKm: number, maxCap: number }>}
 */
async function getDeliverySlabsFromDB() {
  try {
    const { PlatformConfig } = require('../models/Others');
    let config = await PlatformConfig.findOne().select('deliverySlabs maxServiceableKm maxDeliveryCap').lean();
    if (!config) config = {};
    return {
      slabs: normaliseSlabs(config.deliverySlabs),
      maxKm:
        typeof config.maxServiceableKm === 'number' && config.maxServiceableKm > 0
          ? config.maxServiceableKm
          : DEFAULT_MAX_KM,
      maxCap:
        typeof config.maxDeliveryCap === 'number' && config.maxDeliveryCap > 0
          ? config.maxDeliveryCap
          : DEFAULT_MAX_CAP,
    };
  } catch (err) {
    console.error('⚠️ [deliveryPricing] Could not fetch slabs from DB, using defaults:', err.message);
    return { slabs: DEFAULT_SLABS, maxKm: DEFAULT_MAX_KM, maxCap: DEFAULT_MAX_CAP };
  }
}

module.exports = {
  DEFAULT_SLABS,
  DEFAULT_MAX_KM,
  DEFAULT_MAX_CAP,
  normaliseSlabs,
  getCustomerDeliveryFee,
  getRiderPayout,
  haversineDistanceKm,
  computeDeliveryPricing,
  getDeliverySlabsFromDB,
};
