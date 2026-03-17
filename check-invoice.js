const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

// Import models
const { Invoice } = require('./models/Others');

async function checkExistingInvoice() {
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

    // Find existing invoice
    const invoice = await Invoice.findOne({ invoiceNumber: 'DN-INV-20260313-0001' });
    if (invoice) {
      console.log('📄 Existing invoice found:');
      console.log('   Invoice Number:', invoice.invoiceNumber);
      console.log('   Order ID:', invoice.orderId);
      console.log('   PDF Path:', invoice.pdfPath);
      console.log('   Created At:', invoice.createdAt);
      
      // Update the PDF path if missing
      if (!invoice.pdfPath) {
        console.log('🔧 Updating PDF path...');
        invoice.pdfPath = 'http://dabbanation-images-2026.s3.eu-north-1.amazonaws.com/invoices/1773429323311-950f237c99df1e7b.pdf';
        await invoice.save();
        console.log('✅ PDF path updated!');
      }
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

checkExistingInvoice();
