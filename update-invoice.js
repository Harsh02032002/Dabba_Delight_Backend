const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

// Import models
const { Invoice } = require('./models/Others');

async function updateExistingInvoice() {
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

    // Find existing invoice by order ID
    const orderId = '69b462d785051c3c060719c8';
    const invoice = await Invoice.findOne({ orderId: orderId });
    
    if (invoice) {
      console.log('📄 Found existing invoice, updating...');
      
      // Update with correct S3 URL
      invoice.pdfPath = 'http://dabbanation-images-2026.s3.eu-north-1.amazonaws.com/invoices/1773430147897-8b7c6580983644f2.pdf';
      
      await invoice.save();
      console.log('✅ Invoice updated successfully!');
      console.log('   Invoice Number:', invoice.invoiceNumber);
      console.log('   Order ID:', invoice.orderId);
      console.log('   PDF Path:', invoice.pdfPath);
    } else {
      console.log('❌ No existing invoice found');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

updateExistingInvoice();
