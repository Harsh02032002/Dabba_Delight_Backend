const mongoose = require('mongoose');

const gstSettingsSchema = new mongoose.Schema({
  // Food Items GST
  foodGSTEnabled: {
    type: Boolean,
    default: false,
    description: "Enable GST on food items"
  },
  foodCGSTRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    description: "CGST rate for food items in percentage"
  },
  foodSGSTRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    description: "SGST rate for food items in percentage"
  },
  
  // Platform Commission GST
  platformGSTEnabled: {
    type: Boolean,
    default: false,
    description: "Enable GST on platform commission"
  },
  platformCommissionRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    description: "Platform commission rate in percentage"
  },
  platformGSTRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    description: "GST rate on platform commission in percentage"
  },
  
  // Delivery Charges GST
  deliveryGSTEnabled: {
    type: Boolean,
    default: false,
    description: "Enable GST on delivery charges"
  },
  deliveryCGSTRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    description: "CGST rate for delivery charges in percentage"
  },
  deliverySGSTRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    description: "SGST rate for delivery charges in percentage"
  },
  
  // General Settings
  gstApplicable: {
    type: Boolean,
    default: false,
    description: "Master switch for GST system"
  },
  defaultGSTIN: {
    type: String,
    default: "",
    validate: {
      validator: function(v) {
        // Allow empty string or valid GSTIN format
        return !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9]{1}[A-Z]{1}[0-9A-Z]{1}$/.test(v);
      },
      message: "Invalid GSTIN format"
    },
    description: "Default GSTIN for the platform"
  },
  invoicePrefix: {
    type: String,
    default: "DN",
    maxlength: 10,
    description: "Prefix for invoice numbers"
  }
}, {
  timestamps: true,
  collection: 'gstsettings'
});

// Index for efficient queries
gstSettingsSchema.index({ gstApplicable: 1 });

// Virtual for total food GST rate
gstSettingsSchema.virtual('foodTotalGSTRate').get(function() {
  return this.gstApplicable && this.foodGSTEnabled ? 
    this.foodCGSTRate + this.foodSGSTRate : 0;
});

// Virtual for total delivery GST rate
gstSettingsSchema.virtual('deliveryTotalGSTRate').get(function() {
  return this.gstApplicable && this.deliveryGSTEnabled ? 
    this.deliveryCGSTRate + this.deliverySGSTRate : 0;
});

// Pre-save middleware to validate settings
gstSettingsSchema.pre('save', function(next) {
  // If GST is disabled, ensure all rates are 0
  if (!this.gstApplicable) {
    this.foodGSTEnabled = false;
    this.platformGSTEnabled = false;
    this.deliveryGSTEnabled = false;
    this.foodCGSTRate = 0;
    this.foodSGSTRate = 0;
    this.platformCommissionRate = 0;
    this.platformGSTRate = 0;
    this.deliveryCGSTRate = 0;
    this.deliverySGSTRate = 0;
  }
  
  // If specific GST is disabled, ensure its rates are 0
  if (!this.foodGSTEnabled) {
    this.foodCGSTRate = 0;
    this.foodSGSTRate = 0;
  }
  
  if (!this.platformGSTEnabled) {
    this.platformCommissionRate = 0;
    this.platformGSTRate = 0;
  }
  
  if (!this.deliveryGSTEnabled) {
    this.deliveryCGSTRate = 0;
    this.deliverySGSTRate = 0;
  }
  
  next();
});

// Static method to get current settings
gstSettingsSchema.statics.getCurrentSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = new this();
  }
  return settings;
};

// Static method to get effective GST rates
gstSettingsSchema.statics.getEffectiveGSTRates = async function() {
  const settings = await this.getCurrentSettings();
  
  return {
    food: {
      enabled: settings.gstApplicable && settings.foodGSTEnabled,
      cgst: settings.foodCGSTRate,
      sgst: settings.foodSGSTRate,
      total: settings.foodCGSTRate + settings.foodSGSTRate
    },
    platform: {
      enabled: settings.gstApplicable && settings.platformGSTEnabled,
      commission: settings.platformCommissionRate,
      gst: settings.platformGSTRate
    },
    delivery: {
      enabled: settings.gstApplicable && settings.deliveryGSTEnabled,
      cgst: settings.deliveryCGSTRate,
      sgst: settings.deliverySGSTRate,
      total: settings.deliveryCGSTRate + settings.deliverySGSTRate
    },
    master: {
      enabled: settings.gstApplicable,
      gstin: settings.defaultGSTIN,
      invoicePrefix: settings.invoicePrefix
    }
  };
};

// Method to reset to defaults
gstSettingsSchema.methods.resetToDefaults = function() {
  this.foodGSTEnabled = false;
  this.foodCGSTRate = 0;
  this.foodSGSTRate = 0;
  this.platformGSTEnabled = false;
  this.platformCommissionRate = 0;
  this.platformGSTRate = 0;
  this.deliveryGSTEnabled = false;
  this.deliveryCGSTRate = 0;
  this.deliverySGSTRate = 0;
  this.gstApplicable = false;
  this.defaultGSTIN = "";
  this.invoicePrefix = "DN";
  return this.save();
};

module.exports = mongoose.model('GSTSettings', gstSettingsSchema);
