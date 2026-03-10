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

  // Generate Zomato-style PDF
  try {
    const PDFDocument = require('pdfkit');
    const pdfDir = path.join(__dirname, '../uploads/invoices');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfPath = path.join(pdfDir, `${invoiceNumber}.pdf`);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      // Zomato-style Header with Red Background
      doc.fillColor('#E23744').rect(0, 0, doc.page.width, 120).fill();
      
      // White DABBA NATION text
      doc.fillColor('white').fontSize(32).font('Helvetica-Bold').text('DABBA NATION', 50, 40);
      doc.fillColor('white').fontSize(12).font('Helvetica').text('Food Delivery Platform', 50, 75);
      
      // Invoice details on the right
      doc.fillColor('white').fontSize(10).font('Helvetica');
      doc.text(`Invoice #${invoiceNumber}`, 380, 40, { align: 'right' });
      doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, 380, 55, { align: 'right' });
      doc.text(`Order #${order.orderNumber || 'N/A'}`, 380, 70, { align: 'right' });
      doc.text(`Payment: ${(order.paymentMethod || '').toUpperCase()}`, 380, 85, { align: 'right' });

      // Customer and Delivery Details
      doc.fillColor('#333').fontSize(14).font('Helvetica-Bold').text('Delivery Details', 50, 140);
      doc.fillColor('#666').fontSize(11).font('Helvetica');
      
      if (order.userId) {
        doc.text(`Name: ${order.userId.name || 'Customer'}`, 50, 160);
        doc.text(`Phone: ${order.userId.phone || 'N/A'}`, 50, 175);
        if (order.deliveryAddress) {
          doc.text(`Address: ${order.deliveryAddress.fullAddress || 'N/A'}`, 50, 190);
        }
      }

      // Restaurant Details
      doc.fillColor('#333').fontSize(14).font('Helvetica-Bold').text('Restaurant Details', 300, 140);
      doc.fillColor('#666').fontSize(11).font('Helvetica');
      
      if (order.sellerId) {
        doc.text(`Name: ${order.sellerId.businessName || 'Restaurant'}`, 300, 160);
        doc.text(`Phone: ${order.sellerId.phone || 'N/A'}`, 300, 175);
      }

      // Order Items Table
      const tableTop = 230;
      
      // Table Header
      doc.fillColor('#E23744').rect(50, tableTop - 5, doc.page.width - 80, 30).fill();
      doc.fillColor('white').font('Helvetica-Bold').fontSize(11);
      doc.text('ITEM', 60, tableTop + 5);
      doc.text('QTY', 250, tableTop + 5, { width: 50, align: 'center' });
      doc.text('PRICE', 320, tableTop + 5, { width: 80, align: 'right' });
      doc.text('TOTAL', 410, tableTop + 5, { width: 80, align: 'right' });

      // Table Items
      let y = tableTop + 35;
      doc.fillColor('#333').font('Helvetica').fontSize(10);
      
      invoice.items.forEach((item, index) => {
        // Alternate row colors
        if (index % 2 === 0) {
          doc.fillColor('#f8f8f8').rect(50, y - 3, doc.page.width - 80, 22).fill();
        }
        
        doc.fillColor('#333');
        doc.text(item.name, 60, y, { width: 180 });
        doc.text(String(item.quantity), 250, y, { width: 50, align: 'center' });
        doc.text(`₹${item.price}`, 320, y, { width: 80, align: 'right' });
        doc.text(`₹${item.total}`, 410, y, { width: 80, align: 'right' });
        y += 22;
      });

      // Summary Section
      const summaryTop = y + 20;
      
      // Summary Box
      doc.strokeColor('#ddd').lineWidth(1);
      doc.rect(320, summaryTop - 10, 170, 180).stroke();
      
      doc.fillColor('#333').font('Helvetica-Bold').fontSize(12);
      doc.text('Order Summary', 330, summaryTop);
      
      doc.fillColor('#666').font('Helvetica').fontSize(10);
      let summaryY = summaryTop + 25;
      
      doc.text('Subtotal:', 330, summaryY);
      doc.text(`₹${invoice.subtotal}`, 460, summaryY, { align: 'right' });
      summaryY += 20;
      
      if (invoice.discount > 0) {
        doc.fillColor('#4CAF50').text('Discount:', 330, summaryY);
        doc.fillColor('#4CAF50').text(`-₹${invoice.discount}`, 460, summaryY, { align: 'right' });
        summaryY += 20;
        doc.fillColor('#666');
      }
      
      doc.text('Delivery Fee:', 330, summaryY);
      doc.text(`₹${invoice.deliveryFee}`, 460, summaryY, { align: 'right' });
      summaryY += 20;
      
      doc.text('GST:', 330, summaryY);
      doc.text(`₹${invoice.tax}`, 460, summaryY, { align: 'right' });
      summaryY += 20;
      
      doc.text('Platform Fee:', 330, summaryY);
      doc.text(`₹${invoice.platformFee}`, 460, summaryY, { align: 'right' });
      summaryY += 30;
      
      // Total with background
      doc.fillColor('#E23744').rect(320, summaryY - 5, 170, 35).fill();
      doc.fillColor('white').font('Helvetica-Bold').fontSize(14);
      doc.text('TOTAL AMOUNT', 330, summaryY + 5);
      doc.text(`₹${invoice.totalAmount}`, 460, summaryY + 5, { align: 'right' });

      // Footer
      doc.fillColor('#999').font('Helvetica').fontSize(9);
      doc.text('Thank you for ordering with DABBA NATION!', 50, 700, { align: 'center' });
      doc.text('For any queries, contact: support@dabbanation.com | +91 1800-123-4567', 50, 715, { align: 'center' });
      
      // Payment Status Badge
      if (invoice.paymentStatus === 'paid') {
        doc.fillColor('#4CAF50').rect(50, summaryTop + 20, 80, 25).fill();
        doc.fillColor('white').font('Helvetica-Bold').fontSize(10);
        doc.text('PAID', 70, summaryTop + 27);
      } else {
        doc.fillColor('#FF9800').rect(50, summaryTop + 20, 80, 25).fill();
        doc.fillColor('white').font('Helvetica-Bold').fontSize(10);
        doc.text('PENDING', 65, summaryY + 27);
      }

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    invoice.pdfPath = pdfPath;
  } catch (pdfErr) {
    console.log('PDF generation skipped:', pdfErr.message);
  }

  await invoice.save();
  return invoice;
};
