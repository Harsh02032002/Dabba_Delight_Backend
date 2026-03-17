const { Invoice } = require('../models/Others');
const Order = require('../models/Order');
const { generateInvoice } = require('../services/html-invoice.service'); // Use HTML service
const fs = require('fs');

// POST /api/invoice/generate/:orderId
exports.generateInvoiceForOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate('userId', 'name email phone')
      .populate('sellerId', 'businessName email phone');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const invoice = await generateInvoice(order);
    res.json({ success: true, invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/invoice/:invoiceId
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId)
      .populate('orderId').populate('userId', 'name email').populate('sellerId', 'businessName');
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    res.json({ success: true, invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/invoice/download/:orderId
exports.downloadInvoice = async (req, res) => {
  try {
    console.log('🔍 Download request for order:', req.params.orderId);
    console.log('👤 User requesting invoice:', req.user?._id);
    
    // First check if order exists
    const Order = require('../models/Order');
    const order = await Order.findById(req.params.orderId);
    console.log('📦 Order found:', order ? order.orderNumber : 'NOT FOUND');
    
    if (!order) {
      console.log('❌ Order not found in database');
      return res.status(404).json({ message: 'Order not found' });
    }
    
    // Check if user owns this order
    if (!order.userId || !req.user || (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin')) {
      console.log('❌ User not authorized to download this invoice');
      console.log('📋 Order userId:', order.userId);
      console.log('📋 Request user ID:', req.user?._id);
      console.log('📋 User role:', req.user?.role);
      return res.status(403).json({ message: 'Unauthorized to download this invoice' });
    }
    
    const invoice = await Invoice.findOne({ orderId: req.params.orderId });
    console.log('📄 Found invoice:', invoice ? invoice.invoiceNumber : 'NOT FOUND');
    
    if (!invoice || !invoice.pdfPath) {
      console.log('❌ Invoice not found or no PDF path');
      console.log('🔍 Available invoices for this user:');
      
      // Show all invoices for this user for debugging
      try {
        const userOrders = await Order.find({ userId: req.user._id }).select('_id');
        const userInvoices = await Invoice.find({ 
          orderId: { $in: userOrders }
        });
        console.log('📋 User invoices:', userInvoices.map(inv => ({ 
          invoiceNumber: inv.invoiceNumber, 
          orderId: inv.orderId, 
          hasPdfPath: !!inv.pdfPath 
        })));
      } catch (debugErr) {
        console.log('❌ Debug query failed:', debugErr.message);
      }
      
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    console.log('📁 PDF path:', invoice.pdfPath);
    
    // Check if it's an S3 URL or local file
    if (invoice.pdfPath.startsWith('http')) {
      // It's an S3 URL, redirect to it
      console.log('🌐 Redirecting to S3 URL:', invoice.pdfPath);
      return res.redirect(invoice.pdfPath);
    } else {
      // It's a local file (fallback)
      console.log('📁 Local file path:', invoice.pdfPath);
      console.log('📁 File exists:', fs.existsSync(invoice.pdfPath));
      
      if (!fs.existsSync(invoice.pdfPath)) {
        console.log('❌ Local PDF file not found at path:', invoice.pdfPath);
        return res.status(404).json({ message: 'PDF not found' });
      }
      
      console.log('📤 Streaming local PDF file...');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${invoice.invoiceNumber}.pdf`);
      fs.createReadStream(invoice.pdfPath).pipe(res);
    }
  } catch (err) {
    console.log('❌ Download error:', err.message);
    console.log('📋 Error stack:', err.stack);
    res.status(500).json({ success: false, message: err.message });
  }
};
