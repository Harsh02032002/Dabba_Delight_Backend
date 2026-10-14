const { Invoice } = require('../models/Others');
const Order = require('../models/Order');
const { generateInvoice } = require('../services/html-invoice.service'); // Use HTML service
const fs = require('fs');
const path = require('path');

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
    
    const order = await Order.findById(req.params.orderId)
      .populate('userId', 'name email phone')
      .populate('sellerId', 'businessName email phone logo type gstNumber fssaiLicense address');
    console.log('📦 Order found:', order ? order.orderNumber : 'NOT FOUND');
    
    if (!order) {
      console.log('❌ Order not found in database');
      return res.status(404).json({ message: 'Order not found' });
    }
    
    // Check if user owns this order (or is admin / seller)
    const orderUserIdStr = (order.userId?._id || order.userId)?.toString();
    const reqUserIdStr = req.user?._id?.toString();
    if (!orderUserIdStr || !reqUserIdStr || (orderUserIdStr !== reqUserIdStr && req.user.role !== 'admin' && req.user.role !== 'seller')) {
      console.log('❌ User not authorized to download this invoice');
      return res.status(403).json({ message: 'Unauthorized to download this invoice' });
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Check if an invoice already exists with a local PDF on disk for instant download
    let invoice = await Invoice.findOne({ orderId: order._id });
    let localPdfFile = invoice?.invoiceNumber
      ? path.join(__dirname, '..', 'uploads', 'invoices', `${invoice.invoiceNumber}.pdf`)
      : null;

    if (!invoice || !localPdfFile || !fs.existsSync(localPdfFile)) {
      console.log(`[${new Date().toISOString()}] 🔄 Generating invoice PDF for order: ${order.orderNumber}`);
      invoice = await generateInvoice(order);
      localPdfFile = path.join(__dirname, '..', 'uploads', 'invoices', `${invoice.invoiceNumber}.pdf`);
    }

    const safeFileName = `Invoice-${order.orderNumber || invoice.invoiceNumber}.pdf`;

    if (localPdfFile && fs.existsSync(localPdfFile)) {
      console.log('📤 Streaming local PDF file:', localPdfFile);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
      return fs.createReadStream(localPdfFile).pipe(res);
    }

    if (invoice.pdfPath && invoice.pdfPath.startsWith('http')) {
      console.log('🌐 Redirecting to remote PDF URL:', invoice.pdfPath);
      return res.redirect(invoice.pdfPath);
    }

    const fallbackPath = invoice.pdfPath?.startsWith('/')
      ? path.join(__dirname, '..', invoice.pdfPath)
      : invoice.pdfPath;

    if (fallbackPath && fs.existsSync(fallbackPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
      return fs.createReadStream(fallbackPath).pipe(res);
    }

    return res.status(404).json({ message: 'Invoice PDF file not found' });
  } catch (err) {
    console.log('❌ Download error:', err.message);
    console.log('📋 Error stack:', err.stack);
    res.status(500).json({ success: false, message: err.message });
  }
};

