const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true },
  items: [{
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    price: Number,
    quantity: Number,
    image: String,
  }],
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'pending',
  },
  deliveryAddress: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    fullAddress: String,
    location: {
      type: { type: String, default: 'Point' },
      coordinates: [Number],
    },
  },
  subtotal: Number,
  deliveryFee: { type: Number, default: 40 },
  platformFee: { type: Number, default: 5 },
  gstAmount: Number,
  discount: { type: Number, default: 0 },
  total: Number,
  paymentMethod: { type: String, enum: ['razorpay', 'cod', 'wallet', 'stripe'] },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  paymentId: String,
  specialInstructions: String,
  rating: { type: Number, min: 1, max: 5 },
  review: String,
  estimatedDelivery: Date,
  actualDelivery: Date,
  deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryPartner' },
  deliveryLocation: { lat: Number, lng: Number },
  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
}, { timestamps: true });

// Auto-generate order number
orderSchema.pre('save', async function() {
  if (!this.orderNumber) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await mongoose.model('Order').countDocuments();
    this.orderNumber = `DN-${date}-${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('Order', orderSchema);
