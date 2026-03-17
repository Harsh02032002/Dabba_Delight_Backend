const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

// Import models
const Order = require('./models/Order');
const { Invoice } = require('./models/Others');
const User = require('./models/User');
const Seller = require('./models/Seller');

async function createInvoiceForOrder() {
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

    // Find the order
    const orderId = '69b462d785051c3c060719c8';
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

    // Create invoice directly
    const invoiceNumber = `DN-INV-${order.orderNumber}`;
    const invoice = new Invoice({
      invoiceNumber,
      orderId: order._id,
      userId: order.userId._id,
      sellerId: order.sellerId._id,
      items: order.items,
      subtotal: order.subtotal || order.total,
      tax: order.tax || 0,
      deliveryFee: order.deliveryFee || 0,
      platformFee: order.platformFee || 0,
      discount: order.discount || 0,
      totalAmount: order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus || 'pending',
      pdfPath: 'http://dabbanation-images-2026.s3.eu-north-1.amazonaws.com/invoices/1773430147897-8b7c6580983644f2.pdf'
    });

    await invoice.save();
    console.log('✅ Invoice created and saved!');
    console.log('   Invoice Number:', invoice.invoiceNumber);
    console.log('   Order ID:', invoice.orderId);
    console.log('   PDF Path:', invoice.pdfPath);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('📋 Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

createInvoiceForOrder();
