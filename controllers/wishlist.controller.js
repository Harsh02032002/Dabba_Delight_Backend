const { Wishlist } = require('../models/Others');

// POST /api/user/wishlist/add — Toggle
exports.addToWishlist = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ success: false, message: 'productId required' });
    const existing = await Wishlist.findOne({ userId: req.user._id, productId });
    if (existing) {
      await Wishlist.findByIdAndDelete(existing._id);
      return res.json({ success: true, message: 'Removed from wishlist', action: 'removed' });
    }
    await Wishlist.create({ userId: req.user._id, productId });
    res.json({ success: true, message: 'Added to wishlist', action: 'added' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/user/wishlist/remove/:productId
exports.removeFromWishlist = async (req, res) => {
  try {
    await Wishlist.findOneAndDelete({ userId: req.user._id, productId: req.params.productId });
    res.json({ success: true, message: 'Removed from wishlist' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/user/wishlist
exports.getWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.find({ userId: req.user._id })
      .populate({ path: 'productId', populate: { path: 'sellerId', select: 'businessName type logo rating' } })
      .sort({ createdAt: -1 });
    const items = wishlist.map(w => w.productId).filter(Boolean);
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
