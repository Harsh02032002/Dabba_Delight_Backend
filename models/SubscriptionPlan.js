const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema(
  {
    plan_name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    total_amount: { type: Number, required: true, min: 0 },
    total_days: { type: Number, required: true, min: 1 },
    per_day_value: { type: Number, required: true, min: 0 },
    
    // Banner image for the subscription card
    banner_image: { type: String, default: null },
    image: { type: String, default: null },

    // Seller this subscription is tied to
    assigned_seller_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      default: null,
      index: true,
    },

    // Optional plan constraints / custom items
    max_orders_per_day: { type: Number, default: null, min: 1 },
    allowed_categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    allowed_items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    allowed_items_data: [
      {
        name: { type: String, trim: true },
        price: { type: Number, min: 0 },
        image: { type: String, default: null },
      }
    ],

    // Plan type - only home_chef for subscriptions
    plan_type: { type: String, default: 'home_chef', enum: ['home_chef'] },
    
    // Plan settings
    is_active: { type: Boolean, default: true, index: true },
    is_public: { type: Boolean, default: true },
    
    // Display settings
    display_order: { type: Number, default: 0 },
    badge: { type: String, trim: true }, // e.g., "POPULAR", "BEST VALUE"
    
    // Plan features for display
    features: [{ type: String, trim: true }],
    
    // Duration validity
    validity_days: { type: Number, default: null }, // null = no expiry from purchase date
    
    // Auto-renewal settings
    auto_renew: { type: Boolean, default: false },
    renew_plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', default: null },
    
    // Admin notes
    admin_notes: { type: String },
    
    // Plan is available for subscription
    is_available: { type: Boolean, default: true }
  },
  { timestamps: true, collection: 'subscription_plans' }
);

// Indexes for faster queries
subscriptionPlanSchema.index({ is_active: 1, is_public: 1, display_order: 1 });
subscriptionPlanSchema.index({ plan_name: 'text', description: 'text' });

// Pre-save middleware to auto-calculate per_day_value
subscriptionPlanSchema.pre('save', function(next) {
  if (this.total_days > 0) {
    this.per_day_value = this.total_amount / this.total_days;
  }
  next();
});

// toJSON method to remove poster fields from API response
subscriptionPlanSchema.methods.toJSON = function() {
  const obj = this.toObject();
  
  // Remove poster-related fields from response
  delete obj.poster_image;
  delete obj.poster_bg_color;
  delete obj.poster_bg_image;
  delete obj.poster_font_size;
  delete obj.poster_font_color;
  delete obj.poster_accent_color;
  delete obj.poster_layout;
  delete obj.poster_show_features;
  delete obj.poster_show_seller;
  delete obj.poster_custom_fields;
  delete obj.poster_selected_fields;
  delete obj.poster_extra_images;
  delete obj.poster_width;
  delete obj.poster_height;
  
  return obj;
};

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
