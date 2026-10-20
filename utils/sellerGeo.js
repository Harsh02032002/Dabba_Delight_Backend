/**
 * Seller geo helpers – location-wise seller/menu filtering.
 *
 * Problem this solves: some sellers have a GPS pin that doesn't match the city they
 * actually operate in (e.g. a Deoria seller registered from a laptop in Chandigarh,
 * so the browser GPS saved Chandigarh coordinates). Pure `$near` then shows that
 * Deoria seller to Chandigarh users. We sanity-check every seller's pin against
 * the declared city and fall back to the city centre when the pin is clearly wrong.
 */

// Known city centres [longitude, latitude]
const KNOWN_CITY_COORDS = {
  chandigarh: [76.7794, 30.7333],
  mohali: [76.7179, 30.7046],
  'sahibzada ajit singh nagar': [76.7179, 30.7046],
  panchkula: [76.8606, 30.6942],
  zirakpur: [76.8173, 30.6425],
  kharar: [76.6469, 30.7462],
  ludhiana: [75.8573, 30.9010],
  amritsar: [74.8723, 31.6340],
  jalandhar: [75.5762, 31.3260],
  patiala: [76.3869, 30.3398],
  ambala: [76.7821, 30.3782],
  shimla: [77.1734, 31.1048],
  deoria: [83.7797, 26.5024],
  gorakhpur: [83.3732, 26.7606],
  kushinagar: [83.8890, 26.7399],
  varanasi: [82.9739, 25.3176],
  lucknow: [80.9462, 26.8467],
  kanpur: [80.3319, 26.4499],
  prayagraj: [81.8463, 25.4358],
  allahabad: [81.8463, 25.4358],
  patna: [85.1376, 25.5941],
  delhi: [77.2090, 28.6139],
  'new delhi': [77.2090, 28.6139],
  noida: [77.3910, 28.5355],
  'greater noida': [77.5040, 28.4744],
  ghaziabad: [77.4538, 28.6692],
  gurgaon: [77.0266, 28.4595],
  gurugram: [77.0266, 28.4595],
  faridabad: [77.3178, 28.4089],
  jaipur: [75.7873, 26.9124],
  dehradun: [78.0322, 30.3165],
  mumbai: [72.8777, 19.0760],
  pune: [73.8567, 18.5204],
  bengaluru: [77.5946, 12.9716],
  bangalore: [77.5946, 12.9716],
  hyderabad: [78.4867, 17.3850],
  chennai: [80.2707, 13.0827],
  kolkata: [88.3639, 22.5726],
  ahmedabad: [72.5714, 23.0225],
  bhopal: [77.4126, 23.2599],
  indore: [75.8577, 22.7196],
};

// A pin further than this from the seller's own declared city is treated as wrong
const PIN_MISMATCH_KM = 80;

// ─── SERVICE RADIUS (single source of truth) ───────────────────────────
// Straight-line (Haversine) distance between the customer's delivery point and the seller.
// Customers only see sellers/menus within this distance, checkout rejects orders beyond it,
// and riders only receive orders whose customer is within this distance of them.
// The boundary is INCLUSIVE: a seller exactly SERVICE_RADIUS_KM away is eligible.
// Override with SERVICE_RADIUS_KM in .env if ever needed.
const DEFAULT_SERVICE_RADIUS_KM = 12;
const SERVICE_RADIUS_KM = Number(process.env.SERVICE_RADIUS_KM) > 0 ? Number(process.env.SERVICE_RADIUS_KM) : DEFAULT_SERVICE_RADIUS_KM;

// ─── SELLER ELIGIBILITY (single source of truth) ───────────────────────
// A seller is visible to customers and can receive orders only after an admin approved it
// (POST /api/admin/sellers/:id/approve sets kycStatus 'verified' + isActive true).
// Rejecting or deactivating a seller removes it from discovery and checkout.
const ELIGIBLE_SELLER_FILTER = Object.freeze({ isActive: true, kycStatus: 'verified' });
const isSellerEligible = (seller) => !!seller && seller.isActive === true && seller.kycStatus === 'verified';

/** Inclusive boundary rule: exactly SERVICE_RADIUS_KM away is still served */
const isWithinServiceRadius = (distanceKm, radiusKm = SERVICE_RADIUS_KM) =>
  Number.isFinite(distanceKm) && distanceKm >= 0 && distanceKm <= (radiusKm + 0.0001);

/** Requested radius (metres, from client) -> km, never more than SERVICE_RADIUS_KM */
const clampRadiusKm = (radiusMeters) => {
  const req = Number(radiusMeters) / 1000;
  return Number.isFinite(req) && req > 0 ? Math.min(req, SERVICE_RADIUS_KM) : SERVICE_RADIUS_KM;
};

const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km between two [lng, lat] points */
const haversineKm = (a, b) => {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const isValidCoords = (c) =>
  Array.isArray(c) &&
  c.length === 2 &&
  Number.isFinite(Number(c[0])) &&
  Number.isFinite(Number(c[1])) &&
  !(Number(c[0]) === 0 && Number(c[1]) === 0) &&
  Math.abs(Number(c[1])) <= 90 &&
  Math.abs(Number(c[0])) <= 180;

/** Find a known city key inside a free-text string (longest match wins) */
const matchKnownCity = (text) => {
  if (!text) return null;
  const t = ` ${String(text).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')} `;
  let best = null;
  for (const key of Object.keys(KNOWN_CITY_COORDS)) {
    if (t.includes(` ${key} `) && (!best || key.length > best.length)) best = key;
  }
  return best;
};

/** Which known city does this seller declare? (city field first, then full address) */
const getSellerCityKey = (seller) =>
  matchKnownCity(seller?.address?.city) ||
  (!seller?.address?.city ? matchKnownCity(seller?.address?.fullAddress) : null);

/**
 * Effective [lng, lat] for a seller, or null if unknown.
 * - valid pin that agrees with declared city -> pin
 * - pin missing/[0,0] or > PIN_MISMATCH_KM away from declared city -> city centre
 */
const getEffectiveSellerCoords = (seller) => {
  const raw = seller?.address?.location?.coordinates;
  const pin = isValidCoords(raw) ? [Number(raw[0]), Number(raw[1])] : null;
  const cityKey = getSellerCityKey(seller);
  const cityCoords = cityKey ? KNOWN_CITY_COORDS[cityKey] : null;

  if (cityCoords) {
    if (!pin) return { coords: cityCoords, source: 'city', cityKey };
    if (haversineKm(pin, cityCoords) > PIN_MISMATCH_KM) {
      return { coords: cityCoords, source: 'city-corrected', cityKey };
    }
  }
  return pin ? { coords: pin, source: 'pin', cityKey } : { coords: null, source: 'none', cityKey };
};

/** Lower-cased location-name parts, e.g. "Buterla, Chandigarh" -> ['buterla', 'chandigarh'] */
const locationNameParts = (name) =>
  String(name || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3);

const buildTypeQuery = (type) => {
  if (!type || type === 'all') return null;
  return (type === 'home_chef' || type === 'home-chef') ? { $in: ['home_chef', 'home-chef'] } : type;
};

/**
 * Single source of truth for "which sellers are near this user".
 * Returns lean seller docs (without bank/KYC) sorted by distance, each with `distanceKm`.
 * - user coords given  -> effective seller location within radius (max SERVICE_RADIUS_KM)
 * - only areaName given -> city text match
 * - nothing given       -> [] (caller decides what to do)
 */
const findNearbySellers = async ({ lat, lng, radiusMeters, type, areaName, limit = 50 } = {}) => {
  const Seller = require('../models/Seller');
  const filter = { ...ELIGIBLE_SELLER_FILTER };
  const typeQuery = buildTypeQuery(type);
  if (typeQuery) filter.type = typeQuery;

  const radiusKm = clampRadiusKm(radiusMeters);
  const nameParts = locationNameParts(areaName);
  const userPoint = [Number(lng), Number(lat)];
  const hasUserCoords = isValidCoords(userPoint);

  if (!hasUserCoords && !nameParts.length) return [];

  const candidates = await Seller.find(filter)
    .select('-bankDetails -kycDocuments -totalRevenue -commissionRate -referralCode -referredBy')
    .limit(2000)
    .lean();

  const cityTextMatches = (s) => {
    if (!nameParts.length) return false;
    const text = `${s.address?.city || ''} ${s.address?.fullAddress || ''}`.toLowerCase();
    return nameParts.some((p) => text.includes(p));
  };

  let sellers = [];
  if (hasUserCoords) {
    for (const s of candidates) {
      const { coords } = getEffectiveSellerCoords(s);
      if (coords) {
        const d = haversineKm(userPoint, coords);
        if (isWithinServiceRadius(d, radiusKm)) sellers.push({ ...s, distanceKm: Math.round(d * 10) / 10 });
      }
      // Seller with no usable location can't be proven to be within the service
      // radius -> not shown (strict location-wise rule).
    }
    sellers.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  } else {
    sellers = candidates.filter(cityTextMatches).map((s) => ({ ...s, distanceKm: null }));
  }

  return sellers.slice(0, limit);
};

module.exports = {
  KNOWN_CITY_COORDS,
  PIN_MISMATCH_KM,
  DEFAULT_SERVICE_RADIUS_KM,
  SERVICE_RADIUS_KM,
  ELIGIBLE_SELLER_FILTER,
  isSellerEligible,
  isWithinServiceRadius,
  clampRadiusKm,
  haversineKm,
  isValidCoords,
  matchKnownCity,
  getSellerCityKey,
  getEffectiveSellerCoords,
  locationNameParts,
  findNearbySellers,
};
