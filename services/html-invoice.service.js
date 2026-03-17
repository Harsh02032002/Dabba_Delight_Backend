const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { Invoice } = require('../models/Others');
const { uploadToS3 } = require('../middleware/s3-upload.middleware');

const generateInvoiceNumber = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);
  const count = await Invoice.countDocuments({ createdAt: { $gte: startOfDay, $lte: endOfDay } });
  return `DN-INV-${dateStr}-${String(count + 1).padStart(4, '0')}`;
};

const getInvoiceHTML = (order, invoiceNumber) => {
  // Fix logo paths for Puppeteer
  const sellerLogo = order.sellerId?.logo ? 
    (order.sellerId.logo.startsWith('http') ? order.sellerId.logo : `http://localhost:5000${order.sellerId.logo}`) : 
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiByeD0iMTAiIGZpbGw9IiNFMjM3NDQiLz4KPHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEwIDVIMjBWMjBIMTBWNVoiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik0xNSAxMGgyMHYxMEgxNVYxMHoiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik0zMCAxMGgxMHYxMEgzMFYxMHoiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo8L3N2Zz4KPC9zdmc+';
  
  const sellerName = order.sellerId?.businessName || 'Restaurant';
  const sellerType = order.sellerId?.type === 'home_chef' ? 'Home Chef' : 'Restaurant';
  const customerName = order.userId?.name || 'Customer';
  const customerPhone = order.userId?.phone || 'N/A';
  const customerAddress = order.deliveryAddress?.fullAddress || 'N/A';
  const orderDate = new Date(order.createdAt).toLocaleDateString('en-IN');
  
  console.log('🔍 Logo paths:', {
    sellerLogo: sellerLogo,
    sellerName: sellerName,
    hasLogo: !!order.sellerId?.logo
  });
  
  const itemsHTML = (order.items || []).map((item, index) => `
    <tr class="${index % 2 === 0 ? 'even-row' : 'odd-row'}">
      <td class="item-name">${item.name}</td>
      <td class="item-quantity">${item.quantity}</td>
      <td class="item-price">₹${item.price}</td>
      <td class="item-total">₹${(item.price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice ${invoiceNumber} - Dabba Nation</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f8f9fa;
        }
        
        .invoice-container {
            max-width: 800px;
            margin: 0 auto;
            background: var(--background);
            border: 1px solid var(--border);
            border-radius: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-light) 100%);
            color: white;
            padding: 40px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml;base64,PHN2ZyB4aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiByeD0iMTAiIGZpbGw9IiMzNDQ5NUUiLz4KPHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEwIDVIMjBWMjBIMTBWNVoiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik0xNSAxMGgyMHYxMEgxNVYxMHoiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik0zMCAxMGgxMHYxMEgzMFYxMHoiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo8L3N2Zz4KPC9zdmc+') repeat;
            opacity: 0.05;
        }
        
        .logo-section {
            display: flex;
            align-items: center;
        }
        
        .dabba-logo {
            width: 80px;
            height: 80px;
            background: white;
            border-radius: 16px;
            padding: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
            color: var(--primary-color);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .brand-text {
            font-size: 32px;
        }
        
        .invoice-details {
            text-align: right;
        }
        
        .invoice-number {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 8px;
        }
        
        .invoice-meta {
            font-size: 14px;
            opacity: 0.9;
            line-height: 1.4;
        }
        
        .content {
            padding: 40px;
        }
        
        .section {
            margin-bottom: 40px;
        }
        
        .section-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--primary-color);
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--border);
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
        }
        
        .info-section {
            background: var(--surface);
            padding: 25px;
            border-radius: 12px;
            border: 1px solid var(--border);
        }
        
        .seller-logo {
            width: 60px;
            height: 60px;
            border-radius: 12px;
            object-fit: cover;
            margin-bottom: 15px;
            border: 2px solid var(--border);
        }
        
        .info-item {
            margin-bottom: 12px;
            font-size: 15px;
        }
        
        .info-item strong {
            color: var(--primary-color);
            font-weight: 600;
        }
        
        .badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 10px;
        }
        
        .badge-home {
            background: linear-gradient(135deg, var(--success-color), #2ECC71);
            color: white;
        }
        
        .badge-restaurant {
            background: linear-gradient(135deg, var(--accent-color), #5DADE2);
            color: white;
        }
        
        .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        
        .items-table th {
            background: var(--primary-color);
            color: white;
            padding: 18px 20px;
            text-align: left;
            font-weight: 600;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .items-table td {
            padding: 20px;
            border-bottom: 1px solid var(--border);
            font-size: 15px;
        }
        
        .even-row {
            background: var(--surface);
        }
        
        .odd-row {
            background: white;
        }
        
        .item-name {
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .item-quantity {
            color: var(--text-secondary);
        }
        
        .item-price {
            color: var(--text-secondary);
        }
        
        .item-total {
            font-weight: 600;
            color: var(--primary-color);
        }
        
        .summary {
            background: var(--surface);
            padding: 30px;
            border-radius: 12px;
            border: 1px solid var(--border);
        }
        
        .summary-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            font-size: 15px;
        }
        
        .summary-row.total {
            font-size: 18px;
            font-weight: bold;
            color: var(--primary-color);
            padding-top: 15px;
            border-top: 1px solid var(--border);
        }
        
        .watermark {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 120px;
            font-weight: bold;
            color: var(--primary-color);
            opacity: 0.03;
            z-index: -1;
            pointer-events: none;
            white-space: nowrap;
        }
        
        .footer {
            background: var(--surface);
            padding: 30px 40px;
            text-align: center;
            border-top: 1px solid var(--border);
        }
        
        .footer-text {
            color: var(--text-secondary);
            font-size: 14px;
            margin-bottom: 10px;
        }
        
        .footer-brand {
            color: var(--primary-color);
            font-weight: bold;
            font-size: 16px;
        }
        
        @media print {
            body { margin: 0; padding: 0; }
            .invoice-container { box-shadow: none; border: 1px solid #ddd; }
            .watermark { 
                position: absolute; 
                opacity: 0.05;
            }
        }
        .status-badge {
            display: inline-block;
            padding: 12px 20px;
            border-radius: 25px;
            font-size: 14px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-top: 15px;
        }
        
        .status-paid {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
        }
        
        .status-pending {
            background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3);
        }
        
        .footer {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 35px;
            text-align: center;
            border-top: 1px solid #e9ecef;
        }
        
        .footer-text {
            color: #495057;
            font-size: 16px;
            margin-bottom: 12px;
            font-weight: 500;
        }
        
        .contact-info {
            color: #E23744;
            font-size: 15px;
            font-weight: 600;
        }
        
        @media print {
            body { background: white; }
            .invoice-container { box-shadow: none; margin: 0; }
            .watermark { display: none; }
        }
    </style>
</head>
<body>
    <div class="invoice-container">
        <!-- Dabba Nation Watermark -->
        <div class="watermark">DABBA NATION</div>
        
        <!-- Professional Header with Dabba Nation Logo -->
        <div class="header">
            <div class="logo-section">
                <div class="dabba-logo">
                    <img src="http://localhost:5000/assets/logo.png" alt="Dabba Nation Logo" style="width: 100%; height: 100%; object-fit: contain;">
                </div>
                <div class="brand-text">DABBA NATION</div>
            </div>
            <div class="invoice-details">
                <div class="invoice-number">Invoice #${invoiceNumber}</div>
                <div class="invoice-meta">
                    Date: ${orderDate}<br>
                    Order: #${order.orderNumber || 'N/A'}<br>
                    Payment: ${(order.paymentMethod || '').toUpperCase()}
                </div>
            </div>
        </div>

        <div class="content">
            <!-- Two Column Layout -->
            <div class="two-column">
                <!-- Customer Details -->
                <div class="info-section">
                    <div class="section-title">
                        📍 Delivery Details
                    </div>
                    <div class="info-item"><strong>Name:</strong> ${customerName}</div>
                    <div class="info-item"><strong>Phone:</strong> ${customerPhone}</div>
                    <div class="info-item"><strong>Address:</strong> ${customerAddress}</div>
                </div>

                <!-- Restaurant Details with Logo and Type -->
                <div class="info-section">
                    <div class="section-title">
                        🏪 ${sellerType} Details
                    </div>
                    <img src="${sellerLogo}" alt="${sellerName}" class="seller-logo">
                    <div class="info-item"><strong>Name:</strong> ${sellerName}</div>
                    <div class="info-item"><strong>Phone:</strong> ${order.sellerId?.phone || 'N/A'}</div>
                    <div class="info-item"><strong>Email:</strong> ${order.sellerId?.email || 'N/A'}</div>
                    <div class="seller-type ${order.sellerId?.type === 'home_chef' ? 'type-homechef' : 'type-restaurant'}">
                        ${order.sellerId?.type === 'home_chef' ? '👨‍🍳 Home Chef' : '🍽 Restaurant'}
                    </div>
                </div>
            </div>

            <!-- Order Items Table -->
            <table class="items-table">
                <thead>
                    <tr>
                        <th style="width: 40%;">ITEM</th>
                        <th style="width: 15%;">QTY</th>
                        <th style="width: 20%;">PRICE</th>
                        <th style="width: 25%;">TOTAL</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHTML}
                </tbody>
            </table>

            <!-- Summary Section -->
            <div class="summary-section">
                <div class="summary-grid">
                    <div>
                        <div class="summary-item">
                            <span>Subtotal:</span>
                            <span>₹${order.subtotal || 0}</span>
                        </div>
                        ${(order.discount || 0) > 0 ? `
                        <div class="summary-item discount">
                            <span>Discount:</span>
                            <span>-₹${order.discount}</span>
                        </div>
                        ` : ''}
                        <div class="summary-item">
                            <span>Delivery Fee:</span>
                            <span>₹${order.deliveryFee || 0}</span>
                        </div>
                        <div class="summary-item">
                            <span>GST:</span>
                            <span>₹${order.gstAmount || 0}</span>
                        </div>
                        <div class="summary-item">
                            <span>Platform Fee:</span>
                            <span>₹${order.platformFee || 0}</span>
                        </div>
                    </div>
                    <div class="summary-total">
                        TOTAL AMOUNT<br>
                        ₹${order.total || 0}
                    </div>
                </div>
                
                <div style="margin-top: 20px;">
                    <span class="status-badge ${order.paymentStatus === 'paid' ? 'status-paid' : 'status-pending'}">
                        ${order.paymentStatus === 'paid' ? '✓ PAYMENT COMPLETED' : '⏳ PAYMENT PENDING'}
                    </span>
                </div>
            </div>
        </div>

        <!-- Professional Footer -->
        <div class="footer">
            <div class="footer-text">
                Thank you for ordering with <strong>DABBA NATION</strong>!<br>
                Your favorite food, delivered with love ❤️<br>
                <em>India's Premier Food Delivery Platform</em>
            </div>
            <div class="contact-info">
                📞 support@dabbanation.com | +91 1800-123-4567<br>
                🌐 www.dabbanation.com
            </div>
        </div>
    </div>
</body>
</html>
  `;
};

exports.generateInvoice = async (order) => {
  console.log('🔍 Starting invoice generation for order:', order._id);
  console.log('🔍 Order data:', {
    orderId: order._id,
    sellerId: order.sellerId,
    userId: order.userId,
    items: order.items?.length || 0
  });

  const existing = await Invoice.findOne({ orderId: order._id });
  if (existing) {
    console.log('✅ Invoice already exists:', existing.invoiceNumber);
    console.log('🔄 Regenerating invoice with new HTML template...');
    // Delete old invoice file if exists
    if (existing.pdfPath && fs.existsSync(existing.pdfPath)) {
      fs.unlinkSync(existing.pdfPath);
      console.log('🗑️ Deleted old invoice file:', existing.pdfPath);
    }
    // Delete old invoice record
    await Invoice.deleteOne({ orderId: order._id });
    console.log('🗑️ Deleted old invoice record');
  }

  const invoiceNumber = await generateInvoiceNumber();
  const invoice = new Invoice({
    invoiceNumber, 
    orderId: order._id, 
    userId: order.userId, 
    sellerId: order.sellerId,
    items: (order.items || []).map(item => ({ 
      name: item.name, 
      quantity: item.quantity, 
      price: item.price, 
      total: item.price * item.quantity 
    })),
    subtotal: order.subtotal || 0, 
    tax: order.gstAmount || 0, 
    deliveryFee: order.deliveryFee || 0,
    platformFee: order.platformFee || 0, 
    discount: order.discount || 0,
    totalAmount: order.total, 
    paymentMethod: order.paymentMethod, 
    paymentStatus: order.paymentStatus,
  });

  // Generate HTML-based PDF using Puppeteer and upload to S3
  try {
    console.log('🎯 Starting invoice generation for order:', order._id);
    console.log('📦 Order details:', {
      orderNumber: order.orderNumber,
      userId: order.userId,
      sellerId: order.sellerId,
      total: order.total,
      paymentMethod: order.paymentMethod
    });
    
    const pdfDir = path.join(__dirname, '../uploads/invoices');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const tempPdfPath = path.join(pdfDir, `${invoiceNumber}.pdf`);
    
    const html = getInvoiceHTML(order, invoiceNumber);
    console.log('🎨 Generating HTML invoice with Puppeteer...');
    console.log('📝 HTML length:', html.length);
    console.log('📝 HTML preview:', html.substring(0, 200) + '...');
    
    // Launch Puppeteer
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    
    // Set content and generate PDF
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: tempPdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });
    
    await browser.close();
    
    // Upload to S3
    console.log('☁️ Uploading invoice to S3...');
    const pdfBuffer = fs.readFileSync(tempPdfPath);
    const s3File = {
      originalname: `${invoiceNumber}.pdf`,
      buffer: pdfBuffer,
      mimetype: 'application/pdf'
    };
    
    const s3Url = await uploadToS3(s3File, 'invoices');
    
    // Delete temporary file
    fs.unlinkSync(tempPdfPath);
    console.log('🗑️ Deleted temporary file:', tempPdfPath);
    
    invoice.pdfPath = s3Url;
    console.log(`✅ HTML Invoice uploaded to S3: ${s3Url}`);
    console.log(`📄 File size: ${pdfBuffer.length} bytes`);
  } catch (pdfErr) {
    console.log('❌ PDF generation failed:', pdfErr.message);
    console.log('🔄 Using fallback PDF method...');
    
    // Fallback to old method if Puppeteer fails
    try {
      const PDFDocument = require('pdfkit');
      const pdfDir = path.join(__dirname, '../uploads/invoices');
      if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
      const tempPdfPath = path.join(pdfDir, `${invoiceNumber}.pdf`);
      
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const stream = fs.createWriteStream(tempPdfPath);
      doc.pipe(stream);
      
      // Professional fallback PDF generation
      doc.fillColor('#E23744').rect(0, 0, doc.page.width, 120).fill();
      doc.fillColor('white').fontSize(32).font('Helvetica-Bold').text('DABBA NATION', 50, 50);
      doc.fillColor('white').fontSize(14).font('Helvetica').text(`Invoice #${invoiceNumber}`, 50, 85);
      doc.fillColor('white').fontSize(12).font('Helvetica').text(`Date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`, 50, 105);
      
      // Customer details
      doc.fillColor('#333').fontSize(14).font('Helvetica-Bold').text('Customer Details:', 50, 160);
      doc.fillColor('#666').fontSize(12).font('Helvetica').text(`Name: ${order.userId?.name || 'Customer'}`, 50, 180);
      doc.fillColor('#666').fontSize(12).font('Helvetica').text(`Phone: ${order.userId?.phone || 'N/A'}`, 50, 195);
      doc.fillColor('#666').fontSize(12).font('Helvetica').text(`Address: ${order.deliveryAddress?.fullAddress || 'N/A'}`, 50, 210);
      
      // Seller details
      doc.fillColor('#333').fontSize(14).font('Helvetica-Bold').text('Restaurant Details:', 300, 160);
      doc.fillColor('#666').fontSize(12).font('Helvetica').text(`Name: ${order.sellerId?.businessName || 'Restaurant'}`, 300, 180);
      doc.fillColor('#666').fontSize(12).font('Helvetica').text(`Type: ${order.sellerId?.type === 'home_chef' ? 'Home Chef' : 'Restaurant'}`, 300, 195);
      
      // Items table
      doc.fillColor('#333').fontSize(14).font('Helvetica-Bold').text('Order Items:', 50, 250);
      let yPosition = 270;
      
      (order.items || []).forEach((item, index) => {
        doc.fillColor('#666').fontSize(11).font('Helvetica').text(`${item.quantity}x ${item.name}`, 50, yPosition);
        doc.fillColor('#E23744').fontSize(11).font('Helvetica-Bold').text(`₹${(item.price * item.quantity).toFixed(2)}`, 450, yPosition, { align: 'right' });
        yPosition += 20;
      });
      
      // Total
      yPosition += 20;
      doc.fillColor('#333').fontSize(14).font('Helvetica-Bold').text(`Total Amount: ₹${order.total || 0}`, 450, yPosition, { align: 'right' });
      
      // Footer
      doc.fillColor('#E23744').fontSize(10).font('Helvetica').text('Thank you for ordering with DABBA NATION!', 50, doc.page.height - 50, { align: 'center' });
      
      doc.end();
      
      // Wait for PDF to finish
      await new Promise(resolve => stream.on('finish', resolve));
      
      // Upload fallback PDF to S3
      console.log('☁️ Uploading fallback invoice to S3...');
      const pdfBuffer = fs.readFileSync(tempPdfPath);
      const s3File = {
        originalname: `${invoiceNumber}.pdf`,
        buffer: pdfBuffer,
        mimetype: 'application/pdf'
      };
      
      const s3Url = await uploadToS3(s3File, 'invoices');
      
      // Delete temporary file
      fs.unlinkSync(tempPdfPath);
      console.log('🗑️ Deleted temporary file:', tempPdfPath);
      
      invoice.pdfPath = s3Url;
      console.log(`✅ Fallback Invoice uploaded to S3: ${s3Url}`);
      console.log(`📄 File size: ${pdfBuffer.length} bytes`);
    } catch (fallbackErr) {
      console.log('❌ Fallback PDF also failed:', fallbackErr.message);
      throw new Error('Invoice generation failed completely');
    }
  }

  await invoice.save();
  console.log(`✅ Invoice saved to database: ${invoice.invoiceNumber}`);
  return invoice;
};
