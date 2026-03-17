const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

// Import models
const Order = require('./models/Order');
const { Invoice } = require('./models/Others');
const User = require('./models/User');
const Seller = require('./models/Seller');
const { generateInvoice } = require('./services/html-invoice.service');

async function checkUserOrders() {
  try {
    // Connect to MongoDB
    const dns = require("dns");
    const currentServers = dns.getServers();
    if (currentServers && currentServers.includes("127.0.0.1")) {
      console.warn("Local DNS server 127.0.0.1 detected — switching to public DNS for SRV lookups");
      dns.setServers(["8.8.8.8", "8.8.4.4"]);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find user
    const userId = '69a9c1d7fad85418654e56ee';
    const user = await User.findById(userId);
    console.log('👤 User found:', user?.name);

    // Find all orders for this user
    const orders = await Order.find({ userId: userId })
      .populate('sellerId', 'businessName')
      .sort({ createdAt: -1 });

    console.log('📦 Total orders found:', orders.length);
    
    orders.forEach((order, index) => {
      console.log(`\n📋 Order ${index + 1}:`);
      console.log(`   ID: ${order._id}`);
      console.log(`   Number: ${order.orderNumber}`);
      console.log(`   Status: ${order.status}`);
      console.log(`   Payment: ${order.paymentMethod}`);
      console.log(`   Total: ₹${order.total}`);
      console.log(`   Seller: ${order.sellerId?.businessName}`);
      console.log(`   Created: ${order.createdAt}`);
    });

    // Check invoices for these orders
    console.log('\n📄 Checking invoices...');
    for (const order of orders) {
      const invoice = await Invoice.findOne({ orderId: order._id });
      console.log(`📋 Order ${order.orderNumber}: Invoice ${invoice ? 'EXISTS' : 'MISSING'}`);
      if (invoice) {
        console.log(`   Invoice Number: ${invoice.invoiceNumber}`);
        console.log(`   PDF Path: ${invoice.pdfPath}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('📋 Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

checkUserOrders();
