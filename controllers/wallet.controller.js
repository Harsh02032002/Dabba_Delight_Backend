const AdminWallet = require('../models/AdminWallet');
const SellerWallet = require('../models/SellerWallet');
const AdminWalletTransaction = require('../models/AdminWalletTransaction');
const WalletTransaction = require('../models/WalletTransaction');
const Seller = require('../models/Seller');
const Order = require('../models/Order');
const Subscription = require('../models/Subscription');
const GSTSettings = require('../models/GSTSettings');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ============= ADMIN WALLET FUNCTIONS =============

// Get commission rate from GST settings
exports.getCommissionRate = async () => {
  try {
    const settings = await GSTSettings.getCurrentSettings();
    return settings?.platformCommissionRate || 15; // Default 15% if not set
  } catch (error) {
    console.error('❌ Error fetching commission rate:', error);
    return 15; // Fallback
  }
};

// Initialize admin wallet if not exists
exports.initializeAdminWallet = async () => {
  try {
    const commissionRate = await exports.getCommissionRate();
    let wallet = await AdminWallet.findOne({ wallet_id: 'main' });
    if (!wallet) {
      wallet = new AdminWallet({
        wallet_id: 'main',
        total_balance: 0,
        commission_percentage: commissionRate
      });
      await wallet.save();
      console.log('✅ Admin wallet initialized with commission:', commissionRate + '%');
    }
    return wallet;
  } catch (error) {
    console.error('❌ Error initializing admin wallet:', error);
    throw error;
  }
};

// Process order payment and distribute funds
exports.processOrderPayment = async (orderData) => {
  const session = await mongoose.startSession({ defaultTransactionOptions: { readPreference: 'primary' } });
  session.startTransaction();
  
  try {
    const { orderId, userId, sellerId, totalAmount, paymentMethod, razorpayIds } = orderData;
    
    // Get admin wallet
    let adminWallet = await AdminWallet.findOne({ wallet_id: 'main' }).session(session);
    if (!adminWallet) {
      adminWallet = await exports.initializeAdminWallet();
    }
    
    // Get commission rate from GST settings (dynamic)
    const commissionRatePercent = await exports.getCommissionRate();
    const commissionRate = commissionRatePercent / 100;
    const adminCommission = Math.round(totalAmount * commissionRate * 100) / 100;
    const sellerAmount = totalAmount - adminCommission;
    
    // Update admin wallet commission percentage
    adminWallet.commission_percentage = commissionRatePercent;
    
    // Get or create seller wallet
    let sellerWallet = await SellerWallet.findOne({ seller_id: sellerId }).session(session);
    if (!sellerWallet) {
      const seller = await Seller.findById(sellerId).session(session);
      sellerWallet = new SellerWallet({
        seller_id: sellerId,
        bank_account_number: seller?.bankDetails?.accountNumber,
        bank_ifsc_code: seller?.bankDetails?.ifscCode,
        bank_account_holder: seller?.bankDetails?.accountHolderName
      });
    }
    
    // Update admin wallet
    adminWallet.total_balance += totalAmount;
    adminWallet.total_earnings += totalAmount;
    adminWallet.stats.total_orders += 1;
    adminWallet.stats.total_order_amount += totalAmount;
    adminWallet.stats.total_commission_earned += adminCommission;
    await adminWallet.save({ session });
    
    // Update seller wallet
    sellerWallet.total_earnings += sellerAmount;
    sellerWallet.pending_payout += sellerAmount;
    await sellerWallet.save({ session });
    
    // Create admin transaction
    const adminTransaction = new AdminWalletTransaction({
      type: 'order_payment',
      amount: totalAmount,
      admin_commission: adminCommission,
      seller_amount: sellerAmount,
      order_id: orderId,
      user_id: userId,
      seller_id: sellerId,
      seller_wallet_id: sellerWallet._id,
      description: `Order payment - Admin: ₹${adminCommission}, Seller: ₹${sellerAmount}`,
      payment_method: paymentMethod,
      razorpay_order_id: razorpayIds?.orderId,
      razorpay_payment_id: razorpayIds?.paymentId,
      balance_after: adminWallet.total_balance,
      status: 'completed',
      metadata: {
        order_number: orderData.orderNumber,
        items_count: orderData.itemsCount,
        commission_rate: adminWallet.commission_percentage
      }
    });
    await adminTransaction.save({ session });
    
    // Update monthly stats
    await updateMonthlyStats(adminWallet, 'order', totalAmount, adminCommission, session);
    
    await session.commitTransaction();
    
    console.log('✅ Order payment processed:', {
      orderId,
      total: totalAmount,
      commission: adminCommission,
      sellerAmount: sellerAmount
    });
    
    return {
      success: true,
      adminCommission,
      sellerAmount,
      adminBalance: adminWallet.total_balance
    };
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Error processing order payment:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

// Process subscription payment
exports.processSubscriptionPayment = async (subscriptionData) => {
  const session = await mongoose.startSession({ defaultTransactionOptions: { readPreference: 'primary' } });
  session.startTransaction();
  
  try {
    const { subscriptionId, userId, sellerId, totalAmount, planName, razorpayIds } = subscriptionData;
    
    // Get admin wallet
    let adminWallet = await AdminWallet.findOne({ wallet_id: 'main' }).session(session);
    if (!adminWallet) {
      adminWallet = await exports.initializeAdminWallet();
    }
    
    // Get commission rate from GST settings (dynamic)
    const commissionRatePercent = await exports.getCommissionRate();
    const commissionRate = commissionRatePercent / 100;
    const adminCommission = Math.round(totalAmount * commissionRate * 100) / 100;
    const sellerAmount = totalAmount - adminCommission;
    
    // Update admin wallet commission percentage
    adminWallet.commission_percentage = commissionRatePercent;
    
    // Get or create seller wallet
    let sellerWallet = await SellerWallet.findOne({ seller_id: sellerId }).session(session);
    if (!sellerWallet) {
      const seller = await Seller.findById(sellerId).session(session);
      sellerWallet = new SellerWallet({
        seller_id: sellerId,
        bank_account_number: seller?.bankDetails?.accountNumber,
        bank_ifsc_code: seller?.bankDetails?.ifscCode,
        bank_account_holder: seller?.bankDetails?.accountHolderName
      });
    }
    
    // Update admin wallet
    adminWallet.total_balance += totalAmount;
    adminWallet.total_earnings += totalAmount;
    adminWallet.stats.total_subscriptions += 1;
    adminWallet.stats.total_subscription_amount += totalAmount;
    adminWallet.stats.total_commission_earned += adminCommission;
    await adminWallet.save({ session });
    
    // Update seller wallet
    sellerWallet.total_earnings += sellerAmount;
    sellerWallet.pending_payout += sellerAmount;
    await sellerWallet.save({ session });
    
    // Create admin transaction
    const adminTransaction = new AdminWalletTransaction({
      type: 'subscription_payment',
      amount: totalAmount,
      admin_commission: adminCommission,
      seller_amount: sellerAmount,
      subscription_id: subscriptionId,
      user_id: userId,
      seller_id: sellerId,
      seller_wallet_id: sellerWallet._id,
      description: `Subscription: ${planName} - Admin: ₹${adminCommission}, Seller: ₹${sellerAmount}`,
      payment_method: 'razorpay',
      razorpay_order_id: razorpayIds?.orderId,
      razorpay_payment_id: razorpayIds?.paymentId,
      balance_after: adminWallet.total_balance,
      status: 'completed',
      metadata: {
        subscription_plan: planName,
        commission_rate: adminWallet.commission_percentage
      }
    });
    await adminTransaction.save({ session });
    
    // Update monthly stats
    await updateMonthlyStats(adminWallet, 'subscription', totalAmount, adminCommission, session);
    
    await session.commitTransaction();
    
    console.log('✅ Subscription payment processed:', {
      subscriptionId,
      total: totalAmount,
      commission: adminCommission,
      sellerAmount: sellerAmount
    });
    
    return {
      success: true,
      adminCommission,
      sellerAmount,
      adminBalance: adminWallet.total_balance
    };
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Error processing subscription payment:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

// Helper function to update monthly stats
async function updateMonthlyStats(adminWallet, type, amount, commission, session) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  let monthStat = adminWallet.monthly_stats.find(m => m.month === monthKey);
  
  if (!monthStat) {
    monthStat = {
      month: monthKey,
      year: now.getFullYear(),
      month_num: now.getMonth() + 1,
      order_income: 0,
      subscription_income: 0,
      total_income: 0,
      seller_payouts: 0,
      commission_earned: 0,
      order_count: 0,
      subscription_count: 0
    };
    adminWallet.monthly_stats.push(monthStat);
  }
  
  if (type === 'order') {
    monthStat.order_income += amount;
    monthStat.order_count += 1;
  } else {
    monthStat.subscription_income += amount;
    monthStat.subscription_count += 1;
  }
  
  monthStat.total_income += amount;
  monthStat.commission_earned += commission;
  
  await adminWallet.save({ session });
}

// ============= PAYOUT FUNCTIONS =============

// Create Razorpay contact for seller
exports.createSellerContact = async (sellerId) => {
  try {
    const seller = await Seller.findById(sellerId);
    if (!seller) throw new Error('Seller not found');
    
    let sellerWallet = await SellerWallet.findOne({ seller_id: sellerId });
    if (!sellerWallet) {
      sellerWallet = new SellerWallet({
        seller_id: sellerId,
        bank_account_number: seller?.bankDetails?.accountNumber,
        bank_ifsc_code: seller?.bankDetails?.ifscCode,
        bank_account_holder: seller?.bankDetails?.accountHolderName
      });
    }
    
    // Create contact in Razorpay
    const contact = await razorpay.contacts.create({
      name: seller.businessName || seller.name,
      email: seller.email,
      contact: seller.phone,
      type: 'vendor',
      reference_id: sellerId.toString()
    });
    
    sellerWallet.razorpay_contact_id = contact.id;
    
    // Create fund account (bank account)
    if (seller.bankDetails?.accountNumber && seller.bankDetails?.ifscCode) {
      const fundAccount = await razorpay.fundAccount.create({
        contact_id: contact.id,
        account_type: 'bank_account',
        bank_account: {
          name: seller.bankDetails.accountHolderName || seller.businessName,
          ifsc: seller.bankDetails.ifscCode,
          account_number: seller.bankDetails.accountNumber
        }
      });
      
      sellerWallet.razorpay_fund_account_id = fundAccount.id;
    }
    
    await sellerWallet.save();
    
    return {
      success: true,
      contactId: contact.id,
      fundAccountId: sellerWallet.razorpay_fund_account_id
    };
    
  } catch (error) {
    console.error('❌ Error creating seller contact:', error);
    throw error;
  }
};

// Payout to single seller
exports.payoutToSeller = async (sellerId, amount, notes = '') => {
  const session = await mongoose.startSession({ defaultTransactionOptions: { readPreference: 'primary' } });
  session.startTransaction();
  
  try {
    const sellerWallet = await SellerWallet.findOne({ seller_id: sellerId }).session(session);
    if (!sellerWallet) throw new Error('Seller wallet not found');
    
    if (sellerWallet.pending_payout < amount) {
      throw new Error('Insufficient pending payout balance');
    }
    
    // Ensure contact exists
    if (!sellerWallet.razorpay_contact_id || !sellerWallet.razorpay_fund_account_id) {
      await exports.createSellerContact(sellerId);
    }
    
    // Create payout in Razorpay
    const payout = await razorpay.payouts.create({
      account_number: process.env.RAZORPAY_VIRTUAL_ACCOUNT,
      fund_account_id: sellerWallet.razorpay_fund_account_id,
      amount: Math.round(amount * 100), // Convert to paise
      currency: 'INR',
      mode: 'IMPS',
      purpose: 'payout',
      notes: {
        seller_id: sellerId.toString(),
        description: notes || `Payout to ${sellerWallet.bank_account_holder}`
      }
    });
    
    // Update seller wallet
    sellerWallet.pending_payout -= amount;
    sellerWallet.paid_out += amount;
    sellerWallet.payouts.push({
      payout_id: payout.id,
      amount: amount,
      status: 'processing',
      method: 'bank_transfer',
      created_at: new Date()
    });
    await sellerWallet.save({ session });
    
    // Update admin wallet
    const adminWallet = await AdminWallet.findOne({ wallet_id: 'main' }).session(session);
    adminWallet.total_balance -= amount;
    adminWallet.total_paid_to_sellers += amount;
    await adminWallet.save({ session });
    
    // Create transaction record
    const adminTransaction = new AdminWalletTransaction({
      type: 'seller_payout',
      amount: -amount,
      seller_id: sellerId,
      seller_wallet_id: sellerWallet._id,
      description: `Payout to seller: ₹${amount} - ${notes}`,
      payment_method: 'bank_transfer',
      razorpay_payout_id: payout.id,
      balance_after: adminWallet.total_balance,
      status: 'completed',
      payout_details: {
        bank_account: sellerWallet.bank_account_number,
        ifsc_code: sellerWallet.bank_ifsc_code
      }
    });
    await adminTransaction.save({ session });
    
    await session.commitTransaction();
    
    return {
      success: true,
      payoutId: payout.id,
      amount: amount,
      status: payout.status
    };
    
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Error processing payout:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

// Bulk payout to multiple sellers
exports.bulkPayout = async (payouts) => {
  const results = [];
  const failed = [];
  
  for (const payout of payouts) {
    try {
      const result = await exports.payoutToSeller(
        payout.sellerId,
        payout.amount,
        payout.notes
      );
      results.push(result);
    } catch (error) {
      failed.push({
        sellerId: payout.sellerId,
        amount: payout.amount,
        error: error.message
      });
    }
  }
  
  return {
    success: true,
    processed: results.length,
    failed: failed.length,
    results,
    failed
  };
};

// ============= CONTROLLER FUNCTIONS FOR ROUTES =============

// Get admin wallet stats
exports.getAdminWalletStats = async (req, res) => {
  try {
    let adminWallet = await AdminWallet.findOne({ wallet_id: 'main' });
    if (!adminWallet) {
      adminWallet = await exports.initializeAdminWallet();
    }
    
    // Get commission rate from GST settings
    const commissionRate = await exports.getCommissionRate();
    adminWallet.commission_percentage = commissionRate;
    await adminWallet.save();
    
    // Get ALL transactions for detailed stats
    const allTransactions = await AdminWalletTransaction.find()
      .sort({ createdAt: -1 })
      .populate('seller_id', 'businessName type')
      .populate('user_id', 'name email phone')
      .populate('order_id', 'orderNumber total')
      .populate('subscription_id', 'plan_name total_amount');
    
    // Calculate 4 main stats
    const totalReceived = allTransactions
      .filter(t => t.type === 'order_payment' || t.type === 'subscription_payment')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    const totalCommission = allTransactions
      .filter(t => t.type === 'order_payment' || t.type === 'subscription_payment')
      .reduce((sum, t) => sum + (t.admin_commission || 0), 0);
    
    const totalToPaySellers = allTransactions
      .filter(t => t.type === 'order_payment' || t.type === 'subscription_payment')
      .reduce((sum, t) => sum + (t.seller_amount || 0), 0) - 
      allTransactions
        .filter(t => t.type === 'seller_payout')
        .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    
    const alreadyPaidToSellers = allTransactions
      .filter(t => t.type === 'seller_payout')
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    
    // Group by user - who paid what
    const userPayments = {};
    allTransactions.forEach(t => {
      if ((t.type === 'order_payment' || t.type === 'subscription_payment') && t.user_id) {
        const userId = t.user_id._id?.toString() || t.user_id.toString();
        if (!userPayments[userId]) {
          userPayments[userId] = {
            user: t.user_id,
            total_paid: 0,
            from_orders: 0,
            from_subscriptions: 0,
            orders: [],
            subscriptions: []
          };
        }
        userPayments[userId].total_paid += t.amount || 0;
        if (t.type === 'order_payment') {
          userPayments[userId].from_orders += t.amount || 0;
          userPayments[userId].orders.push({
            order_id: t.order_id?._id,
            order_number: t.order_id?.orderNumber,
            amount: t.amount,
            seller: t.seller_id?.businessName,
            created_at: t.createdAt
          });
        } else {
          userPayments[userId].from_subscriptions += t.amount || 0;
          userPayments[userId].subscriptions.push({
            subscription_id: t.subscription_id?._id,
            plan_name: t.subscription_id?.plan_name || t.metadata?.subscription_plan,
            amount: t.amount,
            seller: t.seller_id?.businessName,
            created_at: t.createdAt
          });
        }
      }
    });
    
    // Get seller wallets summary with pending amounts
    const sellerWallets = await SellerWallet.find()
      .populate('seller_id', 'businessName type email phone bankDetails')
      .sort({ pending_payout: -1 });
    
    // Recent transactions (last 50)
    const recentTransactions = allTransactions.slice(0, 50);
    
    res.json({
      success: true,
      stats: {
        // 4 Main Stats
        total_received: totalReceived,
        total_to_pay_sellers: totalToPaySellers,
        admin_commission_earned: totalCommission,
        already_paid_to_sellers: alreadyPaidToSellers,
        // Breakdown
        from_orders: adminWallet.stats.total_order_amount || 0,
        from_subscriptions: adminWallet.stats.total_subscription_amount || 0,
        total_orders: adminWallet.stats.total_orders || 0,
        total_subscriptions: adminWallet.stats.total_subscriptions || 0,
        commission_rate: commissionRate
      },
      wallet: {
        total_balance: adminWallet.total_balance,
        total_earnings: adminWallet.total_earnings,
        total_paid_to_sellers: adminWallet.total_paid_to_sellers,
        commission_percentage: commissionRate,
        stats: adminWallet.stats,
        monthly_stats: adminWallet.monthly_stats.slice(-6)
      },
      user_payments: Object.values(userPayments),
      recentTransactions,
      sellerWallets: sellerWallets.map(sw => ({
        seller_id: sw.seller_id?._id,
        seller_name: sw.seller_id?.businessName,
        seller_type: sw.seller_id?.type,
        email: sw.seller_id?.email,
        phone: sw.seller_id?.phone,
        total_earnings: sw.total_earnings,
        pending_payout: sw.pending_payout,
        paid_out: sw.paid_out,
        bank_details: sw.seller_id?.bankDetails || {
          accountNumber: sw.bank_account_number,
          ifscCode: sw.bank_ifsc_code,
          accountHolderName: sw.bank_account_holder
        }
      }))
    });
    
  } catch (error) {
    console.error('❌ Error getting admin wallet stats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get seller wallet details
exports.getSellerWallet = async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    let sellerWallet = await SellerWallet.findOne({ seller_id: sellerId })
      .populate('seller_id', 'businessName email phone bankDetails type');
    
    if (!sellerWallet) {
      // Create wallet if not exists
      const seller = await Seller.findById(sellerId);
      if (!seller) {
        return res.status(404).json({ success: false, message: 'Seller not found' });
      }
      
      sellerWallet = new SellerWallet({
        seller_id: sellerId,
        bank_account_number: seller?.bankDetails?.accountNumber,
        bank_ifsc_code: seller?.bankDetails?.ifscCode,
        bank_account_holder: seller?.bankDetails?.accountHolderName
      });
      await sellerWallet.save();
      
      // Populate after save
      sellerWallet = await SellerWallet.findOne({ seller_id: sellerId })
        .populate('seller_id', 'businessName email phone bankDetails type');
    }
    
    // Get transaction history with populated user data
    const transactions = await AdminWalletTransaction.find({ seller_id: sellerId })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('user_id', 'name phone email')
      .populate('order_id', 'orderNumber total')
      .populate('subscription_id', 'plan_name total_amount');
    
    // Calculate stats by type
    const orderTransactions = transactions.filter(t => t.type === 'order_payment');
    const subscriptionTransactions = transactions.filter(t => t.type === 'subscription_payment');
    const payoutTransactions = transactions.filter(t => t.type === 'seller_payout');
    
    const fromOrders = orderTransactions.reduce((sum, t) => sum + (t.seller_amount || 0), 0);
    const fromSubscriptions = subscriptionTransactions.reduce((sum, t) => sum + (t.seller_amount || 0), 0);
    const totalPaidOut = payoutTransactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    
    // Group by user - who paid this seller
    const userPayments = {};
    transactions.forEach(t => {
      if ((t.type === 'order_payment' || t.type === 'subscription_payment') && t.user_id) {
        const userId = t.user_id._id?.toString() || t.user_id.toString();
        if (!userPayments[userId]) {
          userPayments[userId] = {
            user: t.user_id,
            total_paid: 0,
            orders: [],
            subscriptions: []
          };
        }
        userPayments[userId].total_paid += t.seller_amount || 0;
        if (t.type === 'order_payment') {
          userPayments[userId].orders.push({
            order_id: t.order_id?._id,
            order_number: t.order_id?.orderNumber,
            amount: t.seller_amount,
            date: t.createdAt
          });
        } else {
          userPayments[userId].subscriptions.push({
            subscription_id: t.subscription_id?._id,
            plan_name: t.metadata?.subscription_plan || 'Subscription',
            amount: t.seller_amount,
            date: t.createdAt
          });
        }
      }
    });
    
    res.json({
      success: true,
      wallet: {
        seller_id: sellerWallet.seller_id?._id,
        seller_name: sellerWallet.seller_id?.businessName,
        seller_type: sellerWallet.seller_id?.type,
        total_earnings: sellerWallet.total_earnings,
        pending_payout: sellerWallet.pending_payout,
        paid_out: sellerWallet.paid_out || totalPaidOut,
        bank_details: {
          account_holder: sellerWallet.bank_account_holder || sellerWallet.seller_id?.bankDetails?.accountHolderName,
          account_number: sellerWallet.bank_account_number || sellerWallet.seller_id?.bankDetails?.accountNumber,
          ifsc_code: sellerWallet.bank_ifsc_code || sellerWallet.seller_id?.bankDetails?.ifscCode
        },
        payouts: sellerWallet.payouts?.slice(-10) || []
      },
      stats: {
        total_orders: orderTransactions.length,
        total_subscriptions: subscriptionTransactions.length,
        from_orders: fromOrders,
        from_subscriptions: fromSubscriptions,
        total_paid_out: totalPaidOut
      },
      transactions,
      user_payments: Object.values(userPayments)
    });
    
  } catch (error) {
    console.error('❌ Error getting seller wallet:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Trigger payout to seller (admin only)
exports.triggerPayout = async (req, res) => {
  try {
    const { sellerId, amount, notes } = req.body;
    
    const result = await exports.payoutToSeller(sellerId, amount, notes);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error triggering payout:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Trigger bulk payout (admin only)
exports.triggerBulkPayout = async (req, res) => {
  try {
    const { payouts } = req.body;
    
    const result = await exports.bulkPayout(payouts);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error triggering bulk payout:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get financial reports
exports.getFinancialReports = async (req, res) => {
  try {
    const { startDate, endDate, type } = req.query;
    
    const query = {};
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (type) {
      query.type = type;
    }
    
    const transactions = await AdminWalletTransaction.find(query)
      .sort({ createdAt: -1 })
      .populate('seller_id', 'businessName')
      .populate('user_id', 'name')
      .populate('order_id', 'orderNumber')
      .populate('subscription_id', 'plan_name');
    
    // Calculate summary
    const summary = {
      total_income: 0,
      total_commission: 0,
      total_seller_payouts: 0,
      total_orders: 0,
      total_subscriptions: 0
    };
    
    transactions.forEach(t => {
      if (t.type === 'order_payment' || t.type === 'subscription_payment') {
        summary.total_income += t.amount;
        summary.total_commission += t.admin_commission;
        if (t.type === 'order_payment') summary.total_orders++;
        if (t.type === 'subscription_payment') summary.total_subscriptions++;
      } else if (t.type === 'seller_payout') {
        summary.total_seller_payouts += Math.abs(t.amount);
      }
    });
    
    res.json({
      success: true,
      summary,
      transactions,
      count: transactions.length
    });
    
  } catch (error) {
    console.error('❌ Error getting financial reports:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
