/**
 * Auto-Accept Orders Script for Deepak Restaurant
 *
 * Usage:
 *   1. Accept all pending orders once:
 *      node scripts/accept-orders.js
 *
 *   2. Continuously watch & auto-accept any incoming orders every 5 seconds:
 *      node scripts/accept-orders.js --watch
 *
 *   3. Run via Live API (login + accept via HTTP):
 *      node scripts/accept-orders.js --api
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const isWatch = args.includes('--watch') || args.includes('-w');
const isApiMode = args.includes('--api');

const DEEPAK_EMAIL = process.env.DEEPAK_EMAIL || 'deepak.deoria@gmail.com';
const DEEPAK_PASSWORD = process.env.DEEPAK_PASSWORD || 'password123';
const BACKEND_URL = process.env.BACKEND_URL || 'https://dabbanation.in';

async function acceptViaApi() {
  console.log(`🌐 [API Mode] Logging into ${BACKEND_URL} as ${DEEPAK_EMAIL}...`);
  const https = require('https');
  const http = require('http');

  function request(url, options, postData) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      req.end();
    });
  }

  // 1. Login
  const loginRes = await request(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { email: DEEPAK_EMAIL, password: DEEPAK_PASSWORD, role: 'seller' });

  if (!loginRes.data?.token) {
    console.error('❌ Login failed:', loginRes.data?.message || loginRes.raw);
    return;
  }

  const token = loginRes.data.token;
  console.log(`✅ Logged in successfully! Seller ID: ${loginRes.data?.user?.sellerId || 'OK'}`);

  // 2. Fetch pending orders
  const ordersRes = await request(`${BACKEND_URL}/api/seller/orders`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const orders = ordersRes.data?.orders || ordersRes.data || [];
  const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'placed');

  console.log(`📋 Found ${pendingOrders.length} pending order(s) waiting for acceptance.`);

  for (const ord of pendingOrders) {
    console.log(`⏳ Accepting Order #${ord.orderNumber || ord._id} (₹${ord.total})...`);
    const acceptRes = await request(`${BACKEND_URL}/api/seller/orders/${ord._id}/status`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, { status: 'confirmed' });

    if (acceptRes.status === 200 && acceptRes.data?.success) {
      console.log(`✅ Successfully accepted Order #${ord.orderNumber || ord._id}!`);
    } else {
      console.warn(`⚠️ Could not accept Order #${ord.orderNumber}:`, acceptRes.data?.message || acceptRes.raw);
    }
  }

  console.log('✨ All pending orders processed via API.');
}

async function acceptViaDirectDB() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB.');

  const User = require('../models/User');
  const Seller = require('../models/Seller');
  const Order = require('../models/Order');
  const { sendOrderToRiders } = require('../services/delivery-assignment.service');

  // Find Deepak Seller Account
  const deepakUser = await User.findOne({
    $or: [
      { email: 'deepak.deoria@gmail.com' },
      { email: 'ravistartek@gmail.com' },
      { phone: { $in: ['9876543219', '+919876543219', '7054171169'] } }
    ]
  });

  if (!deepakUser) {
    console.error('❌ Could not find Deepak user account in database.');
    return;
  }

  // Find associated Seller record
  const deepakSeller = await Seller.findOne({
    $or: [
      { userId: deepakUser._id },
      { email: deepakUser.email },
      { restaurantName: { $regex: 'deepak', $options: 'i' } }
    ]
  });

  const sellerId = deepakSeller?._id;
  const restaurantName = deepakSeller?.restaurantName || deepakSeller?.businessName || 'Deepak Non veg store';

  console.log(`🏪 Target Restaurant: "${restaurantName}" (Seller ID: ${sellerId || deepakUser._id})`);

  async function processPendingOrders() {
    const query = {
      status: { $in: ['pending', 'placed'] },
    };
    if (sellerId) {
      query.sellerId = sellerId;
    }

    const pendingOrders = await Order.find(query).populate('userId', 'name phone email');

    if (pendingOrders.length === 0) {
      if (!isWatch) {
        console.log(`ℹ️ No pending orders found for "${restaurantName}". All orders are already accepted!`);
      }
      return;
    }

    console.log(`🔔 Found ${pendingOrders.length} pending order(s) to accept!`);

    for (const order of pendingOrders) {
      const now = new Date();
      order.status = 'confirmed';
      if (!order.statusHistory) order.statusHistory = [];
      order.statusHistory.push({
        status: 'confirmed',
        timestamp: now,
        updatedBy: deepakUser._id,
        note: 'Auto-accepted by Deepak restaurant script',
      });

      await order.save();
      console.log(`✅ Accepted Order #${order.orderNumber} (₹${order.total}) for customer ${order.userId?.name || 'Customer'}`);

      // Dispatch to nearby delivery riders
      try {
        const dispatch = await sendOrderToRiders(order._id, null);
        console.log(`   🛵 Rider dispatch: ${dispatch.message || `${dispatch.notified || 0} notified`}`);
      } catch (dispErr) {
        console.warn(`   ⚠️ Rider dispatch warning: ${dispErr.message}`);
      }
    }
  }

  if (isWatch) {
    console.log(`👀 Watching for new orders for "${restaurantName}" every 5 seconds... (Press Ctrl+C to stop)`);
    await processPendingOrders();
    setInterval(async () => {
      try {
        await processPendingOrders();
      } catch (err) {
        console.error('Watch loop error:', err.message);
      }
    }, 5000);
  } else {
    await processPendingOrders();
    console.log('🎉 Done accepting all pending orders.');
    process.exit(0);
  }
}

// Main execution
(async () => {
  try {
    if (isApiMode) {
      await acceptViaApi();
      if (isWatch) {
        console.log('👀 Watching via API every 5 seconds...');
        setInterval(acceptViaApi, 5000);
      }
    } else {
      await acceptViaDirectDB();
    }
  } catch (err) {
    console.error('❌ Script execution error:', err);
    process.exit(1);
  }
})();
