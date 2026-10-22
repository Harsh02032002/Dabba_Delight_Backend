/**
 * Complete End-to-End Business Flow Test Script:
 * 1. Customer Registration & Verification
 * 2. Seller Registration, Verification & Approval
 * 3. Menu Item Creation
 * 4. Customer Nearby Discovery & Order Placement
 * 5. Rider Registration, Verification & GPS Assignment
 * 6. Rider Order Acceptance
 * 7. Rider Progression (Arrived -> Picked Up)
 * 8. Rider "Delivered" Button Trigger -> OTP Sent to Customer Email
 * 9. Rider OTP Confirmation
 * 10. Order Marked Delivered & Rider Wallet Credited
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

const http = require('http');
const mongoose = require('mongoose');
const assert = require('assert');

const connectDB = require('../config/db');
const User = require('../models/User');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { DeliveryPartner } = require('../models/Others');

let serverInstance;
let PORT = 5055;
let BASE_URL = `http://127.0.0.1:${PORT}`;

async function request(method, path, body = null, token = null) {
  const url = new URL(path, BASE_URL);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = { raw: data }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('\n========================================================');
  console.log('🚀 STARTING DABBA NATION FULL E2E LIFECYCLE TEST');
  console.log('========================================================\n');

  await connectDB();

  // Start internal express server for HTTP testing
  process.env.PORT = PORT;
  const app = require('../server'); // Express app instance
  
  // Wait brief moment for routes and socket to attach
  await new Promise(r => setTimeout(r, 1000));

  const ts = Date.now();
  const testIds = { users: [], sellers: [], products: [], orders: [], partners: [] };

  try {
    // ── STEP 1: Customer Registration ──
    console.log('▶ STEP 1: Registering new Customer...');
    const customerEmail = `e2e_cust_${ts}@test.com`;
    const regRes = await request('POST', '/api/auth/register', {
      name: 'Rohan Sharma',
      email: customerEmail,
      phone: `98${String(ts).slice(-8)}`,
      password: 'Password@123',
      role: 'user',
    });
    assert.strictEqual(regRes.status, 201, `Customer reg failed: ${JSON.stringify(regRes.body)}`);
    const customerUser = await User.findOne({ email: customerEmail });
    assert.ok(customerUser, 'Customer user not found in DB');
    testIds.users.push(customerUser._id);

    // Verify Customer Email with generated code
    console.log('  → Verifying Customer Email with OTP:', customerUser.emailVerificationCode);
    const verRes = await request('POST', '/api/auth/verify-email', {
      email: customerEmail,
      code: customerUser.emailVerificationCode,
    });
    assert.strictEqual(verRes.status, 200, `Customer verify failed: ${JSON.stringify(verRes.body)}`);

    // Customer Login
    const custLogin = await request('POST', '/api/auth/login', {
      email: customerEmail,
      password: 'Password@123',
      role: 'user',
    });
    assert.strictEqual(custLogin.status, 200, 'Customer login failed');
    const customerToken = custLogin.body.token;
    console.log('  ✔ Customer registered & logged in successfully.\n');


    // ── STEP 2: Seller Registration & Verification ──
    console.log('▶ STEP 2: Registering new Seller (Home Chef)...');
    const sellerEmail = `e2e_chef_${ts}@test.com`;
    const sellerPhone = `97${String(ts).slice(-8)}`;
    const sellerReg = await request('POST', '/api/auth/register', {
      name: 'Sunita Rasoi',
      email: sellerEmail,
      phone: sellerPhone,
      password: 'Password@123',
      role: 'seller',
      businessName: 'Sunita Pure Veg Kitchen',
      type: 'home_chef',
      address: 'House 102, Sector 22-B, Chandigarh',
    });
    assert.strictEqual(sellerReg.status, 201, `Seller reg failed: ${JSON.stringify(sellerReg.body)}`);
    const sellerUser = await User.findOne({ email: sellerEmail });
    assert.ok(sellerUser, 'Seller user not found in DB');
    testIds.users.push(sellerUser._id);

    // Verify Seller Email
    await request('POST', '/api/auth/verify-email', {
      email: sellerEmail,
      code: sellerUser.emailVerificationCode,
    });

    // Seller Login
    const sellerLogin = await request('POST', '/api/auth/login', {
      email: sellerEmail,
      password: 'Password@123',
      role: 'seller',
    });
    assert.strictEqual(sellerLogin.status, 200, 'Seller login failed');
    const sellerToken = sellerLogin.body.token;

    // Approve Seller & set coordinates in Sector 22, Chandigarh [76.7720, 30.7320]
    const sellerDoc = await Seller.findOne({ userId: sellerUser._id });
    assert.ok(sellerDoc, 'Seller profile doc not found');
    testIds.sellers.push(sellerDoc._id);

    sellerDoc.isVerified = true;
    sellerDoc.isActive = true;
    sellerDoc.status = 'approved';
    sellerDoc.kycStatus = 'verified';
    sellerDoc.address = {
      street: 'House 102, Sector 22-B',
      city: 'Chandigarh',
      state: 'Chandigarh',
      pincode: '160022',
      fullAddress: 'House 102, Sector 22-B, Chandigarh',
      location: { type: 'Point', coordinates: [76.7720, 30.7320] },
    };
    await sellerDoc.save();
    console.log('  ✔ Seller approved & located in Sector 22 Chandigarh.\n');


    // ── STEP 3: Seller Adds Menu Item ──
    console.log('▶ STEP 3: Adding menu item for Seller...');
    const menuRes = await request('POST', '/api/products', {
      name: `Special Shahi Thali ${ts}`,
      description: '4 Butter Roti, Dal Makhani, Paneer Butter Masala, Jeera Rice, Gulab Jamun',
      category: 'Meals',
      sellingPrice: 180,
      price: 180,
      isAvailable: true,
      foodType: 'veg',
      mealTypes: ['lunch', 'dinner'],
    }, sellerToken);

    assert.strictEqual(menuRes.status, 201, `Add menu failed: ${JSON.stringify(menuRes.body)}`);
    const product = menuRes.body.product || menuRes.body.data;
    assert.ok(product?._id, 'Product ID missing');
    testIds.products.push(product._id);
    console.log(`  ✔ Menu item created: "${product.name}" (₹${product.sellingPrice})\n`);


    // ── STEP 4: Customer Discovers Nearby Sellers & Places Order ──
    console.log('▶ STEP 4: Customer discovering nearby sellers and placing order...');
    // Customer is in Sector 22 Chandigarh (~300 meters from seller)
    const discoveryRes = await request('GET', `/api/user/sellers/nearby?lat=30.7335&lng=76.7735`, null, customerToken);
    assert.strictEqual(discoveryRes.status, 200, 'Nearby discovery failed');
    const foundSellers = discoveryRes.body.sellers || [];
    const isOurSellerNearby = foundSellers.some(s => String(s._id) === String(sellerDoc._id));
    assert.ok(isOurSellerNearby, 'Seller was not found in 12 km nearby search');
    console.log('  → Seller discovered successfully within 12 km radius.');

    // Place Order
    const placeOrderRes = await request('POST', '/api/user/orders/place', {
      sellerId: String(sellerDoc._id),
      items: [
        {
          menuItemId: String(product._id),
          id: String(product._id),
          name: product.name,
          quantity: 2,
          price: 180,
        },
      ],
      paymentMethod: 'cod',
      deliveryAddress: {
        address: 'House 555, Sector 22-A',
        city: 'Chandigarh',
        state: 'Chandigarh',
        pincode: '160022',
        location: {
          type: 'Point',
          coordinates: [76.7735, 30.7335],
        },
      },
    }, customerToken);

    assert.strictEqual(placeOrderRes.status, 201, `Order placement failed: ${JSON.stringify(placeOrderRes.body)}`);
    const createdOrder = placeOrderRes.body.order;
    assert.ok(createdOrder?._id, 'Order ID missing');
    testIds.orders.push(createdOrder._id);
    console.log(`  ✔ Order placed successfully! Order #${createdOrder.orderNumber}, Total: ₹${createdOrder.totalAmount || createdOrder.total}`);
    console.log(`  → Initial Delivery OTP: ${createdOrder.deliveryOtp}\n`);


    // ── STEP 5: Rider Registration & Assignment Setup ──
    console.log('▶ STEP 5: Setting up Delivery Partner (Rider)...');
    const riderEmail = `e2e_rider_${ts}@test.com`;
    const riderUser = await User.create({
      name: 'Vikram Rider',
      email: riderEmail,
      phone: `96${String(ts).slice(-8)}`,
      password: 'Password@123',
      role: 'delivery',
      isVerified: true,
    });
    testIds.users.push(riderUser._id);

    // Rider login
    const riderLogin = await request('POST', '/api/auth/login', {
      email: riderEmail,
      password: 'Password@123',
      role: 'delivery',
    });
    assert.strictEqual(riderLogin.status, 200, 'Rider login failed');
    const riderToken = riderLogin.body.token;

    // DeliveryPartner Profile (verified, online, nearby)
    const riderPartner = await DeliveryPartner.create({
      userId: riderUser._id,
      name: 'Vikram Rider',
      phone: riderUser.phone,
      email: riderEmail,
      vehicleType: 'bike',
      vehicleNumber: 'CH-01-AB-1234',
      isApproved: true,
      kycStatus: 'verified',
      isOnline: true,
      isActive: true,
      currentLocation: {
        type: 'Point',
        coordinates: [76.7725, 30.7325], // Right in Sector 22
      },
      wallet: 0,
      earnings: 0,
    });
    testIds.partners.push(riderPartner._id);
    console.log('  ✔ Rider profile created, verified, and placed at live GPS coordinates.\n');


    // ── STEP 6: Rider Accepts the Order ──
    console.log('▶ STEP 6: Rider accepting Order...');
    const acceptRes = await request('POST', `/api/delivery/orders/${createdOrder._id}/accept`, {}, riderToken);
    assert.strictEqual(acceptRes.status, 200, `Rider accept failed: ${JSON.stringify(acceptRes.body)}`);
    console.log('  ✔ Order accepted by Rider!\n');


    // ── STEP 7: Rider Progresses Delivery (Arrived at Restaurant -> Picked Up) ──
    console.log('▶ STEP 7: Updating status: Reached Restaurant -> Picked Up...');
    const arrivedRes = await request('PATCH', `/api/delivery/orders/${createdOrder._id}/status`, {
      status: 'arrived_at_restaurant',
      location: { lat: 30.7320, lng: 76.7720 },
    }, riderToken);
    assert.strictEqual(arrivedRes.status, 200, 'Arrived update failed');

    const pickupRes = await request('PATCH', `/api/delivery/orders/${createdOrder._id}/status`, {
      status: 'picked_up',
      location: { lat: 30.7325, lng: 76.7725 },
    }, riderToken);
    assert.strictEqual(pickupRes.status, 200, 'Pickup update failed');
    console.log('  ✔ Order is now OUT FOR DELIVERY (Picked Up by Rider).\n');


    // ── STEP 8: Rider Clicks "Delivered" -> System Sends OTP to Customer Email ──
    console.log('▶ STEP 8: Rider taps "Delivered" -> Triggering Delivery OTP to Customer...');
    const sendOtpRes = await request('POST', `/api/delivery/orders/${createdOrder._id}/send-delivery-otp`, {}, riderToken);
    assert.strictEqual(sendOtpRes.status, 200, `Send delivery OTP failed: ${JSON.stringify(sendOtpRes.body)}`);
    assert.ok(sendOtpRes.body.success, 'send-delivery-otp returned success: false');
    console.log('  ✔ Delivery OTP endpoint triggered successfully!');
    console.log(`  → Response message: "${sendOtpRes.body.message}"`);
    console.log(`  → Masked email: ${sendOtpRes.body.maskedEmail}`);

    // Verify current OTP in DB
    const freshOrder = await Order.findById(createdOrder._id);
    assert.ok(freshOrder.deliveryOtp, 'Order deliveryOtp must exist');
    assert.match(freshOrder.deliveryOtp, /^\d{4}$/, 'Delivery OTP must be 4 digits');
    console.log(`  → Verified 4-digit Delivery OTP: ${freshOrder.deliveryOtp}\n`);


    // ── STEP 9: Rider Enters OTP and Confirms Delivery ──
    console.log('▶ STEP 9: Rider confirming delivery with 4-digit OTP...');
    
    // First test invalid OTP rejection
    const wrongOtpRes = await request('POST', `/api/delivery/orders/${createdOrder._id}/confirm-delivery`, {
      otp: '0000',
    }, riderToken);
    assert.strictEqual(wrongOtpRes.status, 400, 'Invalid OTP should be rejected with 400');
    console.log('  → Verified wrong OTP was correctly rejected.');

    // Now test valid OTP confirmation
    const confirmRes = await request('POST', `/api/delivery/orders/${createdOrder._id}/confirm-delivery`, {
      otp: freshOrder.deliveryOtp,
    }, riderToken);

    assert.strictEqual(confirmRes.status, 200, `Confirm delivery failed: ${JSON.stringify(confirmRes.body)}`);
    assert.strictEqual(confirmRes.body.order.status, 'delivered', 'Order status should be delivered');
    assert.strictEqual(confirmRes.body.order.deliveryStatus, 'delivered', 'Delivery status should be delivered');
    console.log('  ✔ Delivery OTP verified successfully! Order marked DELIVERED.\n');


    // ── STEP 10: Verify Rider Wallet Credit & Settlement ──
    console.log('▶ STEP 10: Verifying Rider Wallet Credit & Order Settlement...');
    const updatedPartner = await DeliveryPartner.findById(riderPartner._id);
    const creditedAmount = Number(updatedPartner.wallet) || 0;
    console.log(`  → Rider Wallet Balance: ₹${creditedAmount}`);
    console.log(`  → Rider Total Earned: ₹${updatedPartner.earnings || 0}`);
    assert.ok(creditedAmount > 0, 'Rider wallet balance should be credited after delivery');

    const deliveredOrder = await Order.findById(createdOrder._id);
    assert.strictEqual(deliveredOrder.status, 'delivered', 'Order status must be delivered');
    assert.ok(deliveredOrder.actualDelivery, 'actualDelivery timestamp must be set');
    assert.ok(deliveredOrder.riderPayoutCreditedAt, 'riderPayoutCreditedAt flag must be set');
    console.log(`  → Rider Payout Credited At: ${deliveredOrder.riderPayoutCreditedAt}`);
    console.log('  ✔ Rider Wallet correctly credited and order settlement completed!\n');

    console.log('========================================================');
    console.log('🎉 ALL 10 E2E LIFECYCLE STEPS PASSED WITH 100% SUCCESS!');
    console.log('========================================================\n');

  } catch (err) {
    console.error('\n❌ E2E TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    console.log('🧹 Cleaning up test database records...');
    try {
      if (testIds.orders.length) await Order.deleteMany({ _id: { $in: testIds.orders } });
      if (testIds.products.length) await Product.deleteMany({ _id: { $in: testIds.products } });
      if (testIds.sellers.length) await Seller.deleteMany({ _id: { $in: testIds.sellers } });
      if (testIds.partners.length) await DeliveryPartner.deleteMany({ _id: { $in: testIds.partners } });
      if (testIds.users.length) await User.deleteMany({ _id: { $in: testIds.users } });
      console.log('  ✔ Test records cleaned up.');
    } catch (e) {
      console.warn('Cleanup warning:', e.message);
    }
    await mongoose.disconnect().catch(() => {});
    process.exit(process.exitCode || 0);
  }
}

run();
