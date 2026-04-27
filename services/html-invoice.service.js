const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { Invoice } = require('../models/Others');
const { uploadToS3 } = require('../middleware/s3-upload.middleware');

// ─── CONFIGURATION ──────────────────────────────────
const COLORS = {
  primary: '#E23744',
  secondary: '#1a1a1a',
  accent: '#B21F29',
  text: '#1a1a1a',
  lightText: '#888',
  bg: '#f4f7f6',
  white: '#ffffff',
  border: '#f0f0f0'
};

// ─── UTILS ──────────────────────────────────────────
const getLogoBase64 = () => {
  try {
    const possiblePaths = [
      path.resolve(process.cwd(), 'logo.png'),
      path.resolve(process.cwd(), 'public', 'assets', 'logo.png'),
      path.resolve(__dirname, '..', 'public', 'assets', 'logo.png'),
      path.join(__dirname, '../logo.png')
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
      }
    }
  } catch (err) {
    console.log('⚠️ Logo loading error:', err.message);
  }
  return null;
};

const generateInvoiceNumber = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);
  
  const count = await Invoice.countDocuments({ createdAt: { $gte: startOfDay, $lte: endOfDay } });
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `DN-INV-${dateStr}-${String(count + 1).padStart(4, '0')}-${random}`;
};

const prepareOrderData = (order, invoiceNumber) => {
  const backendUrl = process.env.BACKEND_URL || (process.env.NODE_ENV === 'production' ? 'https://api.dabbanation.in' : 'http://localhost:5000');
  
  return {
    invoiceNumber,
    date: new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    customer: {
      name: order.userId?.name || 'Customer',
      phone: order.userId?.phone || 'N/A',
      address: order.deliveryAddress?.fullAddress || `${order.deliveryAddress?.street || ''}, ${order.deliveryAddress?.city || ''}`.trim() || 'N/A'
    },
    seller: {
      name: order.sellerId?.businessName || 'Restaurant',
      type: order.sellerId?.type === 'home_chef' ? 'Home Chef' : 'Restaurant',
      gst: order.sellerId?.gstNumber && order.sellerId.gstNumber !== 'N/A' ? order.sellerId.gstNumber : '0',
      fssai: order.sellerId?.fssaiLicense && order.sellerId.fssaiLicense !== 'N/A' ? order.sellerId.fssaiLicense : '0',
      address: order.sellerId?.address?.fullAddress || `${order.sellerId?.address?.street || ''}, ${order.sellerId?.address?.city || ''}`.trim() || 'N/A',
      logo: order.sellerId?.logo ? (order.sellerId.logo.startsWith('http') ? order.sellerId.logo : `${backendUrl}${order.sellerId.logo.startsWith('/') ? '' : '/'}${order.sellerId.logo}`) : 'https://cdn-icons-png.flaticon.com/512/1046/1046771.png'
    },
    items: (order.items || []).map(item => ({
      name: item.name || 'Item',
      quantity: Number(item.quantity) || 0,
      price: Number(item.sellingPrice || item.price) || 0,
      total: (Number(item.sellingPrice || item.price) || 0) * (Number(item.quantity) || 0)
    })).filter(i => i.quantity > 0),
    summary: {
      subtotal: Number(order.subtotal) || 0,
      discount: Number(order.discount) || 0,
      delivery: Number(order.deliveryFee) || 0,
      tax: (Number(order.foodCgst) || 0) + (Number(order.foodSgst) || 0) + (Number(order.foodIgst) || 0) + (Number(order.deliveryCgst) || 0) + (Number(order.deliverySgst) || 0) + (Number(order.deliveryIgst) || 0),
      platform: Number(order.platformFee) || 0,
      total: Number(order.total) || 0,
      status: (order.paymentStatus || 'pending').toUpperCase()
    }
  };
};

// ─── HTML TEMPLATE ──────────────────────────────────
const getInvoiceHTML = (data) => {
  const dabbaLogoBase64 = getLogoBase64();
  const dabbaLogo = dabbaLogoBase64 ? 
    `<img src="${dabbaLogoBase64}" alt="Dabba Nation" style="height: 70px; width: auto; object-fit: contain;">` : 
    `<div style="display: flex; align-items: center; gap: 12px;">
      <div style="background: linear-gradient(135deg, #E23744 0%, #B21F29 100%); width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 26px;">DN</div>
      <div style="font-size: 28px; font-weight: 800; color: white;">DABBA <span style="color: #E23744;">NATION</span></div>
    </div>`;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #fff; color: ${COLORS.secondary}; line-height: 1.5; }
        .invoice-container { max-width: 800px; margin: 0 auto; min-height: 100vh; border: 1px solid #eee; }
        .header { background: ${COLORS.secondary}; color: white; padding: 40px 50px; display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid ${COLORS.primary}; }
        .details-grid { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #f0f0f0; }
        .details-section { padding: 30px 50px; border-right: 1px solid #f0f0f0; }
        .details-section:last-child { border-right: none; }
        .section-title { font-size: 11px; font-weight: 700; color: ${COLORS.primary}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 15px; }
        .info-group { margin-bottom: 8px; font-size: 13px; }
        .info-group .label { color: #888; width: 70px; display: inline-block; }
        .info-group .value { font-weight: 500; }
        .content { padding: 40px 50px; }
        .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .items-table th { text-align: left; font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; padding: 12px 0; border-bottom: 2px solid ${COLORS.secondary}; }
        .items-table td { padding: 15px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
        .summary-section { margin-top: 20px; display: flex; justify-content: flex-end; }
        .summary-box { width: 280px; }
        .summary-item { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; color: #666; }
        .summary-total { margin-top: 10px; padding-top: 10px; border-top: 2px solid ${COLORS.secondary}; display: flex; justify-content: space-between; font-size: 20px; font-weight: 800; color: ${COLORS.secondary}; }
        .status-badge { background: ${COLORS.primary}; color: white; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; }
        .footer { padding: 40px; background: #fafafa; text-align: center; color: #888; font-size: 12px; border-top: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="invoice-container">
        <div class="header">
            ${dabbaLogo}
            <div style="text-align: right;">
                <div style="font-size: 11px; font-weight: 700; opacity: 0.7;">TAX INVOICE</div>
                <div style="font-size: 18px; font-weight: 700; color: ${COLORS.primary};">#${data.invoiceNumber}</div>
                <div style="font-size: 13px; opacity: 0.8;">${data.date}</div>
            </div>
        </div>

        <div class="details-grid">
            <div class="details-section">
                <div class="section-title">Recipient</div>
                <div style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">${data.customer.name}</div>
                <div class="info-group"><span class="label">Phone</span><span class="value">${data.customer.phone}</span></div>
                <div class="info-group"><span class="label">Address</span><span class="value">${data.customer.address}</span></div>
            </div>
            <div class="details-section">
                <div class="section-title">Provider</div>
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                    <img src="${data.seller.logo}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/1046/1046771.png'" style="width: 36px; height: 36px; border-radius: 6px; object-fit: cover;">
                    <div>
                        <div style="font-size: 15px; font-weight: 700;">${data.seller.name}</div>
                        <div style="font-size: 10px; color: #888; text-transform: uppercase;">${data.seller.type}</div>
                    </div>
                </div>
                <div class="info-group"><span class="label">GST</span><span class="value">${data.seller.gst}</span></div>
                <div class="info-group"><span class="label">FSSAI</span><span class="value">${data.seller.fssai}</span></div>
                <div class="info-group"><span class="label">Address</span><span class="value">${data.seller.address}</span></div>
            </div>
        </div>

        <div class="content">
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Description</th>
                        <th style="text-align: center;">Qty</th>
                        <th style="text-align: right;">Price</th>
                        <th style="text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.items.map(item => `
                        <tr>
                            <td style="font-weight: 600;">${item.name}</td>
                            <td style="text-align: center;">${item.quantity}</td>
                            <td style="text-align: right;">₹${item.price.toFixed(2)}</td>
                            <td style="text-align: right; font-weight: 700;">₹${item.total.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="summary-section">
                <div class="summary-box">
                    <div class="summary-item"><span>Subtotal</span><span>₹${data.summary.subtotal.toFixed(2)}</span></div>
                    <div class="summary-item"><span>Discount</span><span>-₹${data.summary.discount.toFixed(2)}</span></div>
                    <div class="summary-item"><span>Delivery</span><span>₹${data.summary.delivery.toFixed(2)}</span></div>
                    <div class="summary-item"><span>Tax (GST)</span><span>₹${data.summary.tax.toFixed(2)}</span></div>
                    <div class="summary-item"><span>Platform Fee</span><span>₹${data.summary.platform.toFixed(2)}</span></div>
                    <div class="summary-total">
                        <span>Total</span>
                        <span>₹${data.summary.total.toFixed(2)}</span>
                    </div>
                    <div style="margin-top: 15px; text-align: right;">
                        <span class="status-badge">${data.summary.status}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="footer">
            <div style="font-weight: 700; color: ${COLORS.secondary}; margin-bottom: 5px;">DABBA NATION</div>
            <div>India's Premier Food Delivery Platform</div>
            <div style="margin-top: 8px; opacity: 0.6;">support@dabbanation.com | www.dabbanation.com</div>
        </div>
    </div>
</body>
</html>
  `;
};

// ─── GENERATE INVOICE ───────────────────────────────
exports.generateInvoice = async (order) => {
  const invoiceNumber = await generateInvoiceNumber();
  const data = prepareOrderData(order, invoiceNumber);
  
  const invoice = new Invoice({
    invoiceNumber,
    orderId: order._id,
    userId: order.userId,
    sellerId: order.sellerId,
    items: data.items,
    subtotal: data.summary.subtotal,
    tax: data.summary.tax,
    deliveryFee: data.summary.delivery,
    platformFee: data.summary.platform,
    discount: data.summary.discount,
    totalAmount: data.summary.total,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
  });

  const pdfDir = path.join(__dirname, '../uploads/invoices');
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  const tempPdfPath = path.join(pdfDir, `${invoiceNumber}.pdf`);

  try {
    console.log(`🚀 Generating Invoice #${invoiceNumber} via Puppeteer...`);
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
    });
    const page = await browser.newPage();
    await page.setContent(getInvoiceHTML(data), { waitUntil: 'networkidle0' });
    
    await page.pdf({
      path: tempPdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
    });
    
    await browser.close();
  } catch (err) {
    console.error('❌ Puppeteer failed, using Fallback Engine:', err.message);
    
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const stream = fs.createWriteStream(tempPdfPath);
    doc.pipe(stream);

    // Header
    doc.fillColor(COLORS.secondary).rect(0, 0, 612, 140).fill();
    doc.fillColor(COLORS.primary).rect(0, 136, 612, 4).fill();
    
    // Logo
    try {
      const logoP = path.resolve(process.cwd(), 'logo.png');
      if (fs.existsSync(logoP)) doc.image(logoP, 50, 35, { height: 60 });
    } catch (e) {}

    doc.fillColor('white').font('Helvetica-Bold').fontSize(24).text('DABBA NATION', 160, 45);
    doc.fontSize(14).text(`Invoice #${invoiceNumber}`, 160, 75);
    doc.font('Helvetica').fontSize(10).text(`Date: ${data.date}`, 160, 95);
    doc.font('Helvetica-Bold').fillColor(COLORS.primary).text('TAX INVOICE', 450, 45, { align: 'right', width: 110 });

    // Details
    let y = 170;
    doc.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(10).text('RECIPIENT', 50, y);
    doc.text('PROVIDER', 320, y);
    
    y += 20;
    doc.fillColor(COLORS.secondary).fontSize(14).text(data.customer.name, 50, y);
    doc.text(data.seller.name, 320, y);
    
    y += 20;
    doc.fillColor(COLORS.lightText).font('Helvetica').fontSize(9);
    doc.text(`Phone: ${data.customer.phone}`, 50, y);
    doc.text(`GST: ${data.seller.gst}`, 320, y);
    
    y += 15;
    doc.text(data.customer.address, 50, y, { width: 220 });
    doc.text(`FSSAI: ${data.seller.fssai}`, 320, y);
    doc.text(data.seller.address, 320, y + 15, { width: 220 });

    // Table
    y = 300;
    doc.fillColor(COLORS.secondary).font('Helvetica-Bold').fontSize(10);
    doc.text('DESCRIPTION', 50, y);
    doc.text('QTY', 300, y, { width: 40, align: 'center' });
    doc.text('PRICE', 380, y, { width: 80, align: 'right' });
    doc.text('AMOUNT', 480, y, { width: 80, align: 'right' });
    
    doc.moveTo(50, y + 15).lineTo(560, y + 15).stroke(COLORS.secondary);
    
    y += 30;
    data.items.forEach(item => {
      doc.fillColor(COLORS.secondary).font('Helvetica').fontSize(10);
      doc.text(item.name, 50, y);
      doc.text(item.quantity.toString(), 300, y, { width: 40, align: 'center' });
      doc.text(`₹${item.price.toFixed(2)}`, 380, y, { width: 80, align: 'right' });
      doc.text(`₹${item.total.toFixed(2)}`, 480, y, { width: 80, align: 'right', font: 'Helvetica-Bold' });
      y += 25;
    });

    // Summary
    y = Math.max(y + 20, 500);
    const drawRow = (label, val, bold = false) => {
      doc.fillColor(bold ? COLORS.secondary : COLORS.lightText).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 14 : 10);
      doc.text(label, 350, y);
      doc.text(`₹${val.toFixed(2)}`, 480, y, { width: 80, align: 'right' });
      y += bold ? 30 : 20;
    };

    drawRow('Subtotal:', data.summary.subtotal);
    drawRow('Discount:', -data.summary.discount);
    drawRow('Delivery:', data.summary.delivery);
    drawRow('Tax (GST):', data.summary.tax);
    drawRow('Platform Fee:', data.summary.platform);
    doc.moveTo(350, y).lineTo(560, y).stroke(COLORS.secondary);
    y += 10;
    drawRow('TOTAL:', data.summary.total, true);

    // Footer
    doc.rect(0, 780, 612, 62).fill('#fafafa');
    doc.fillColor(COLORS.secondary).font('Helvetica-Bold').fontSize(12).text('DABBA NATION', 0, 795, { align: 'center', width: 612 });
    doc.fillColor(COLORS.lightText).font('Helvetica').fontSize(8).text('India\'s Premier Food Delivery Platform | support@dabbanation.com', 0, 810, { align: 'center', width: 612 });

    doc.end();
    await new Promise((resolve) => stream.on('finish', resolve));
  }

  // Upload to S3
  try {
    const pdfBuffer = fs.readFileSync(tempPdfPath);
    const s3Url = await uploadToS3({ originalname: `${invoiceNumber}.pdf`, buffer: pdfBuffer, mimetype: 'application/pdf' }, 'invoices');
    fs.unlinkSync(tempPdfPath);
    invoice.pdfPath = s3Url;
  } catch (err) {
    invoice.pdfPath = `/uploads/invoices/${invoiceNumber}.pdf`;
  }

  const invoiceData = invoice.toObject();
  delete invoiceData._id;
  return await Invoice.findOneAndUpdate({ orderId: order._id }, { $set: invoiceData }, { upsert: true, new: true });
};
