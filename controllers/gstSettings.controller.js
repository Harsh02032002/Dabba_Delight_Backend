const GSTSettings = require('../models/GSTSettings');

// Get GST settings
exports.getGSTSettings = async (req, res) => {
  try {
    let settings = await GSTSettings.findOne();
    
    // If no settings exist, return default settings
    if (!settings) {
      settings = {
        foodGSTEnabled: false,
        foodCGSTRate: 0,
        foodSGSTRate: 0,
        foodIGSTRate: 0,
        platformGSTEnabled: false,
        platformCommissionRate: 0,
        platformGSTRate: 0,
        deliveryGSTEnabled: false,
        deliveryCGSTRate: 0,
        deliverySGSTRate: 0,
        deliveryIGSTRate: 0,
        gstApplicable: false,
        defaultGSTIN: "",
        invoicePrefix: "DN"
      };
    }
    
    res.json({
      success: true,
      data: settings,
      message: "GST settings retrieved successfully"
    });
  } catch (error) {
    console.error('Error fetching GST settings:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch GST settings",
      error: error.message
    });
  }
};

// Update GST settings (partial updates allowed; aliases: foodGST, commissionRate, commissionGST)
exports.updateGSTSettings = async (req, res) => {
  try {
    const body = { ...req.body };

    if (body.foodGST != null && body.foodGST !== '') {
      const fg = Number(body.foodGST);
      if (Number.isFinite(fg)) {
        body.foodCGSTRate = fg / 2;
        body.foodSGSTRate = fg / 2;
      }
    }
    if (body.commissionRate != null && body.commissionRate !== '') {
      body.platformCommissionRate = Number(body.commissionRate);
    }
    if (body.commissionGST != null && body.commissionGST !== '') {
      body.platformGSTRate = Number(body.commissionGST);
    }

    let settings = await GSTSettings.findOne();
    if (!settings) settings = new GSTSettings();

    const keys = [
      'foodGSTEnabled',
      'foodCGSTRate',
      'foodSGSTRate',
      'foodIGSTRate',
      'platformGSTEnabled',
      'platformCommissionRate',
      'platformGSTRate',
      'deliveryGSTEnabled',
      'deliveryCGSTRate',
      'deliverySGSTRate',
      'deliveryIGSTRate',
      'gstApplicable',
      'defaultGSTIN',
      'invoicePrefix',
    ];

    for (const k of keys) {
      if (body[k] !== undefined) settings[k] = body[k];
    }

    if (body.defaultGSTIN === '') settings.defaultGSTIN = '';

    if (
      settings.foodGSTEnabled &&
      (Number(settings.foodCGSTRate) < 0 || Number(settings.foodSGSTRate) < 0)
    ) {
      return res.status(400).json({ success: false, message: 'Food GST rates cannot be negative' });
    }

    if (settings.platformGSTEnabled && (settings.platformCommissionRate < 0 || settings.platformGSTRate < 0)) {
      return res.status(400).json({ success: false, message: 'Platform GST rates cannot be negative' });
    }

    if (settings.deliveryGSTEnabled && (settings.deliveryCGSTRate < 0 || settings.deliverySGSTRate < 0 || Number(settings.deliveryIGSTRate) < 0)) {
      return res.status(400).json({ success: false, message: 'Delivery GST rates cannot be negative' });
    }
    if (settings.foodGSTEnabled && Number(settings.foodIGSTRate) < 0) {
      return res.status(400).json({ success: false, message: 'Food IGST rate cannot be negative' });
    }

    if (settings.defaultGSTIN && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9]{1}[A-Z]{1}[0-9A-Z]{1}$/.test(settings.defaultGSTIN)) {
      return res.status(400).json({ success: false, message: 'Invalid GSTIN format' });
    }

    await settings.save();

    res.json({
      success: true,
      data: settings,
      message: 'GST settings updated successfully',
    });
  } catch (error) {
    console.error('Error updating GST settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update GST settings',
      error: error.message,
    });
  }
};

// Reset GST settings to defaults
exports.resetGSTSettings = async (req, res) => {
  try {
    await GSTSettings.deleteMany({});
    
    const defaultSettings = {
      foodGSTEnabled: false,
      foodCGSTRate: 0,
      foodSGSTRate: 0,
      platformGSTEnabled: false,
      platformCommissionRate: 0,
      platformGSTRate: 0,
      deliveryGSTEnabled: false,
      deliveryCGSTRate: 0,
      deliverySGSTRate: 0,
      gstApplicable: false,
      defaultGSTIN: "",
      invoicePrefix: "DN"
    };

    res.json({
      success: true,
      data: defaultSettings,
      message: "GST settings reset to defaults"
    });
  } catch (error) {
    console.error('Error resetting GST settings:', error);
    res.status(500).json({
      success: false,
      message: "Failed to reset GST settings",
      error: error.message
    });
  }
};

// Get GST summary for admin dashboard
exports.getGSTSummary = async (req, res) => {
  try {
    const settings = await GSTSettings.findOne();
    
    if (!settings) {
      return res.json({
        success: true,
        data: {
          totalGSTRate: 0,
          isGSTEnabled: false,
          gstBreakup: {
            food: { enabled: false, rate: 0 },
            platform: { enabled: false, rate: 0 },
            delivery: { enabled: false, rate: 0 }
          }
        }
      });
    }

    const foodTotal = settings.gstApplicable && settings.foodGSTEnabled ? 
      settings.foodCGSTRate + settings.foodSGSTRate : 0;
    
    const platformRate = settings.gstApplicable && settings.platformGSTEnabled ? 
      settings.platformGSTRate : 0;
    
    const deliveryTotal = settings.gstApplicable && settings.deliveryGSTEnabled ? 
      settings.deliveryCGSTRate + settings.deliverySGSTRate : 0;

    res.json({
      success: true,
      data: {
        totalGSTRate: Math.max(foodTotal, platformRate, deliveryTotal),
        isGSTEnabled: settings.gstApplicable,
        gstBreakup: {
          food: { 
            enabled: settings.gstApplicable && settings.foodGSTEnabled, 
            rate: foodTotal,
            cgst: settings.foodCGSTRate,
            sgst: settings.foodSGSTRate
          },
          platform: { 
            enabled: settings.gstApplicable && settings.platformGSTEnabled, 
            rate: platformRate,
            commission: settings.platformCommissionRate
          },
          delivery: { 
            enabled: settings.gstApplicable && settings.deliveryGSTEnabled, 
            rate: deliveryTotal,
            cgst: settings.deliveryCGSTRate,
            sgst: settings.deliverySGSTRate
          }
        },
        defaultGSTIN: settings.defaultGSTIN,
        invoicePrefix: settings.invoicePrefix
      }
    });
  } catch (error) {
    console.error('Error fetching GST summary:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch GST summary",
      error: error.message
    });
  }
};
