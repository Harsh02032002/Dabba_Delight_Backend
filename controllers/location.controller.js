const { Address } = require('../models/Others');
const { toPublicSeller } = require('../utils/publicSeller');
const Seller = require('../models/Seller');
const { findNearbySellers, clampRadiusKm } = require('../utils/sellerGeo');

// POST /api/user/address
exports.addAddress = async (req, res) => {
  try {
    const { label, fullAddress, street, landmark, city, state, pincode, lat, lng, phone, contactName, isDefault } = req.body;
    if (isDefault) await Address.updateMany({ userId: req.user._id }, { isDefault: false });
    const address = await Address.create({
      userId: req.user._id, label, fullAddress, street, landmark, city, state, pincode,
      location: lat && lng ? { type: 'Point', coordinates: [lng, lat] } : undefined,
      phone, contactName, isDefault: isDefault || false,
    });
    res.status(201).json({ success: true, address });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/user/addresses
exports.getAddresses = async (req, res) => {
  try {
    const addresses = await Address.find({ userId: req.user._id }).sort({ isDefault: -1, updatedAt: -1 });
    res.json({ success: true, addresses });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/user/address/:id
exports.updateAddress = async (req, res) => {
  try {
    const { isDefault, ...rest } = req.body;
    if (isDefault) await Address.updateMany({ userId: req.user._id }, { isDefault: false });
    const address = await Address.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { ...rest, isDefault: isDefault || false }, { new: true }
    );
    if (!address) return res.status(404).json({ message: 'Address not found' });
    res.json({ success: true, address });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/user/address/:id
exports.deleteAddress = async (req, res) => {
  try {
    await Address.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true, message: 'Address deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/user/address/:id/set-default
exports.setDefaultAddress = async (req, res) => {
  try {
    await Address.updateMany({ userId: req.user._id }, { isDefault: false });
    const address = await Address.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id }, { isDefault: true }, { new: true }
    );
    res.json({ success: true, address });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/user/sellers/nearby
// Location-wise sellers: only sellers whose *effective* location is within `radius`
// metres of the user. Effective location = seller GPS pin, corrected to the declared
// city centre when the pin clearly contradicts the city (see utils/sellerGeo.js).
exports.getNearbySellers = async (req, res) => {
  try {
    const { lat, lng, radius, type, city, locationName } = req.query;
    const radiusKm = clampRadiusKm(radius); // hard max: SERVICE_RADIUS_KM (12 km)
    const hasUserCoords = !!(lat && lng);

    // NOTE: intentionally no "show everything" fallback - if nothing is nearby the app
    // shows an empty state instead of sellers from another city.
    const sellers = await findNearbySellers({
      lat,
      lng,
      radiusMeters: radius,
      type,
      areaName: city || locationName,
      limit: 50,
    });
    const userPoint = [lng, lat];

    // Default images
    const DEFAULT_LOGO = 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop';
    const DEFAULT_COVER = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=400&fit=crop';

    const sellersWithImages = (sellers || []).map(seller => ({
      ...seller,
      logo: seller.logo || DEFAULT_LOGO,
      coverImage: seller.coverImage || DEFAULT_COVER,
      image: seller.coverImage || DEFAULT_COVER,
    }));

    console.log(`[getNearbySellers] user=${hasUserCoords ? userPoint.join(',') : 'n/a'} area="${city || locationName || ''}" radiusKm=${radiusKm} -> ${sellersWithImages.length} sellers`);
    res.json({ success: true, sellers: sellersWithImages.map(toPublicSeller), total: sellersWithImages.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/user/reverse-geocode
exports.reverseGeocode = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
    const response = await (await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)).json();
    res.json({
      success: true,
      address: {
        city: response.address?.city || response.address?.town || response.address?.village || '',
        state: response.address?.state || '',
        pincode: response.address?.postcode || '',
        fullAddress: response.display_name || '',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
