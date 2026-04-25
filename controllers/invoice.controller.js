const { Invoice } = require('../models/Others');
const Order = require('../models/Order');
const { generateInvoice } = require('../services/html-invoice.service'); // Use HTML service
const fs = require('fs');

// POST /api/invoice/generate/:orderId
exports.generateInvoiceForOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate('userId', 'name email phone')
      .populate('sellerId', 'businessName email phone logo type gstNumber fssaiLicense address');
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
    
    // Force regeneration to ensure latest template and data
    console.log(`[${new Date().toISOString()}] 🔄 REGENERATING INVOICE for order: ${req.params.orderId}`);
    
    // Set headers to prevent caching of the download/redirect
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const orderWithDetails = await Order.findById(req.params.orderId)
      .populate('userId', 'name email phone')
      .populate('sellerId', 'businessName email phone logo type gstNumber fssaiLicense address');
    
    if (!orderWithDetails) {
      console.log('❌ Order not found for regeneration');
      return res.status(404).json({ message: 'Order not found' });
    }

    const invoice = await generateInvoice(orderWithDetails);
    
    console.log('📁 PDF path:', invoice.pdfPath);
    
    // Check if it's an S3 URL or local file
    if (invoice.pdfPath.startsWith('http')) {
      // It's an S3 URL, redirect to it
      console.log('🌐 Redirecting to S3 URL:', invoice.pdfPath);
      return res.redirect(invoice.pdfPath);
    } else {
      // It's a local file (fallback)
      console.log('📁 Local file path:', invoice.pdfPath);
      
      const absolutePath = invoice.pdfPath.startsWith('/') 
        ? path.join(__dirname, '..', invoice.pdfPath)
        : invoice.pdfPath;

      if (!fs.existsSync(absolutePath)) {
        console.log('❌ Local PDF file not found at path:', absolutePath);
        return res.status(404).json({ message: 'PDF not found' });
      }
      
      console.log('📤 Streaming local PDF file...');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${invoice.invoiceNumber}.pdf`);
      fs.createReadStream(absolutePath).pipe(res);
    }
  } catch (err) {
    console.log('❌ Download error:', err.message);
    console.log('📋 Error stack:', err.stack);
    res.status(500).json({ success: false, message: err.message });
  }
};
