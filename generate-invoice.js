const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

// Import models
const Order = require('./models/Order');
const { Invoice } = require('./models/Others'); // Destructure Invoice from Others
const User = require('./models/User');
const Seller = require('./models/Seller');
const { generateInvoice } = require('./services/html-invoice.service');

async function generateMissingInvoice() {
  try {
    // Connect to MongoDB using same method as server
    const dns = require("dns");
    const currentServers = dns.getServers();
    if (currentServers && currentServers.includes("127.0.0.1")) {
      console.warn("Local DNS server 127.0.0.1 detected — switching to public DNS for SRV lookups");
      dns.setServers(["8.8.8.8", "8.8.4.4"]);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find the order
    const orderId = '69b45ffbef689f467859d7f1';
    const order = await Order.findById(orderId)
      .populate('userId', 'name email phone')
      .populate('sellerId', 'businessName email phone');

    if (!order) {
      console.log('❌ Order not found');
      return;
    }

    console.log('📦 Order found:', order.orderNumber);
    console.log('👤 User:', order.userId?.name);
    console.log('🏪 Seller:', order.sellerId?.businessName);
    console.log('💰 Total:', order.total);
    console.log('💳 Payment Method:', order.paymentMethod);

    // Check if invoice already exists
    const existingInvoice = await Invoice.findOne({ orderId: order._id });
    if (existingInvoice) {
      console.log('📄 Invoice already exists:', existingInvoice.invoiceNumber);
      console.log('📁 PDF Path:', existingInvoice.pdfPath);
      return;
    }

    // Generate invoice
    console.log('🎯 Generating invoice...');
    const invoice = await generateInvoice(order);
    console.log('✅ Invoice generated:', invoice.invoiceNumber);
    console.log('📁 PDF Path:', invoice.pdfPath);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('📋 Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

generateMissingInvoice();
