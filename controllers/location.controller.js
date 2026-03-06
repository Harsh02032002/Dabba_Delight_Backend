const { Address } = require('../models/Others');
const Seller = require('../models/Seller');

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
exports.getNearbySellers = async (req, res) => {
  try {
    const { lat, lng, radius = 10000, type } = req.query;
    const filter = { isActive: true };
    if (type) filter.type = type;
    if (lat && lng) {
      filter['address.location'] = {
        $near: { $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }, $maxDistance: Number(radius) },
      };
    }
    const sellers = await Seller.find(filter).limit(50);
    res.json({ success: true, sellers });
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
