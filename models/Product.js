const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price: { type: Number, required: true },
  discountPrice: Number,
  category: { type: String, required: true },
  image: String,
  images: [String],
  isVeg: { type: Boolean, default: true },
  isAvailable: { type: Boolean, default: true },
  preparationTime: { type: Number, default: 30 },
  tags: [String],
  allergens: [String],
  nutritionInfo: {
    calories: Number,
    protein: Number,
    carbs: Number,
    fat: Number,
  },
  stock: { type: Number, default: -1 },
  rating: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },

  // Soft delete
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Versioning
  menuVersion: { type: Number, default: 1 },
  previousVersions: [{ type: mongoose.Schema.Types.Mixed }],

  // Happy hour
  happyHourDiscount: { type: Number, default: 0 },
  happyHourStart: String,
  happyHourEnd: String,
}, { timestamps: true });


// ─── FILTER SOFT DELETED PRODUCTS ──────────────
productSchema.pre(/^find/, function () {
  if (this.getQuery().isDeleted === true || this.getQuery().includeDeleted === true) {
    delete this.getQuery().includeDeleted;
    return;
  }
  this.where({ isDeleted: { $ne: true } });
});

productSchema.pre('countDocuments', function () {
  if (this.getQuery().isDeleted === true || this.getQuery().includeDeleted === true) {
    delete this.getQuery().includeDeleted;
    return;
  }
  this.where({ isDeleted: { $ne: true } });
});


// Indexes
productSchema.index({ sellerId: 1, isDeleted: 1 });
productSchema.index({ category: 1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });

// Additional indexes for faster queries
productSchema.index({ sellerId: 1, status: 1, isDeleted: 1 });
productSchema.index({ sellerId: 1, isAvailable: 1 });
productSchema.index({ isVeg: 1 });
productSchema.index({ price: 1 });
productSchema.index({ rating: -1 });
productSchema.index({ totalOrders: -1 });
productSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Product', productSchema);