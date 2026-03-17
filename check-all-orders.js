const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

// Import models
const Order = require('./models/Order');
const { Invoice } = require('./models/Others');

async function checkAllUserOrders() {
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
    
    // Find all orders for this user
    const orders = await Order.find({ userId: userId })
      .sort({ createdAt: -1 });

    console.log('📦 All orders for user:');
    orders.forEach((order, index) => {
      console.log(`${index + 1}. ID: ${order._id}, Number: ${order.orderNumber}, Status: ${order.status}`);
    });

    // Find all invoices for this user
    console.log('\n📄 All invoices for user:');
    const invoices = await Invoice.find({ 
      orderId: { $in: orders.map(o => o._id) }
    }).sort({ createdAt: -1 });

    if (invoices.length === 0) {
      console.log('❌ No invoices found for this user');
    } else {
      invoices.forEach((invoice, index) => {
        console.log(`${index + 1}. Invoice: ${invoice.invoiceNumber}, Order: ${invoice.orderId}, PDF: ${invoice.pdfPath ? 'YES' : 'NO'}`);
      });
    }

    // Check the specific order that user is trying to download
    const requestedOrderId = '69b45a903981c30089e422eb';
    const requestedOrder = orders.find(o => o._id.toString() === requestedOrderId);
    
    console.log('\n🔍 Requested order check:');
    if (requestedOrder) {
      console.log('✅ Requested order exists:', requestedOrder.orderNumber);
    } else {
      console.log('❌ Requested order NOT found');
      console.log('📋 Available order IDs:');
      orders.forEach(o => console.log(`   ${o._id}`));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

checkAllUserOrders();
