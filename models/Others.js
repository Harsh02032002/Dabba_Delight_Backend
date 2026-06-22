const mongoose = require("mongoose");

// ─── Invoice ────────────────────────────────────
const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, unique: true, required: true },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },
    items: [{ name: String, quantity: Number, price: Number, total: Number }],
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["razorpay", "cod", "wallet", "stripe"],
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    pdfPath: String,
  },
  { timestamps: true },
);

const Invoice = mongoose.model("Invoice", invoiceSchema);

// ─── Wishlist ───────────────────────────────────
const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
  },
  { timestamps: true },
);
wishlistSchema.index({ userId: 1, productId: 1 }, { unique: true });
const Wishlist = mongoose.model("Wishlist", wishlistSchema);

// ─── Address ────────────────────────────────────
const addressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    label: { type: String, enum: ["home", "work", "other"], default: "home" },
    fullAddress: { type: String, required: true },
    street: String,
    landmark: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    country: { type: String, default: "India" },
    location: {
      type: { type: String, default: "Point" },
      coordinates: [Number],
    },
    isDefault: { type: Boolean, default: false },
    phone: String,
    contactName: String,
  },
  { timestamps: true },
);
addressSchema.index({ location: "2dsphere" });
addressSchema.index({ userId: 1 });
const Address = mongoose.model("Address", addressSchema);

// ─── Settlement ─────────────────────────────────
const settlementSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },
    period: { startDate: Date, endDate: Date },
    totalOrders: { type: Number, default: 0 },
    grossAmount: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    tds: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    transactionId: String,
    processedAt: Date,
    orderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  },
  { timestamps: true },
);
const Settlement = mongoose.model("Settlement", settlementSchema);

// ─── Referral ───────────────────────────────────
const referralSchema = new mongoose.Schema(
  {
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },
    referredId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    referralCode: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "completed", "expired"],
      default: "pending",
    },
    reward: { type: Number, default: 0 },
    rewardClaimed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
const Referral = mongoose.model("Referral", referralSchema);

// ─── Promotion ──────────────────────────────────
const promotionSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },
    name: { type: String, required: true },
    code: { type: String, required: true },
    type: {
      type: String,
      enum: ["percentage", "flat", "bogo", "freeDelivery"],
      default: "percentage",
    },
    value: { type: Number, required: true },
    minOrderAmount: { type: Number, default: 0 },
    maxDiscount: Number,
    validFrom: Date,
    validTo: Date,
    usageLimit: { type: Number, default: 100 },
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    applicableProducts: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    ],
  },
  { timestamps: true },
);
const Promotion = mongoose.model("Promotion", promotionSchema);

// ─── Review ─────────────────────────────────────
const reviewSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },
    rating: { type: Number, min: 1, max: 5, required: true },
    review: String,
    reply: { message: String, repliedAt: Date },
    images: [String],
  },
  { timestamps: true },
);
const Review = mongoose.model("Review", reviewSchema);

// ─── Campaign ───────────────────────────────────
const campaignSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["banner", "push", "email", "sms", "social"],
      default: "banner",
    },
    status: {
      type: String,
      enum: ["draft", "active", "paused", "completed"],
      default: "draft",
    },
    budget: { type: Number, default: 0 },
    spent: { type: Number, default: 0 },
    startDate: Date,
    endDate: Date,
    targetAudience: { type: String, default: "all" },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    content: { title: String, body: String, image: String },
  },
  { timestamps: true },
);
const Campaign = mongoose.model("Campaign", campaignSchema);

// ─── Payout ─────────────────────────────────────
const payoutSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },
    amount: { type: Number, required: true },
    method: {
      type: String,
      enum: ["bank_transfer", "upi", "cheque"],
      default: "bank_transfer",
    },
    status: {
      type: String,
      enum: ["requested", "processing", "completed", "failed"],
      default: "requested",
    },
    transactionId: String,
    processedAt: Date,
    requestedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
const Payout = mongoose.model("Payout", payoutSchema);

// ─── Support Ticket ─────────────────────────────
const supportTicketSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["seller", "user", "admin"],
      default: "seller",
    },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    category: {
      type: String,
      enum: ["order", "payment", "technical", "kyc", "other"],
      default: "other",
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    responses: [
      {
        message: String,
        respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        isAdmin: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);
const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);

// ─── Notification ───────────────────────────────
const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: { type: String, default: "general" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    data: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
const Notification = mongoose.model("Notification", notificationSchema);

// ─── Notification Preference ────────────────────
const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    orderAlerts: { type: Boolean, default: true },
    settlementAlerts: { type: Boolean, default: true },
    marketingEmails: { type: Boolean, default: false },
    statusUpdates: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
  },
  { timestamps: true },
);
const NotificationPreference = mongoose.model(
  "NotificationPreference",
  notificationPreferenceSchema,
);

// ─── Delivery Partner ───────────────────────────
const deliveryPartnerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    email: String,
    avatar: String,
    vehicleType: {
      type: String,
      enum: ["bike", "scooter", "bicycle", "car"],
      default: "bike",
    },
    vehicleNumber: String,
    licenseNumber: String,
    currentLocation: {
      type: { type: String, default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },
    isAvailable: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },
    isOnBreak: { type: Boolean, default: false },
    kycStatus: {
      type: String,
      enum: ["pending", "submitted", "verified", "rejected"],
      default: "pending",
    },
    kycDocuments: {
      aadhaar: {
        url: String,
        status: {
          type: String,
          enum: ["pending", "uploaded", "verified", "rejected"],
          default: "pending",
        },
      },
      pan: {
        url: String,
        status: {
          type: String,
          enum: ["pending", "uploaded", "verified", "rejected"],
          default: "pending",
        },
      },
      drivingLicense: {
        url: String,
        status: {
          type: String,
          enum: ["pending", "uploaded", "verified", "rejected"],
          default: "pending",
        },
      },
      vehicleRC: {
        url: String,
        status: {
          type: String,
          enum: ["pending", "uploaded", "verified", "rejected"],
          default: "pending",
        },
      },
    },
    rating: { type: Number, default: 5.0 },
    totalDeliveries: { type: Number, default: 0 },
    earnings: { type: Number, default: 0 },
    todayEarnings: { type: Number, default: 0 },
    weekEarnings: { type: Number, default: 0 },
    bankDetails: {
      accountNumber: String,
      ifscCode: String,
      accountHolder: String,
      bankName: String,
    },
    activeOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    assignedWarehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },
    shiftStatus: {
      type: String,
      enum: ["off_duty", "on_duty", "on_break"],
      default: "off_duty",
    },
    shiftStart: Date,
    shiftEnd: Date,
    todayDeliveries: { type: Number, default: 0 },
    incentives: { type: Number, default: 0 },
    tips: { type: Number, default: 0 },
    zone: String,
    city: String,
  },
  { timestamps: true },
);
deliveryPartnerSchema.index({ currentLocation: "2dsphere" });
deliveryPartnerSchema.index({ city: 1, isOnline: 1 });
const DeliveryPartner = mongoose.model(
  "DeliveryPartner",
  deliveryPartnerSchema,
);

// ─── Warehouse / Dark Store ─────────────────────
const warehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, unique: true },
    type: {
      type: String,
      enum: ["dark_store", "warehouse", "hub"],
      default: "dark_store",
    },
    address: {
      street: String,
      city: { type: String, required: true },
      state: String,
      pincode: String,
      location: {
        type: { type: String, default: "Point" },
        coordinates: [Number],
      },
    },
    manager: { name: String, phone: String, email: String },
    capacity: { type: Number, default: 100 },
    currentLoad: { type: Number, default: 0 },
    operatingHours: {
      open: { type: String, default: "06:00" },
      close: { type: String, default: "23:00" },
    },
    isActive: { type: Boolean, default: true },
    mappedSellers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Seller" }],
    deliveryRadius: { type: Number, default: 10 }, // km
    totalOrders: { type: Number, default: 0 },
    assignedPartners: [
      { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryPartner" },
    ],
    zone: String,
  },
  { timestamps: true },
);
warehouseSchema.index({ "address.location": "2dsphere" });
const Warehouse = mongoose.model("Warehouse", warehouseSchema);

// ─── Delivery Payment Config ────────────────────
const deliveryPayConfigSchema = new mongoose.Schema(
  {
    basePay: { type: Number, default: 25 },
    perKmRate: { type: Number, default: 8 },
    surgeMultiplier: { type: Number, default: 1.0 },
    surgeActive: { type: Boolean, default: false },
    rainSurge: { type: Number, default: 1.5 },
    peakHourSurge: { type: Number, default: 1.3 },
    peakHours: [{ start: String, end: String }],
    tipPassthrough: { type: Number, default: 100 }, // percentage passed to partner
    incentivePerDelivery: { type: Number, default: 0 },
    bonusThreshold: { type: Number, default: 20 }, // deliveries for bonus
    bonusAmount: { type: Number, default: 200 },
    weeklySettlement: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
const DeliveryPayConfig = mongoose.model(
  "DeliveryPayConfig",
  deliveryPayConfigSchema,
);

// ─── Delivery Partner Settlement ────────────────
const deliverySettlementSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryPartner",
      required: true,
    },
    period: { startDate: Date, endDate: Date },
    totalDeliveries: { type: Number, default: 0 },
    basePay: { type: Number, default: 0 },
    distancePay: { type: Number, default: 0 },
    surgePay: { type: Number, default: 0 },
    tips: { type: Number, default: 0 },
    incentives: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    transactionId: String,
    processedAt: Date,
  },
  { timestamps: true },
);
const DeliverySettlement = mongoose.model(
  "DeliverySettlement",
  deliverySettlementSchema,
);

// ─── Commission Config ──────────────────────────
const commissionConfigSchema = new mongoose.Schema(
  {
    defaultRate: { type: Number, default: 15 },
    categoryRates: [{ category: String, rate: Number }],
    sellerOverrides: [
      {
        sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
        rate: Number,
        reason: String,
      },
    ],
    minCommission: { type: Number, default: 5 },
    maxCommission: { type: Number, default: 30 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
const CommissionConfig = mongoose.model(
  "CommissionConfig",
  commissionConfigSchema,
);

// ─── GST Config ─────────────────────────────────
const gstConfigSchema = new mongoose.Schema(
  {
    cgstRate: { type: Number, default: 2.5 },
    sgstRate: { type: Number, default: 2.5 },
    igstRate: { type: Number, default: 5 },
    gstNumber: String,
    autoInvoicing: { type: Boolean, default: true },
    hsnCode: { type: String, default: "996331" },
    categoryRates: [{ category: String, cgst: Number, sgst: Number }],
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
const GSTConfig = mongoose.model("GSTConfig", gstConfigSchema);

// ─── Referral Config ────────────────────────────
const referralConfigSchema = new mongoose.Schema(
  {
    sellerReward: { type: Number, default: 500 },
    referredReward: { type: Number, default: 200 },
    userReward: { type: Number, default: 100 },
    minOrdersToUnlock: { type: Number, default: 3 },
    isActive: { type: Boolean, default: true },
    maxReferralsPerSeller: { type: Number, default: 50 },
    expiryDays: { type: Number, default: 30 },
  },
  { timestamps: true },
);
const ReferralConfig = mongoose.model("ReferralConfig", referralConfigSchema);

// ─── Dispute ────────────────────────────────────
const disputeSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },
    reason: { type: String, required: true },
    description: String,
    status: {
      type: String,
      enum: ["open", "investigating", "resolved", "rejected"],
      default: "open",
    },
    resolution: String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: Date,
    refundAmount: { type: Number, default: 0 },
    evidence: [String],
  },
  { timestamps: true },
);
const Dispute = mongoose.model("Dispute", disputeSchema);

// ─── Audit Log ──────────────────────────────────
const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true },
    entity: String,
    entityId: mongoose.Schema.Types.ObjectId,
    details: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true },
);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1 });
const AuditLog = mongoose.model("AuditLog", auditLogSchema);

// ─── Category ───────────────────────────────────
const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    slug: String,
    icon: String,
    image: String,
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    description: String,
  },
  { timestamps: true },
);
const Category = mongoose.model("Category", categorySchema);

// ─── Platform Config ────────────────────────────
const platformConfigSchema = new mongoose.Schema(
  {
    platformName: { type: String, default: "Dabba Nation" },
    supportEmail: { type: String, default: "support@dabbanation.com" },
    supportPhone: { type: String, default: "+91 1800-123-4567" },
    emailNotifications: { type: Boolean, default: true },
    smsNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
    minAppVersion: String,
    deliveryFee: { type: Number, default: 40 },
    platformFee: { type: Number, default: 5 },
    freeDeliveryThreshold: { type: Number, default: 500 },

    // ── Footer Social Links ──────────────────────────
    socialYoutube: {
      type: String,
      default: "https://youtube.com/@dabbanationofficial?si=hjZTZz5eQ-t0gMlO",
    },
    socialInstagram: {
      type: String,
      default:
        "https://www.instagram.com/dabbanation?utm_source=qr&igsh=aGlweTZ1cDRvZjQ5",
    },
    socialFacebook: {
      type: String,
      default: "https://www.facebook.com/share/1D1u1We4vN/",
    },
    socialLinkedin: {
      type: String,
      default:
        "https://www.linkedin.com/in/akash-diwivedi-a01a65411?utm_source=share_via&utm_content=profile&utm_medium=member_android",
    },

    // ── Footer Address ───────────────────────────────
    footerAddress: {
      type: String,
      default: "East Shastri Nagar, Ram Gulam Tola, Deoria 274001",
    },
    footerTagline: {
      type: String,
      default:
        "Your trusted food delivery partner, bringing delicious homemade and restaurant meals to your doorstep.",
    },

    // ── About Us Page Content ────────────────────────
    aboutTagline: {
      type: String,
      default: "Empowering Home Chefs & Restaurants Across India",
    },
    aboutIntro: {
      type: String,
      default:
        "Dabba Nation is an Indian food-tech platform founded by Akash Dwivedi with a vision to transform the way people discover, order, and enjoy food. Our platform connects customers with talented home chefs, tiffin service providers, and restaurants through a single trusted ecosystem.",
    },
    aboutMission: {
      type: String,
      default:
        "To empower home chefs, restaurants, and local food entrepreneurs by providing them with technology, visibility, and growth opportunities while delivering quality food experiences to customers across India.",
    },
    aboutVision: {
      type: String,
      default:
        "To become India's most trusted food ecosystem, connecting millions of customers with home chefs, restaurants, and food businesses through innovation, trust, and technology.",
    },
    aboutFounderName: { type: String, default: "Akash Dwivedi" },
    aboutFounderDesc: {
      type: String,
      default:
        "Driven by a passion for entrepreneurship and innovation, Akash founded Dabba Nation with the goal of creating opportunities for home chefs, supporting local food businesses, and making quality food accessible to everyone. Under his leadership, Dabba Nation continues to build a platform focused on trust, convenience, affordability, and growth for both customers and food partners.",
    },
    aboutTechLeadName: { type: String, default: "Harshdeep" },
    aboutTechLeadDesc: {
      type: String,
      default:
        "The technical development and platform engineering of Dabba Nation is led by Harshdeep, who plays a key role in building, managing, and improving the technology infrastructure that powers the Dabba Nation platform.",
    },
    aboutUdyamNumber: { type: String, default: "UDYAM-UP-21-0060612" },

    // ── Contact Page ─────────────────────────────────
    contactWorkingHours: {
      type: String,
      default: "Monday – Saturday, 9:00 AM – 9:00 PM IST",
    },

    // ── Footer Bottom ────────────────────────────────
    footerCopyright: { type: String, default: "Made with ❤️ in India" },

    // ── Static Page Content (JSON arrays) ────────────
    privacyPageContent: {
      type: String,
      default: JSON.stringify([
        {
          title: "1. Information We Collect",
          content:
            "We collect information you provide directly, including your name, email address, phone number, delivery addresses, payment details, and order history. We also collect device information, IP addresses, and usage data automatically.",
        },
        {
          title: "2. How We Use Your Information",
          content:
            "• To process and deliver your food orders\n• To communicate order updates and delivery status\n• To provide customer support\n• To personalize your experience and recommendations\n• To process payments securely\n• To improve our platform and services\n• To send promotional offers (with your consent)",
        },
        {
          title: "3. Information Sharing",
          content:
            "We share your information only with:\n• Sellers/restaurants to fulfill your orders\n• Delivery partners for order delivery\n• Payment processors for secure transactions\n• As required by law or legal proceedings\n\nWe never sell your personal data to third parties.",
        },
        {
          title: "4. Data Security",
          content:
            "We implement industry-standard security measures including encryption, secure servers, and regular security audits to protect your personal information.",
        },
        {
          title: "5. Cookies & Tracking",
          content:
            "We use cookies and similar technologies to enhance your browsing experience, remember your preferences, and analyze platform usage.",
        },
        {
          title: "6. Your Rights",
          content:
            "You have the right to access, update, or delete your personal data. You can manage your preferences in your account settings or contact us at support@dabbanation.com.",
        },
        {
          title: "7. Contact Us",
          content:
            "For privacy-related questions, contact us at:\nEmail: support@dabbanation.com\nPhone: +91 73030 23539\nAddress: East Shastri Nagar, Ram Gulam Tola, Deoria 274001",
        },
      ]),
    },

    termsPageContent: {
      type: String,
      default: JSON.stringify([
        {
          title: "1. Acceptance of Terms",
          content:
            "By accessing or using Dabba Nation's platform, you agree to be bound by these Terms of Service. If you do not agree, please do not use our services.",
        },
        {
          title: "2. Account Registration",
          content:
            "You must provide accurate, complete information when creating an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account.",
        },
        {
          title: "3. Orders & Payments",
          content:
            "• All orders are subject to acceptance by the seller\n• Prices displayed include applicable taxes unless stated otherwise\n• Payment can be made via Razorpay (UPI, cards, netbanking) or Cash on Delivery\n• Orders once confirmed cannot be modified; cancellation policies apply",
        },
        {
          title: "4. Delivery",
          content:
            "Delivery times are estimates and may vary based on distance, traffic, and order volume. We strive to deliver within the estimated timeframe but do not guarantee exact delivery times.",
        },
        {
          title: "5. Seller Responsibilities",
          content:
            "Sellers on our platform are responsible for food quality, hygiene, accurate menu descriptions, and timely preparation. Dabba Nation acts as a marketplace facilitator.",
        },
        {
          title: "6. User Conduct",
          content:
            "Users must not misuse the platform, submit fraudulent orders, harass delivery partners or sellers, or engage in any activity that violates applicable laws.",
        },
        {
          title: "7. Intellectual Property",
          content:
            "All content on Dabba Nation, including logos, designs, and text, is owned by Dabba Nation and protected by intellectual property laws.",
        },
        {
          title: "8. Limitation of Liability",
          content:
            "Dabba Nation is not liable for any food quality issues, allergic reactions, delivery delays beyond our control, or any indirect/consequential damages arising from the use of our platform.",
        },
        {
          title: "9. Changes to Terms",
          content:
            "We reserve the right to modify these terms at any time. Continued use of the platform after changes constitutes acceptance of the updated terms.",
        },
        {
          title: "10. Contact",
          content:
            "For questions about these terms, contact us at support@dabbanation.com.",
        },
      ]),
    },

    refundPageContent: {
      type: String,
      default: JSON.stringify([
        {
          title: "1. Order Cancellation",
          content:
            "• Before confirmation: Full refund if cancelled before the seller confirms the order\n• After confirmation: Cancellation may not be possible once the seller has started preparing your order\n• After dispatch: Orders cannot be cancelled once out for delivery",
        },
        {
          title: "2. Refund Eligibility",
          content:
            "You may be eligible for a refund in the following cases:\n• Wrong items delivered\n• Missing items from your order\n• Food quality issues (spoiled, stale, or contaminated food)\n• Order not delivered within a reasonable timeframe\n• Significant difference between menu description and actual product",
        },
        {
          title: "3. Refund Process",
          content:
            "• Report issues within 24 hours of delivery through the app or website\n• Provide photos/evidence of the issue when applicable\n• Our team will review your complaint within 24-48 hours\n• Approved refunds will be processed within 5-7 business days",
        },
        {
          title: "4. Refund Methods",
          content:
            "• Online payments (Razorpay): Refund to original payment method\n• Cash on Delivery: Refund credited to Dabba Nation wallet\n• Wallet payments: Refund to Dabba Nation wallet",
        },
        {
          title: "5. Non-Refundable Cases",
          content:
            "• Change of mind after order is confirmed\n• Incorrect delivery address provided by user\n• Delay due to factors beyond our control (weather, traffic, etc.)\n• Issues reported after 24 hours of delivery",
        },
        {
          title: "6. Delivery Fee Refund",
          content:
            "Delivery fees are non-refundable unless the entire order is cancelled before confirmation or the order was not delivered at all.",
        },
        {
          title: "7. Contact Us",
          content:
            "For refund-related queries, contact us at:\nEmail: support@dabbanation.com\nPhone: +91 73030 23539",
        },
      ]),
    },
  },
  { timestamps: true },
);
const PlatformConfig = mongoose.model("PlatformConfig", platformConfigSchema);

// ─── Wallet Transaction ─────────────────────────
const walletTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: { type: String, enum: ["credit", "debit"], required: true },
    amount: { type: Number, required: true },
    description: String,
    referenceId: String,
    referenceType: {
      type: String,
      enum: ["order", "refund", "referral", "topup", "settlement"],
    },
    balance: Number,
  },
  { timestamps: true },
);
const WalletTransaction = mongoose.model(
  "WalletTransaction",
  walletTransactionSchema,
);

// ─── Banner ─────────────────────────────────────
const bannerSchema = new mongoose.Schema(
  {
    title: String,
    image: String,
    link: String,
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
const Banner = mongoose.model("Banner", bannerSchema);

module.exports = {
  Invoice,
  Wishlist,
  Address,
  Settlement,
  Referral,
  Promotion,
  Review,
  Campaign,
  Payout,
  SupportTicket,
  Notification,
  NotificationPreference,
  DeliveryPartner,
  CommissionConfig,
  GSTConfig,
  ReferralConfig,
  Dispute,
  AuditLog,
  Category,
  PlatformConfig,
  WalletTransaction,
  Banner,
  Warehouse,
  DeliveryPayConfig,
  DeliverySettlement,
};
