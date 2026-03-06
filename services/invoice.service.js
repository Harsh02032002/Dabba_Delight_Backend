const fs = require('fs');
const path = require('path');
const { Invoice } = require('../models/Others');

const generateInvoiceNumber = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);
  const count = await Invoice.countDocuments({ createdAt: { $gte: startOfDay, $lte: endOfDay } });
  return `DN-INV-${dateStr}-${String(count + 1).padStart(4, '0')}`;
};

exports.generateInvoice = async (order) => {
  const existing = await Invoice.findOne({ orderId: order._id });
  if (existing) return existing;

  const invoiceNumber = await generateInvoiceNumber();
  const invoice = new Invoice({
    invoiceNumber, orderId: order._id, userId: order.userId, sellerId: order.sellerId,
    items: (order.items || []).map(item => ({ name: item.name, quantity: item.quantity, price: item.price, total: item.price * item.quantity })),
    subtotal: order.subtotal || 0, tax: order.gstAmount || 0, deliveryFee: order.deliveryFee || 0,
    platformFee: order.platformFee || 0, discount: order.discount || 0,
    totalAmount: order.total, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
  });

  // Generate PDF
  try {
    const PDFDocument = require('pdfkit');
    const pdfDir = path.join(__dirname, '../uploads/invoices');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfPath = path.join(pdfDir, `${invoiceNumber}.pdf`);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      doc.fontSize(24).font('Helvetica-Bold').text('DABBA NATION', 50, 50);
      doc.fontSize(10).font('Helvetica').text('Your Food, Your Way', 50, 78);
      doc.moveDown(2);
      doc.fontSize(14).font('Helvetica-Bold').text('INVOICE', 50, 120);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Invoice #: ${invoiceNumber}`, 50, 145);
      doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, 50, 160);
      doc.text(`Order #: ${order.orderNumber || 'N/A'}`, 50, 175);
      doc.text(`Payment: ${(order.paymentMethod || '').toUpperCase()}`, 50, 190);

      const tableTop = 230;
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text('Item', 50, tableTop); doc.text('Qty', 300, tableTop, { width: 50, align: 'center' });
      doc.text('Price', 370, tableTop, { width: 80, align: 'right' }); doc.text('Total', 460, tableTop, { width: 80, align: 'right' });
      doc.moveTo(50, tableTop + 15).lineTo(540, tableTop + 15).stroke();

      let y = tableTop + 25;
      doc.font('Helvetica').fontSize(10);
      invoice.items.forEach(item => {
        doc.text(item.name, 50, y, { width: 240 }); doc.text(String(item.quantity), 300, y, { width: 50, align: 'center' });
        doc.text(`₹${item.price}`, 370, y, { width: 80, align: 'right' }); doc.text(`₹${item.total}`, 460, y, { width: 80, align: 'right' });
        y += 20;
      });

      doc.moveTo(50, y + 5).lineTo(540, y + 5).stroke(); y += 15;
      doc.text('Subtotal:', 370, y, { width: 80, align: 'right' }); doc.text(`₹${invoice.subtotal}`, 460, y, { width: 80, align: 'right' }); y += 18;
      doc.text('GST:', 370, y, { width: 80, align: 'right' }); doc.text(`₹${invoice.tax}`, 460, y, { width: 80, align: 'right' }); y += 18;
      doc.text('Delivery:', 370, y, { width: 80, align: 'right' }); doc.text(`₹${invoice.deliveryFee}`, 460, y, { width: 80, align: 'right' }); y += 25;
      doc.font('Helvetica-Bold').fontSize(14);
      doc.text('TOTAL:', 370, y, { width: 80, align: 'right' }); doc.text(`₹${invoice.totalAmount}`, 460, y, { width: 80, align: 'right' });

      doc.fontSize(8).font('Helvetica').fillColor('#888');
      doc.text('Thank you for ordering with Dabba Nation!', 50, 720, { align: 'center' });
      doc.end();
      stream.on('finish', resolve); stream.on('error', reject);
    });

    invoice.pdfPath = pdfPath;
  } catch (pdfErr) {
    console.log('PDF generation skipped:', pdfErr.message);
  }

  await invoice.save();
  return invoice;
};
