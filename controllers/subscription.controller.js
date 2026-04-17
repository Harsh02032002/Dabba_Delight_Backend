const Subscription = require('../models/Subscription');
const SubscriptionUsage = require('../models/SubscriptionUsage');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const User = require('../models/User');
const mongoose = require('mongoose');
const subscriptionService = require('../services/subscription.service');
const Order = require('../models/Order');
const WalletTransaction = require('../models/WalletTransaction');
const walletController = require('../controllers/wallet.controller');

// ============= USER CONTROLLERS =============

exports.getActiveForUser = async (req, res) => {
  try {
    console.log('🔍 getActiveForUser called for user:', req.user._id);
    
    // Get ALL subscriptions for this user first
    const allSubs = await Subscription.find({
      user_id: req.user._id,
    }).sort({ createdAt: -1 });
    
    console.log('📋 All user subscriptions:', allSubs.length);
    allSubs.forEach((sub, i) => {
      console.log(`  [${i}] status: ${sub.status}, remaining: ${sub.remaining_amount}/${sub.remaining_days}`);
    });
    
    // Find the MOST RECENT active subscription
    const subscription = await Subscription.findOne({
      user_id: req.user._id,
      status: 'active',
    })
    .sort({ createdAt: -1 }) // Get the newest one first
    .populate('plan_id', 'plan_name description features')
    .populate('seller_id', 'businessName type logo');
    
    console.log('📋 Active subscription found:', subscription ? 'Yes' : 'No');
    if (subscription) {
      console.log('📋 Subscription details:', {
        id: subscription._id,
        seller_id: subscription.seller_id?._id,
        seller_name: subscription.seller_id?.businessName,
        remaining_amount: subscription.remaining_amount,
        remaining_days: subscription.remaining_days
      });
    }
    
    res.json({ success: true, subscription });
  } catch (e) {
    console.error('❌ Error in getActiveForUser:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getMySubscriptions = async (req, res) => {
  try {
    console.log('🔍 getMySubscriptions called for user:', req.user._id);
    
    const subscriptions = await Subscription.find({
      user_id: req.user._id,
    })
    .sort({ createdAt: -1 })
    .populate('plan_id', 'plan_name description features image')
    .populate('seller_id', 'businessName type logo coverImage');
    
    console.log('📋 Total subscriptions found:', subscriptions.length);
    if (subscriptions.length > 0) {
      console.log('📋 Latest subscription:', {
        id: subscriptions[0]._id,
        status: subscriptions[0].status,
        seller_id: subscriptions[0].seller_id,
        remaining_amount: subscriptions[0].remaining_amount,
        remaining_days: subscriptions[0].remaining_days
      });
    }
    
    res.json({ success: true, subscriptions });
  } catch (e) {
    console.error('❌ Error in getMySubscriptions:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getAvailablePlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({ is_active: true, is_public: true })
      .populate('assigned_seller_id', 'businessName type address description')
      .populate('allowed_categories', 'name')
      .populate('allowed_items', 'name sellingPrice description image')
      .sort({ display_order: 1, total_amount: 1 });
    res.json({ success: true, plans });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.purchase = async (req, res) => {
  try {
    console.log('🔍 Subscription purchase request received');
    console.log('📦 req.body:', req.body);
    console.log('👤 req.user:', req.user ? req.user._id : 'undefined');
    
    const { planId, sellerId, totalAmount, totalDays } = req.body;
    console.log('📋 Extracted fields:', { planId, sellerId, totalAmount, totalDays });
    
    let purchaseData = { totalAmount: Number(totalAmount), totalDays: Number(totalDays) };
    
    // If planId provided, get plan details
    if (planId) {
      const plan = await SubscriptionPlan.findById(planId);
      if (!plan || !plan.is_active) {
        return res.status(400).json({ success: false, message: 'Invalid or inactive plan' });
      }
      
      purchaseData = {
        totalAmount: plan.total_amount,
        totalDays: plan.total_days,
        planId: plan._id
      };
    }
    
    // Use user-selected seller (from frontend)
    if (sellerId) {
      purchaseData.sellerId = sellerId;
      console.log('✅ Using user-selected seller:', sellerId);
    } else {
      return res.status(400).json({ success: false, message: 'Seller selection required' });
    }
    
    console.log('🚀 Calling createSubscriptionPurchase with:', purchaseData);
    
    const subscription = await subscriptionService.createSubscriptionPurchase(req.user._id, purchaseData);
    
    console.log('✅ Subscription created successfully:', {
      id: subscription._id,
      user_id: subscription.user_id,
      seller_id: subscription.seller_id,
      status: subscription.status,
      remaining_amount: subscription.remaining_amount,
      remaining_days: subscription.remaining_days
    });
    
    // NEW WALLET SYSTEM: Process subscription payment
    try {
      console.log('💰 Processing subscription payment through wallet system');
      
      // Get plan name if available
      let planName = 'Subscription';
      if (planId) {
        const plan = await SubscriptionPlan.findById(planId);
        if (plan) planName = plan.plan_name;
      }
      
      await walletController.processSubscriptionPayment({
        subscriptionId: subscription._id,
        userId: req.user._id,
        sellerId: sellerId,
        totalAmount: purchaseData.totalAmount,
        planName: planName,
        razorpayIds: {
          orderId: req.body.razorpay_order_id,
          paymentId: req.body.razorpay_payment_id
        }
      });
      
      console.log('✅ Subscription payment processed through wallet system');
    } catch (walletError) {
      console.error('❌ Wallet processing error:', walletError);
      // Don't fail the subscription creation if wallet processing fails
      // It can be reconciled later
    }
    
    res.status(201).json({ success: true, subscription });
  } catch (e) {
    console.error('❌ Error in purchase:', e.message);
    console.error('❌ Error stack:', e.stack);
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.getUserSubscriptionHistory = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ user_id: req.user._id })
      .sort({ createdAt: -1 })
      .populate('plan_id', 'plan_name description');
    res.json({ success: true, subscriptions });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.validateForOrder = async (req, res) => {
  try {
    const { sellerId, items, orderAmount } = req.body;
    
    const subscription = await subscriptionService.getActiveSubscription(req.user._id);
    if (!subscription) {
      return res.json({ 
        success: true, 
        applicable: false, 
        reason: 'No active subscription',
        subscription: null 
      });
    }
    
    const validation = await subscriptionService.validateSubscriptionApplicability(subscription, {
      sellerId,
      items,
      orderAmount: Number(orderAmount),
      orderDate: new Date()
    });
    
    res.json({
      success: true,
      applicable: validation.applicable,
      reason: validation.reason,
      subscription: validation.applicable ? subscription : null
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Helper function to generate subscription poster
const generateSubscriptionPoster = (planData) => {
  const { createCanvas } = require('canvas');
  const { registerFont } = require('canvas');
  
  // Register a font
  registerFont('Arial', 'arial.ttf');
  
  // Dynamic canvas size
  const canvasWidth = planData.poster_width || 400;
  const canvasHeight = planData.poster_height || 600;
  
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  
  // Background
  if (planData.poster_bg_image) {
    // Load background image if provided
    const img = new Image();
    img.src = planData.poster_bg_image;
    ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
  } else {
    // Use background color
    const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    gradient.addColorStop(0, planData.poster_bg_color || '#6366f1');
    gradient.addColorStop(1, adjustColor(planData.poster_bg_color || '#6366f1', -30));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }
  
  // White content area
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.roundRect(20, 20, canvasWidth - 40, canvasHeight - 40, 20);
  ctx.fill();
  
  // Text alignment based on layout
  const layout = planData.poster_layout || 'center';
  let textAlign = 'center';
  let textX = canvasWidth / 2;
  
  if (layout === 'left') {
    textAlign = 'left';
    textX = 40;
  } else if (layout === 'right') {
    textAlign = 'right';
    textX = canvasWidth - 40;
  }
  
  ctx.textAlign = textAlign;
  
  // Draw selected fields with their customizations
  const selectedFields = planData.poster_selected_fields || [];
  selectedFields.forEach((field) => {
    if (!field.show) return;
    
    const fieldData = getFieldData(field.id, planData);
    if (!fieldData) return;
    
    drawCustomField(ctx, field, fieldData, textAlign, textX, canvasWidth, canvasHeight);
  });
  
  return canvas.toDataURL('image/png');
};

// Helper function to get field data
const getFieldData = (fieldId, planData) => {
  switch (fieldId) {
    case 'title':
      return planData.plan_name || 'Subscription Plan';
    case 'badge':
      return planData.badge;
    case 'price':
      return `₹${planData.total_amount || 0}`;
    case 'duration':
      return `${planData.total_days || 0} Days`;
    case 'perDay':
      const perDayValue = (planData.total_amount || 0) / (planData.total_days || 1);
      return `₹${perDayValue.toFixed(2)}/day`;
    case 'features':
      return planData.features;
    case 'seller':
      return planData.assigned_seller_id?.businessName 
        ? `📍 ${planData.assigned_seller_id.businessName}` 
        : null;
    case 'footer':
      return 'Dabba Delights';
    default:
      return field.isCustom ? field.text : null;
  }
};

// Helper function to draw custom field
const drawCustomField = (ctx, field, data, textAlign, defaultX, canvasWidth, canvasHeight) => {
  const x = field.x || defaultX;
  const y = field.y || 100;
  const fontSize = field.fontSize || 16;
  const color = field.color || '#1f2937';
  const bgColor = field.bgColor || 'transparent';
  const fontWeight = field.fontWeight || 'normal';

  // Draw background if not transparent
  if (bgColor !== 'transparent') {
    ctx.fillStyle = bgColor;
    ctx.font = `${fontWeight} ${fontSize}px Arial`;
    const metrics = ctx.measureText(data);
    const padding = 8;
    const bgX = textAlign === 'center' ? x - metrics.width / 2 - padding : x - padding;
    const bgY = y - fontSize - padding;
    const bgWidth = metrics.width + padding * 2;
    const bgHeight = fontSize + padding * 2;
    
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4);
    ctx.fill();
  }

  // Draw text
  ctx.fillStyle = color;
  ctx.font = `${fontWeight} ${fontSize}px Arial`;
  ctx.textAlign = textAlign;

  if (field.id === 'features' && data) {
    // Handle features list
    const features = typeof data === 'string' 
      ? data.split('\n').filter(f => f.trim())
      : data || [];

    if (features.length > 0) {
      ctx.fillText('Features:', x, y);
      ctx.font = `${fontWeight} ${fontSize * 0.8}px Arial`;
      features.slice(0, 4).forEach((feature, index) => {
        ctx.fillText(`• ${feature}`, x, y + 25 + (index * 20));
      });
    }
  } else if (data) {
    ctx.fillText(data, x, y);
  }
};

// Helper function to adjust color brightness
const adjustColor = (color, amount) => {
  const num = parseInt(color.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};

// ============= ADMIN CONTROLLERS =============

exports.adminGetAllPlans = async (req, res) => {
  try {
    const { active } = req.query;
    const filter = {};
    if (active !== undefined) filter.is_active = active === 'true';
    
    const plans = await SubscriptionPlan.find(filter)
      .sort({ display_order: 1, createdAt: -1 })
      .populate('allowed_categories', 'name')
      .populate('allowed_items', 'name sellingPrice')
      .populate('assigned_seller_id', 'businessName type address description');
    res.json({ success: true, plans });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.adminCreatePlan = async (req, res) => {
  try {
    console.log('=== CREATE PLAN DEBUG ===');
    console.log('req.body keys:', Object.keys(req.body));
    console.log('req.body:', req.body);
    console.log('req.file:', req.file);
    console.log('Content-Type:', req.get('Content-Type'));
    
    const planData = { ...req.body };
    
    // If image was uploaded to S3, add the URL
    if (req.file && req.file.s3Url) {
      planData.image = req.file.s3Url;
    }
    
    // Convert string values to numbers from FormData
    if (planData.total_amount) {
      planData.total_amount = Number(planData.total_amount);
    }
    if (planData.total_days) {
      planData.total_days = Number(planData.total_days);
    }
    if (planData.max_orders_per_day) {
      planData.max_orders_per_day = Number(planData.max_orders_per_day);
    }
    
    // Calculate per_day_value
    if (planData.total_amount && planData.total_days) {
      planData.per_day_value = planData.total_amount / planData.total_days;
    }
    
    // Parse features from string to array if needed
    if (typeof planData.features === 'string') {
      planData.features = planData.features.split('\n').filter(f => f.trim());
    }
    
    // Handle banner image if uploaded
    if (req.file && req.file.s3Url) {
      planData.banner_image = req.file.s3Url;
    }
    
    // Set plan type to home_chef by default for subscriptions
    planData.plan_type = 'home_chef';
    planData.is_available = true;
    
    console.log('Final planData:', planData);
    
    const plan = new SubscriptionPlan(planData);
    await plan.save();
    res.status(201).json({ success: true, plan });
  } catch (e) {
    console.error('Create plan error:', e);
    console.error('Error stack:', e.stack);
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.adminUpdatePlan = async (req, res) => {
  try {
    console.log('=== UPDATE PLAN DEBUG ===');
    console.log('req.body:', req.body);
    console.log('req.file:', req.file);
    
    const planData = { ...req.body };
    
    // If image was uploaded to S3, add the URL
    if (req.file && req.file.s3Url) {
      planData.image = req.file.s3Url;
    }
    
    // Convert string values to numbers from FormData
    if (planData.total_amount) {
      planData.total_amount = Number(planData.total_amount);
    }
    if (planData.total_days) {
      planData.total_days = Number(planData.total_days);
    }
    if (planData.max_orders_per_day) {
      planData.max_orders_per_day = Number(planData.max_orders_per_day);
    }
    
    // Calculate per_day_value if amount/days changed
    if (planData.total_amount && planData.total_days) {
      planData.per_day_value = planData.total_amount / planData.total_days;
    }
    
    // Parse features from string to array if needed
    if (typeof planData.features === 'string') {
      planData.features = planData.features.split('\n').filter(f => f.trim());
    }
    
    // Handle banner image if uploaded
    if (req.file && req.file.s3Url) {
      planData.banner_image = req.file.s3Url;
    }
    
    // Set plan type to home_chef by default for subscriptions
    planData.plan_type = 'home_chef';
    planData.is_available = true;
    
    console.log('Final planData:', planData);
    
    const plan = await SubscriptionPlan.findByIdAndUpdate(
      req.params.id,
      { $set: planData },
      { new: true, runValidators: true }
    );
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    res.json({ success: true, plan });
  } catch (e) {
    console.error('Update plan error:', e);
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.adminDeletePlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    res.json({ success: true, message: 'Plan deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.adminListSubscriptions = async (req, res) => {
  try {
    const { status, userId, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (userId) filter.user_id = userId;
    
    const subscriptions = await Subscription.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('user_id', 'name email phone')
      .populate('plan_id', 'plan_name')
      .populate('seller_id', 'businessName type'); // Populate seller details
      
    const total = await Subscription.countDocuments(filter);
    
    res.json({ 
      success: true, 
      subscriptions, 
      pagination: { page: Number(page), limit: Number(limit), total } 
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.adminListUsage = async (req, res) => {
  try {
    const { userId, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (userId) filter.user_id = userId;
    
    const usage = await SubscriptionUsage.find(filter)
      .sort({ date: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('user_id', 'name email')
      .populate('order_id', 'orderNumber total status');
      
    const total = await SubscriptionUsage.countDocuments(filter);
    
    res.json({ 
      success: true, 
      usage, 
      pagination: { page: Number(page), limit: Number(limit), total } 
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.adminAssignSubscription = async (req, res) => {
  const session = await mongoose.startSession({ defaultTransactionOptions: { readPreference: 'primary' } });
  try {
    session.startTransaction();
    
    const { userId, planId, totalAmount, totalDays, notes } = req.body;
    
    // Validate user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    let purchaseData = { totalAmount: Number(totalAmount), totalDays: Number(totalDays) };
    
    // If planId provided, get plan details
    if (planId) {
      const plan = await SubscriptionPlan.findById(planId).session(session);
      if (!plan) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: 'Plan not found' });
      }
      purchaseData = {
        totalAmount: plan.total_amount,
        totalDays: plan.total_days,
        planId: plan._id
      };
    }
    
    const subscription = await subscriptionService.createSubscriptionPurchase(
      userId, 
      purchaseData, 
      session
    );
    
    await session.commitTransaction();
    
    res.status(201).json({ 
      success: true, 
      subscription,
      message: notes || 'Subscription assigned successfully'
    });
  } catch (e) {
    await session.abortTransaction();
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally {
    session.endSession();
  }
};

exports.adminAdjustSubscription = async (req, res) => {
  try {
    const { addBalance, addDays, reason } = req.body;
    
    const subscription = await subscriptionService.adjustSubscription(
      req.params.id,
      { 
        addBalance: Number(addBalance) || 0, 
        addDays: Number(addDays) || 0, 
        reason 
      }
    );
    
    res.json({ 
      success: true, 
      subscription,
      message: `Subscription adjusted: +₹${addBalance || 0}, +${addDays || 0} days`
    });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.adminForceExpire = async (req, res) => {
  try {
    const { reason } = req.body;
    
    const subscription = await subscriptionService.forceExpireSubscription(
      req.params.id,
      reason
    );
    
    res.json({ 
      success: true, 
      subscription,
      message: 'Subscription force expired'
    });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.adminGetStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const stats = await Promise.all([
      // Total active subscriptions
      Subscription.countDocuments({ status: 'active' }),
      
      // Total expired subscriptions
      Subscription.countDocuments({ status: 'expired' }),
      
      // New subscriptions this month
      Subscription.countDocuments({ 
        createdAt: { $gte: startOfMonth } 
      }),
      
      // Total usage count
      SubscriptionUsage.countDocuments(),
      
      // Total amount used from subscriptions
      SubscriptionUsage.aggregate([
        { $group: { _id: null, total: { $sum: '$amount_used' } } }
      ]),
      
      // Active plans count
      SubscriptionPlan.countDocuments({ is_active: true })
    ]);
    
    res.json({
      success: true,
      stats: {
        activeSubscriptions: stats[0],
        expiredSubscriptions: stats[1],
        newThisMonth: stats[2],
        totalUsages: stats[3],
        totalAmountUsed: stats[4][0]?.total || 0,
        activePlans: stats[5]
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Get user's subscription items (food items available in their subscription)
exports.getMySubscriptionItems = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      user_id: req.user._id,
      status: 'active'
    }).populate('plan_id').populate('seller_id', 'businessName type logo address');
    
    if (!subscription) {
      return res.json({ success: true, subscription: null, items: [] });
    }
    
    // Get plan details
    const plan = await SubscriptionPlan.findById(subscription.plan_id).populate('allowed_items');
    
    // Combine regular items and custom items
    let allItems = [];
    
    // Add regular menu items
    if (plan && plan.allowed_items && plan.allowed_items.length > 0) {
      allItems = plan.allowed_items.map(item => ({
        _id: item._id,
        name: item.name,
        description: item.description,
        sellingPrice: item.sellingPrice,
        discountPrice: item.discountPrice,
        image: item.image,
        category: item.category,
        isAvailable: item.isAvailable,
        isCustom: false
      }));
    }
    
    // Add custom items from allowed_items_data
    if (plan && plan.allowed_items_data && plan.allowed_items_data.length > 0) {
      const customItems = plan.allowed_items_data.map((customItem, index) => ({
        _id: `custom-${index}`,
        name: customItem.name,
        description: 'Custom subscription item',
        sellingPrice: customItem.price,
        discountPrice: customItem.price,
        image: null,
        category: 'Custom',
        isAvailable: true,
        isCustom: true
      }));
      allItems = [...allItems, ...customItems];
    }
    
    if (allItems.length === 0) {
      return res.json({ 
        success: true, 
        subscription: {
          _id: subscription._id,
          remaining_amount: subscription.remaining_amount,
          remaining_days: subscription.remaining_days,
          per_day_value: subscription.per_day_value,
          seller: subscription.seller_id
        },
        items: [] 
      });
    }
    
    res.json({
      success: true,
      subscription: {
        _id: subscription._id,
        remaining_amount: subscription.remaining_amount,
        remaining_days: subscription.remaining_days,
        per_day_value: subscription.per_day_value,
        seller: subscription.seller_id
      },
      items: allItems
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Place order directly from subscription items
exports.placeOrderFromSubscription = async (req, res) => {
  const session = await mongoose.startSession({ defaultTransactionOptions: { readPreference: 'primary' } });
  try {
    session.startTransaction();
    
    const { items, deliveryAddress } = req.body;
    
    // Get user's active subscription
    const subscription = await Subscription.findOne({
      user_id: req.user._id,
      status: 'active'
    }).session(session).populate('seller_id');
    
    if (!subscription) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'No active subscription found' });
    }
    
    // Calculate order total
    const orderTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    // Check if subscription has enough balance
    if (subscription.remaining_amount < orderTotal) {
      await session.abortTransaction();
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient subscription balance. Available: ₹${subscription.remaining_amount}, Required: ₹${orderTotal}` 
      });
    }
    
    // Calculate days to deduct
    const perDayValue = subscription.per_day_value || (subscription.total_amount / subscription.total_days);
    const daysToDeduct = Math.ceil(orderTotal / perDayValue);
    
    // Create order
    const order = new Order({
      userId: req.user._id,
      sellerId: subscription.seller_id._id,
      items: items.map(item => ({
        menuItemId: item.menuItemId,
        name: item.name,
        sellingPrice: item.price,
        quantity: item.quantity,
        image: item.image
      })),
      deliveryAddress,
      paymentMethod: 'subscription',
      totalAmount: orderTotal,
      subtotal: orderTotal,
      gstAmount: 0,
      deliveryFee: 0,
      platformFee: 0,
      discount: 0,
      subscriptionCredit: orderTotal,
      orderStatus: 'pending',
      paymentStatus: 'paid'
    });
    
    await order.save({ session });
    
    // Update subscription
    subscription.remaining_amount -= orderTotal;
    subscription.remaining_days -= daysToDeduct;
    
    if (subscription.remaining_amount <= 0 || subscription.remaining_days <= 0) {
      subscription.status = 'expired';
    }
    
    await subscription.save({ session });
    
    // Record subscription usage
    await SubscriptionUsage.create([{
      user_id: req.user._id,
      subscription_id: subscription._id,
      order_id: order._id,
      amount_used: orderTotal,
      days_used: daysToDeduct,
      date: new Date()
    }], { session });
    
    // Credit admin wallet
    const adminUser = await User.findOne({ role: 'admin' }).session(session);
    if (adminUser) {
      await User.findByIdAndUpdate(
        adminUser._id,
        { $inc: { wallet: orderTotal } },
        { session }
      );
      
      await WalletTransaction.create([{
        userId: adminUser._id,
        type: 'credit',
        amount: orderTotal,
        description: `Subscription order #${order.orderNumber}`,
        referenceType: 'order',
        referenceId: order._id.toString(),
        balance: (adminUser.wallet || 0) + orderTotal
      }], { session });
    }
    
    await session.commitTransaction();
    
    res.json({
      success: true,
      order: order,
      message: `Order placed! ₹${orderTotal} deducted from subscription. ${daysToDeduct} days used.`,
      subscription: {
        remaining_amount: subscription.remaining_amount,
        remaining_days: subscription.remaining_days
      }
    });
    
  } catch (e) {
    await session.abortTransaction();
    res.status(500).json({ success: false, message: e.message });
  } finally {
    session.endSession();
  }
};
