const Product = require('../models/Product');
const Seller = require('../models/Seller');

// GET /api/search?q=biryani&type=home_chef&category=biryani&isVeg=true&lat=&lng=
exports.search = async (req, res) => {
  try {
    const { q, type, category, isVeg, lat, lng, radius = 10000, page = 1, limit = 20 } = req.query;
    const productFilter = { isAvailable: true };
    if (q) productFilter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
      { tags: { $regex: q, $options: 'i' } },
    ];
    if (category) productFilter.category = category;
    if (isVeg === 'true') productFilter.isVeg = true;

    let sellerFilter = { isActive: true };
    if (type) sellerFilter.type = type;
    if (lat && lng) {
      sellerFilter['address.location'] = {
        $near: { $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }, $maxDistance: Number(radius) },
      };
    }
    const sellers = await Seller.find(sellerFilter).select('_id');
    if (sellers.length > 0) productFilter.sellerId = { $in: sellers.map(s => s._id) };

    const products = await Product.find(productFilter)
      .populate('sellerId', 'businessName type logo rating')
      .limit(Number(limit)).skip((Number(page) - 1) * Number(limit)).sort({ rating: -1 });
    const total = await Product.countDocuments(productFilter);
    res.json({ success: true, products, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
