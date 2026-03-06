const Product = require('../models/Product');
const Seller = require('../models/Seller');
const { deleteFromS3 } = require('../middleware/s3-upload.middleware');

// GET /api/products
exports.getProducts = async (req, res) => {
  try {
    const { search, category, isVeg, isAvailable, page = 1, limit = 20, sort = '-createdAt', sellerId } = req.query;
    const filter = {};
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } },
    ];
    if (category) filter.category = category;
    if (isVeg === 'true') filter.isVeg = true;
    if (isAvailable !== undefined) filter.isAvailable = isAvailable === 'true';
    if (sellerId) filter.sellerId = sellerId;
    filter.status = { $ne: 'archived' };

    const products = await Product.find(filter)
      .populate('sellerId', 'businessName type logo rating')
      .sort(sort).limit(Number(limit)).skip((Number(page) - 1) * Number(limit));
    const total = await Product.countDocuments(filter);
    res.json({ success: true, products, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/products
exports.createProduct = async (req, res) => {
  try {
    const data = req.body;
    if (req.file && req.file.s3Url) data.image = req.file.s3Url;
    data.sellerId = req.seller._id;
    const product = await Product.create(data);
    res.status(201).json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/products/:id
exports.updateProduct = async (req, res) => {
  try {
    const data = req.body;
    if (req.file && req.file.s3Url) data.image = req.file.s3Url;
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id }, data, { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/toggle
exports.toggleAvailability = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, sellerId: req.seller._id });
    if (!product) return res.status(404).json({ message: 'Not found' });
    product.isAvailable = !product.isAvailable;
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/out-of-stock
exports.markOutOfStock = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id },
      { isAvailable: false }, { new: true }
    );
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/in-stock
exports.markInStock = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id },
      { isAvailable: true }, { new: true }
    );
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/price
exports.updatePrice = async (req, res) => {
  try {
    const { price } = req.body;
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id },
      { price }, { new: true }
    );
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/category
exports.updateCategory = async (req, res) => {
  try {
    const { category } = req.body;
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id },
      { category }, { new: true }
    );
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/veg-toggle
exports.toggleVeg = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, sellerId: req.seller._id });
    if (!product) return res.status(404).json({ message: 'Not found' });
    product.isVeg = !product.isVeg;
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/products/bulk/create
exports.bulkCreate = async (req, res) => {
  try {
    const items = req.body.map(item => ({ ...item, sellerId: req.seller._id }));
    const products = await Product.insertMany(items);
    res.status(201).json({ success: true, count: products.length, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/products/bulk/update
exports.bulkUpdate = async (req, res) => {
  try {
    const ops = req.body.map(item => ({
      updateOne: { filter: { _id: item._id, sellerId: req.seller._id }, update: { $set: item } },
    }));
    const result = await Product.bulkWrite(ops);
    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/products/:id/duplicate
exports.duplicateProduct = async (req, res) => {
  try {
    const source = await Product.findOne({ _id: req.params.id, sellerId: req.seller._id });
    if (!source) return res.status(404).json({ message: 'Not found' });
    const dup = source.toObject();
    delete dup._id; delete dup.createdAt; delete dup.updatedAt;
    dup.name = `${dup.name} (Copy)`;
    const product = await Product.create(dup);
    res.status(201).json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SOFT DELETE (Recycle Bin) ───────────────────
// PATCH /api/products/:id/archive — soft delete → recycle bin
exports.archiveProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id },
      { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id, isAvailable: false },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json({ success: true, message: 'Product moved to recycle bin', product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/restore — restore from recycle bin
exports.restoreProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id, isDeleted: true },
      { isDeleted: false, deletedAt: null, deletedBy: null, isAvailable: true },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found in recycle bin' });
    res.json({ success: true, message: 'Product restored', product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/products/recycle-bin — list all soft-deleted products
exports.getRecycleBin = async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.seller._id, isDeleted: true })
      .sort({ deletedAt: -1 });
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/products/:id — permanent delete
exports.hardDeleteProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({ _id: req.params.id, sellerId: req.seller._id });
    if (!product) return res.status(404).json({ message: 'Not found' });
    // Clean up S3 image
    if (product.image) await deleteFromS3(product.image);
    if (product.images?.length) await Promise.all(product.images.map(img => deleteFromS3(img)));
    res.json({ success: true, message: 'Product permanently deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/products/recycle-bin/empty — empty recycle bin
exports.emptyRecycleBin = async (req, res) => {
  try {
    const result = await Product.deleteMany({ sellerId: req.seller._id, isDeleted: true });
    res.json({ success: true, message: `${result.deletedCount} products permanently deleted` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/image
exports.replaceImage = async (req, res) => {
  try {
    if (!req.file || !req.file.s3Url) return res.status(400).json({ message: 'No image file' });
    const existing = await Product.findOne({ _id: req.params.id, sellerId: req.seller._id });
    if (existing?.image) await deleteFromS3(existing.image);
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id },
      { image: req.file.s3Url },
      { new: true }
    );
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/products/:id/image
exports.removeImage = async (req, res) => {
  try {
    const existing = await Product.findOne({ _id: req.params.id, sellerId: req.seller._id });
    if (existing?.image) await deleteFromS3(existing.image);
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id },
      { image: null }, { new: true }
    );
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/stock
exports.updateStock = async (req, res) => {
  try {
    const { stock } = req.body;
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id },
      { stock }, { new: true }
    );
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/products/inventory/low-stock
exports.getLowStockProducts = async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.seller._id, stock: { $gt: 0, $lt: 10 } });
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/products/bulk/action
exports.bulkAction = async (req, res) => {
  try {
    const { ids, action, value } = req.body;
    let update = {};
    switch (action) {
      case 'activate': update = { isAvailable: true }; break;
      case 'deactivate': update = { isAvailable: false }; break;
      case 'delete': update = { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id }; break;
      case 'restore': update = { isDeleted: false, deletedAt: null, deletedBy: null }; break;
      case 'updatePrice': update = { price: value }; break;
      case 'updateCategory': update = { category: value }; break;
      default: return res.status(400).json({ message: 'Invalid action' });
    }
    await Product.updateMany({ _id: { $in: ids }, sellerId: req.seller._id }, update);
    res.json({ success: true, message: `${action} applied to ${ids.length} products` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/:id/publish
exports.publishProduct = async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.seller._id },
      { status: 'published', isAvailable: true }, { new: true }
    );
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/products/metrics
exports.getInvestorMetrics = async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments({ sellerId: req.seller._id });
    const activeProducts = await Product.countDocuments({ sellerId: req.seller._id, isAvailable: true });
    const outOfStock = await Product.countDocuments({ sellerId: req.seller._id, stock: 0 });
    res.json({ success: true, totalProducts, activeProducts, outOfStock, inStockRate: totalProducts ? Math.round((activeProducts / totalProducts) * 100) : 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/products/health-score
exports.menuHealthScore = async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.seller._id });
    const total = products.length;
    if (!total) return res.json({ success: true, score: 0, suggestions: ['Add your first product!'] });
    
    let score = 100;
    const suggestions = [];
    const noImage = products.filter(p => !p.image).length;
    const noDesc = products.filter(p => !p.description || p.description.length < 20).length;
    const noTags = products.filter(p => !p.tags || p.tags.length === 0).length;
    
    if (noImage > 0) { score -= 20; suggestions.push(`${noImage} products missing images`); }
    if (noDesc > 0) { score -= 15; suggestions.push(`${noDesc} products need better descriptions`); }
    if (noTags > 0) { score -= 10; suggestions.push(`${noTags} products missing tags`); }
    
    res.json({ success: true, score: Math.max(0, score), suggestions, totalProducts: total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/products/:id/performance
exports.getProductPerformance = async (req, res) => {
  try {
    const Order = require('../models/Order');
    const product = await Product.findOne({ _id: req.params.id, sellerId: req.seller._id });
    if (!product) return res.status(404).json({ message: 'Not found' });

    const orderData = await Order.aggregate([
      { $match: { sellerId: req.seller._id, 'items.menuItemId': product._id, status: 'delivered' } },
      { $unwind: '$items' },
      { $match: { 'items.menuItemId': product._id } },
      { $group: { _id: null, totalQty: { $sum: '$items.quantity' }, totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
    ]);

    res.json({ success: true, product: product.name, ...(orderData[0] || { totalQty: 0, totalRevenue: 0 }) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/products/happy-hour
exports.setHappyHourDiscount = async (req, res) => {
  try {
    const { discount, startTime, endTime, productIds } = req.body;
    const filter = { sellerId: req.seller._id };
    if (productIds && productIds.length) filter._id = { $in: productIds };
    await Product.updateMany(filter, { happyHourDiscount: discount, happyHourStart: startTime, happyHourEnd: endTime });
    res.json({ success: true, message: 'Happy hour set' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
