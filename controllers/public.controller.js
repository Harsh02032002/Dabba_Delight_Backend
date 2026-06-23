const GSTSettings = require("../models/GSTSettings");
const { PlatformConfig } = require("../models/Others");

/** Anonymous clients (checkout) need tax rates without admin auth */
exports.getPublicGSTSettings = async (req, res) => {
  try {
    const s = await GSTSettings.getCurrentSettings();
    const d = typeof s?.toObject === "function" ? s.toObject() : { ...s };
    res.json({
      success: true,
      data: {
        gstApplicable: d.gstApplicable,
        foodGSTEnabled: d.foodGSTEnabled,
        foodCGSTRate: d.foodCGSTRate,
        foodSGSTRate: d.foodSGSTRate,
        foodIGSTRate: d.foodIGSTRate,
        foodGST: (Number(d.foodCGSTRate) || 0) + (Number(d.foodSGSTRate) || 0),
        platformGSTEnabled: d.platformGSTEnabled,
        platformCommissionRate: d.platformCommissionRate,
        commissionRate: d.platformCommissionRate,
        platformGSTRate: d.platformGSTRate,
        commissionGST: d.platformGSTRate,
        deliveryGSTEnabled: d.deliveryGSTEnabled,
        deliveryCGSTRate: d.deliveryCGSTRate,
        deliverySGSTRate: d.deliverySGSTRate,
        deliveryIGSTRate: d.deliveryIGSTRate,
        defaultGSTIN: d.defaultGSTIN,
        invoicePrefix: d.invoicePrefix,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getPublicPlatformConfig = async (req, res) => {
  try {
    let c = await PlatformConfig.findOne();
    if (!c) c = await PlatformConfig.create({});
    const o = typeof c.toObject === "function" ? c.toObject() : c;
    res.json({
      success: true,
      // Fees
      platformFee: o.platformFee,
      deliveryFee: o.deliveryFee,
      freeDeliveryAbove: o.freeDeliveryThreshold,
      // General
      platformName: o.platformName,
      supportEmail: o.supportEmail,
      supportPhone: o.supportPhone,
      // Footer
      footerTagline: o.footerTagline,
      footerAddress: o.footerAddress,
      footerCopyright: o.footerCopyright,
      // Social Links
      socialYoutube: o.socialYoutube,
      socialInstagram: o.socialInstagram,
      socialFacebook: o.socialFacebook,
      socialLinkedin: o.socialLinkedin,
      // Contact Page
      contactWorkingHours: o.contactWorkingHours,
      // About Us
      aboutTagline: o.aboutTagline,
      aboutIntro: o.aboutIntro,
      aboutMission: o.aboutMission,
      aboutVision: o.aboutVision,
      aboutFounderName: o.aboutFounderName,
      aboutFounderDesc: o.aboutFounderDesc,
      aboutTechLeadName: o.aboutTechLeadName,
      aboutTechLeadDesc: o.aboutTechLeadDesc,
      aboutUdyamNumber: o.aboutUdyamNumber,
      // Static Pages
      privacyPageContent: o.privacyPageContent,
      termsPageContent: o.termsPageContent,
      refundPageContent: o.refundPageContent,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
