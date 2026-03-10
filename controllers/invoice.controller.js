const { Invoice } = require('../models/Others');
const Order = require('../models/Order');
const { generateInvoice } = require('../services/zomato-invoice.service');
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
    const invoice = await Invoice.findOne({ orderId: req.params.orderId });
    if (!invoice || !invoice.pdfPath) return res.status(404).json({ message: 'Invoice not found' });
    if (!fs.existsSync(invoice.pdfPath)) return res.status(404).json({ message: 'PDF not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${invoice.invoiceNumber}.pdf`);
    fs.createReadStream(invoice.pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
