const Product = require('../models/Product');
const Seller = require('../models/Seller');
const { findNearbySellers, SERVICE_RADIUS_KM } = require('../utils/sellerGeo');

// GET /api/search?q=biryani&type=home_chef&category=biryani&isVeg=true&lat=&lng=
exports.search = async (req, res) => {
  try {
    const { q, type, category, isVeg, lat, lng, radius, page = 1, limit = 20, city } = req.query;
    const productFilter = { isAvailable: true, isDeleted: { $ne: true } };
    if (q) productFilter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { tags: { $regex: q, $options: 'i' } },
    ];
    if (category) productFilter.category = category;
    if (isVeg === 'true') productFilter.isVeg = true;

    if (lat && lng) {
      const nearbySellers = await findNearbySellers({
        lat,
        lng,
        radiusMeters: radius, // capped to 12 km
        type,
        areaName: city,
        limit: 500,
      });
      const sellerIds = nearbySellers.map(s => s._id);
      // Strictly restrict search to sellers within 12km
      productFilter.sellerId = { $in: sellerIds };
    } else if (city) {
      const nearbySellers = await findNearbySellers({
        areaName: city,
        type,
        limit: 500,
      });
      const sellerIds = nearbySellers.map(s => s._id);
      productFilter.sellerId = { $in: sellerIds };
    } else if (type && type !== 'all') {
      const matchingSellers = await Seller.find({ isActive: true, type }).select('_id').lean();
      productFilter.sellerId = { $in: matchingSellers.map(s => s._id) };
    } else {
      productFilter.sellerId = { $ne: null, $exists: true };
    }

    const products = await Product.find(productFilter)
      .populate('sellerId', 'businessName type logo rating')
      .limit(Number(limit)).skip((Number(page) - 1) * Number(limit)).sort({ rating: -1 });
    const total = await Product.countDocuments(productFilter);
    res.json({ success: true, products, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
