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
  preparationTime: { type: Number, default: 30 }, // minutes
  tags: [String],
  allergens: [String],
  nutritionInfo: {
    calories: Number,
    protein: Number,
    carbs: Number,
    fat: Number,
  },
  stock: { type: Number, default: -1 }, // -1 = unlimited
  rating: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },
  
  // ─── SOFT DELETE / RECYCLE BIN ─────────────────
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  
  // ─── VERSIONING ───────────────────────────────
  menuVersion: { type: Number, default: 1 },
  previousVersions: [{ type: mongoose.Schema.Types.Mixed }],
  
  // ─── HAPPY HOUR ───────────────────────────────
  happyHourDiscount: { type: Number, default: 0 },
  happyHourStart: String,
  happyHourEnd: String,
}, { timestamps: true });

// Default query: exclude soft-deleted products
productSchema.pre(/^find/, function (next) {
  // Allow explicit query for deleted items
  if (this.getQuery().isDeleted === true || this.getQuery().includeDeleted === true) {
    delete this.getQuery().includeDeleted;
    return next();
  }
  this.where({ isDeleted: { $ne: true } });
  next();
});

productSchema.pre('countDocuments', function (next) {
  if (this.getQuery().isDeleted === true || this.getQuery().includeDeleted === true) {
    delete this.getQuery().includeDeleted;
    return next();
  }
  this.where({ isDeleted: { $ne: true } });
  next();
});

productSchema.index({ sellerId: 1, isDeleted: 1 });
productSchema.index({ category: 1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Product', productSchema);
