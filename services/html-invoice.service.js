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
  
  // Use a more unique method than just count
  const count = await Invoice.countDocuments({ createdAt: { $gte: startOfDay, $lte: endOfDay } });
  const random = Math.random().toString(36).substring(2, 5).toUpperCase(); // 3 random chars
  return `DN-INV-${dateStr}-${String(count + 1).padStart(4, '0')}-${random}`;
};

const getInvoiceHTML = (order, invoiceNumber) => {
  // Fix logo paths for Puppeteer
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
  
  const sellerName = order.sellerId?.businessName || 'Restaurant';
  const sellerType = order.sellerId?.type === 'home_chef' ? 'Home Chef' : 'Restaurant';
  const sellerGST = (order.sellerId?.gstNumber && order.sellerId?.gstNumber !== 'N/A' && order.sellerId?.gstNumber.trim() !== '') ? order.sellerId.gstNumber : '0';
  const sellerFSSAI = (order.sellerId?.fssaiLicense && order.sellerId?.fssaiLicense !== 'N/A' && order.sellerId?.fssaiLicense.trim() !== '') ? order.sellerId.fssaiLicense : '0';
  const sellerAddress = order.sellerId?.address?.fullAddress || 
    `${order.sellerId?.address?.street || ''}, ${order.sellerId?.address?.city || ''}`.trim() || 'N/A';
    
  const customerName = order.userId?.name || 'Customer';
  const customerPhone = order.userId?.phone || 'N/A';
  const customerAddress = order.deliveryAddress?.fullAddress || 
    `${order.deliveryAddress?.street || ''}, ${order.deliveryAddress?.city || ''}`.trim() || 'N/A';
    
  const sellerLogo = order.sellerId?.logo ? 
    (order.sellerId.logo.startsWith('http') ? order.sellerId.logo : 
      (order.sellerId.logo.startsWith('/') ? `${backendUrl}${order.sellerId.logo}` : `${backendUrl}/${order.sellerId.logo}`)) : 
    'https://cdn-icons-png.flaticon.com/512/1046/1046771.png'; // Better default seller icon
    
  const orderDate = new Date(order.createdAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  
  let dabbaLogoUrl = '';
  try {
    let foundPath = null;
    const possiblePaths = [
      path.resolve(process.cwd(), 'logo.png'), 
      path.resolve(process.cwd(), 'public', 'assets', 'logo.png'),
      path.resolve(__dirname, '..', 'public', 'assets', 'logo.png'),
      'e:\\Dabbanation\\Dabba_Delight_Backend\\logo.png'
    ];

    console.log('--- LOGO SEARCH START ---');
    for (const p of possiblePaths) {
      const exists = fs.existsSync(p);
      console.log(`🔍 Checking: ${p} -> ${exists ? 'EXISTS ✅' : 'MISSING ❌'}`);
      if (exists) {
        foundPath = p;
        break;
      }
    }

    if (!foundPath) {
      console.log('🔄 Starting recursive search for logo.png in backend root...');
      try {
        const rootDir = 'e:\\Dabbanation\\Dabba_Delight_Backend';
        const searchFiles = (dir) => {
          if (foundPath) return;
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const fullPath = path.join(dir, item);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isDirectory()) {
                if (!item.includes('node_modules') && !item.includes('.git') && !item.includes('uploads')) {
                  searchFiles(fullPath);
                }
              } else if (item.toLowerCase() === 'logo.png') {
                foundPath = fullPath;
                console.log(`🎯 RECURSIVE MATCH: ${fullPath}`);
                return;
              }
            } catch (e) {}
          }
        };
        searchFiles(rootDir);
      } catch (err) {
        console.log('⚠️ Recursive search error:', err.message);
      }
    }

    if (foundPath) {
      const stats = fs.statSync(foundPath);
      const logoBase64 = fs.readFileSync(foundPath).toString('base64');
      dabbaLogoUrl = `data:image/png;base64,${logoBase64}`;
      console.log(`✅ FINAL SELECTION: ${foundPath} (${stats.size} bytes)`);
      console.log(`📄 Base64 Length: ${dabbaLogoUrl.length}`);
    } else {
      console.log('❌ FATAL: Logo not found anywhere!');
    }
    console.log('--- LOGO SEARCH END ---');
  } catch (err) {
    console.log('⚠️ Critical logo error:', err.message);
  }

  const dabbaLogo = dabbaLogoUrl ? `
    <div style="display: flex; align-items: center;">
      <img src="${dabbaLogoUrl}" alt="Dabba Nation" style="height: 70px; width: auto; object-fit: contain;">
    </div>
  ` : `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="background: linear-gradient(135deg, #E23744 0%, #B21F29 100%); width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 26px; box-shadow: 0 4px 10px rgba(226, 55, 68, 0.3);">DN</div>
      <div style="font-size: 28px; font-weight: 800; color: white; letter-spacing: -0.5px;">DABBA <span style="color: #E23744;">NATION</span></div>
    </div>
  `;

  console.log('🔍 Generating Invoice:', {
    invoiceNumber,
    seller: sellerName,
    hasGST: sellerGST !== 'N/A',
    hasFSSAI: sellerFSSAI !== 'N/A'
  });
  
  const itemsHTML = (order.items || []).map((item, index) => {
    const price = item.sellingPrice || item.price || 0;
    const quantity = item.quantity || 0;
    const total = price * quantity;
    return `
    <tr class="${index % 2 === 0 ? 'even-row' : 'odd-row'}">
      <td class="item-name">${item.name}</td>
      <td class="item-quantity">${quantity}</td>
      <td class="item-price">₹${price}</td>
      <td class="item-total">₹${total.toFixed(2)}</td>
    </tr>
    `;
  }).join('');

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
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f4f7f6;
            color: #1a1a1a;
            line-height: 1.5;
        }
        .invoice-container {
            max-width: 800px;
            margin: 0 auto;
            background: #fff;
            box-shadow: 0 20px 50px rgba(0,0,0,0.05);
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(to right, #1a1a1a, #2d2d2d);
            color: white;
            padding: 30px 50px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 4px solid #E23744;
        }
        .details-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0;
            border-bottom: 1px solid #f0f0f0;
        }
        .details-section {
            padding: 40px 50px;
            border-right: 1px solid #f0f0f0;
        }
        .details-section:last-child {
            border-right: none;
        }
        .section-title {
            font-size: 12px;
            font-weight: 700;
            color: #E23744;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .info-group {
            margin-bottom: 10px;
            font-size: 14px;
        }
        .info-group .label {
            color: #888;
            width: 70px;
            display: inline-block;
        }
        .info-group .value {
            font-weight: 500;
            color: #1a1a1a;
        }
        .content {
            padding: 40px 50px;
        }
        .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
        }
        .items-table th {
            text-align: left;
            font-size: 12px;
            font-weight: 700;
            color: #888;
            text-transform: uppercase;
            padding: 15px 0;
            border-bottom: 2px solid #1a1a1a;
        }
        .items-table td {
            padding: 20px 0;
            border-bottom: 1px solid #f0f0f0;
            font-size: 15px;
        }
        .summary-section {
            margin-top: 30px;
            display: flex;
            justify-content: flex-end;
        }
        .summary-box {
            width: 300px;
        }
        .summary-item {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            font-size: 14px;
            color: #666;
        }
        .summary-total {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 2px solid #1a1a1a;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 22px;
            font-weight: 800;
            color: #1a1a1a;
        }
        .footer {
            padding: 50px;
            background: #fdfdfd;
            border-top: 1px solid #f0f0f0;
            text-align: center;
            color: #888;
            font-size: 13px;
        }
        .status-badge {
            background: #E23744;
            color: white;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
        }
    </style>
</head>
<body>
    <div class="invoice-container">
        <div class="header">
            ${dabbaLogo}
            <div style="text-align: right;">
                <div style="font-size: 12px; font-weight: 700; opacity: 0.6; margin-bottom: 5px;">TAX INVOICE</div>
                <div style="font-size: 18px; font-weight: 700; color: #E23744;">#${invoiceNumber}</div>
                <div style="font-size: 13px; opacity: 0.8; margin-top: 5px;">${orderDate}</div>
            </div>
        </div>

        <div class="details-grid">
            <div class="details-section">
                <div class="section-title">Recipient</div>
                <div style="font-size: 16px; font-weight: 700; margin-bottom: 10px;">${customerName}</div>
                <div class="info-group"><span class="label">Phone</span><span class="value">${customerPhone}</span></div>
                <div class="info-group"><span class="label">Address</span><span class="value">${customerAddress}</span></div>
            </div>
            <div class="details-section">
                <div class="section-title">Provider</div>
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 15px;">
                    <img src="${sellerLogo}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/1046/1046771.png'" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover;">
                    <div>
                        <div style="font-size: 16px; font-weight: 700;">${sellerName}</div>
                        <div style="font-size: 11px; color: #888; text-transform: uppercase;">${sellerType}</div>
                    </div>
                </div>
                <div class="info-group"><span class="label">GST</span><span class="value">${sellerGST}</span></div>
                <div class="info-group"><span class="label">FSSAI</span><span class="value">${sellerFSSAI}</span></div>
                <div class="info-group"><span class="label">Address</span><span class="value">${sellerAddress}</span></div>
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
                    ${(order.items || []).map(item => `
                        <tr>
                            <td style="font-weight: 600;">${item.name}</td>
                            <td style="text-align: center;">${item.quantity}</td>
                            <td style="text-align: right;">₹${(Number(item.sellingPrice || item.price) || 0).toFixed(2)}</td>
                            <td style="text-align: right; font-weight: 700;">₹${((Number(item.sellingPrice || item.price) || 0) * (Number(item.quantity) || 0)).toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="summary-section">
                <div class="summary-box">
                    <div class="summary-item"><span>Subtotal</span><span>₹${(Number(order.subtotal) || 0).toFixed(2)}</span></div>
                    <div class="summary-item"><span>Discount</span><span>-₹${(Number(order.discount) || 0).toFixed(2)}</span></div>
                    <div class="summary-item"><span>Delivery</span><span>₹${(Number(order.deliveryFee) || 0).toFixed(2)}</span></div>
                    <div class="summary-item"><span>Tax (GST)</span><span>₹${((Number(order.foodCgst) || 0) + (Number(order.foodSgst) || 0) + (Number(order.foodIgst) || 0) + (Number(order.deliveryCgst) || 0) + (Number(order.deliverySgst) || 0) + (Number(order.deliveryIgst) || 0)).toFixed(2)}</span></div>
                    <div class="summary-item"><span>Platform Fee</span><span>₹${(Number(order.platformFee) || 0).toFixed(2)}</span></div>
                    <div class="summary-total">
                        <span>Total</span>
                        <span>₹${(order.total || 0).toFixed(2)}</span>
                    </div>
                    <div style="margin-top: 20px; text-align: right;">
                        <span class="status-badge">${(order.paymentStatus || 'pending').toUpperCase()}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="footer">
            <div style="margin-bottom: 15px; font-weight: 600; color: #1a1a1a;">DABBA NATION</div>
            <div>India's Premier Food Delivery Platform</div>
            <div style="margin-top: 10px;">support@dabbanation.com | www.dabbanation.com</div>
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
  let invoiceNumber = existing ? existing.invoiceNumber : await generateInvoiceNumber();

  if (existing) {
    console.log('✅ Reusing existing invoice number:', invoiceNumber);
    // Delete old invoice file if exists
    if (existing.pdfPath && fs.existsSync(existing.pdfPath)) {
      try {
        fs.unlinkSync(existing.pdfPath);
      } catch (err) { /* ignore */ }
    }
  }
  
  // Validate and fix items to prevent NaN
  const validatedItems = (order.items || []).map(item => {
    const price = Number(item.sellingPrice || item.price) || 0;
    const quantity = Number(item.quantity) || 0;
    return {
      name: item.name || 'Item',
      quantity: quantity,
      price: price,
      total: price * quantity
    };
  }).filter(item => item.quantity > 0);
  
  const invoice = new Invoice({
    invoiceNumber, 
    orderId: order._id, 
    userId: order.userId, 
    sellerId: order.sellerId,
    items: validatedItems,
    subtotal: Number(order.subtotal) || 0, 
    tax: Number(order.gstAmount) || 0, 
    deliveryFee: Number(order.deliveryFee) || 0,
    platformFee: Number(order.platformFee) || 0, 
    discount: Number(order.discount) || 0,
    totalAmount: Number(order.total) || 0, 
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
    
    // Give it a moment to render the Base64 images and styles
    await new Promise(r => setTimeout(r, 2000));
    
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
    
    let s3Url;
    try {
      console.log('☁️ Uploading invoice to S3...');
      const pdfBuffer = fs.readFileSync(tempPdfPath);
      const s3File = {
        originalname: `${invoiceNumber}.pdf`,
        buffer: pdfBuffer,
        mimetype: 'application/pdf'
      };
      s3Url = await uploadToS3(s3File, 'invoices');
      
      // Delete temporary file only if S3 successful
      fs.unlinkSync(tempPdfPath);
      console.log('🗑️ Deleted temporary file after S3 upload:', tempPdfPath);
      
      invoice.pdfPath = s3Url;
      console.log(`✅ HTML Invoice uploaded to S3: ${s3Url}`);
      console.log(`📄 File size: ${pdfBuffer.length} bytes`);
    } catch (s3Err) {
      console.error('⚠️ S3 upload failed, keeping local file:', s3Err.message);
      const localRelativePath = `/uploads/invoices/${invoiceNumber}.pdf`;
      invoice.pdfPath = localRelativePath;
      console.log(`📂 Invoice saved locally: ${localRelativePath}`);
    }
  } catch (pdfErr) {
    console.log('❌ PDF generation failed:', pdfErr.message);
    console.log('🔄 Using fallback PDF method...');
    
    // Fallback to old method if Puppeteer fails
    try {
      const PDFDocument = require('pdfkit');
      const pdfDir = path.join(__dirname, '../uploads/invoices');
      if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
      const tempPdfPath = path.join(pdfDir, `${invoiceNumber}.pdf`);
      
      const sellerName = order.sellerId?.businessName || 'Restaurant';
      const sellerType = order.sellerId?.type === 'home_chef' ? 'Home Chef' : 'Restaurant';
      const sellerGST = order.sellerId?.gstNumber || '0';
      const sellerFSSAI = order.sellerId?.fssaiLicense || '0';
      const sellerAddress = order.sellerId?.address?.fullAddress || 
        `${order.sellerId?.address?.street || ''}, ${order.sellerId?.address?.city || ''}`.trim() || 'N/A';
        
      const customerName = order.userId?.name || 'Customer';
      const customerPhone = order.userId?.phone || 'N/A';
      const customerAddress = order.deliveryAddress?.fullAddress || 
        `${order.deliveryAddress?.street || ''}, ${order.deliveryAddress?.city || ''}`.trim() || 'N/A';
        
      const orderDate = new Date(order.createdAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const stream = fs.createWriteStream(tempPdfPath);
      doc.pipe(stream);
      
      // Professional fallback PDF generation
      doc.fillColor('#E23744').rect(0, 0, doc.page.width, 120).fill();
      
      // Try to add Dabba Nation logo to fallback
      try {
        const logoPath = path.join(__dirname, '../public/assets/logo.png');
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, 50, 20, { width: 50 });
        }
      } catch (e) {
        console.log('⚠️ Could not add logo to fallback PDF');
      }

      doc.fillColor('white').fontSize(32).font('Helvetica-Bold').text('DABBA NATION', 110, 45);
      doc.fillColor('white').fontSize(14).font('Helvetica').text(`Invoice #${invoiceNumber}`, 110, 80);
      doc.fillColor('white').fontSize(12).font('Helvetica').text(`Date: ${orderDate}`, 110, 100);
      
      // Customer details
      let y = 150;
      doc.fillColor('#E23744').fontSize(14).font('Helvetica-Bold').text('Customer Details', 50, y);
      doc.fillColor('#333').fontSize(10).font('Helvetica-Bold').text('Name:', 50, y + 20);
      doc.fillColor('#666').font('Helvetica').text(customerName, 100, y + 20);
      doc.fillColor('#333').font('Helvetica-Bold').text('Phone:', 50, y + 35);
      doc.fillColor('#666').font('Helvetica').text(customerPhone, 100, y + 35);
      doc.fillColor('#333').font('Helvetica-Bold').text('Address:', 50, y + 50);
      doc.fillColor('#666').font('Helvetica').text(customerAddress, 100, y + 50, { width: 180 });
      
      // Seller details
      doc.fillColor('#E23744').fontSize(14).font('Helvetica-Bold').text(`${sellerType} Details`, 300, y);
      doc.fillColor('#333').fontSize(10).font('Helvetica-Bold').text('Name:', 300, y + 20);
      doc.fillColor('#666').font('Helvetica').text(sellerName, 350, y + 20);
      doc.fillColor('#333').font('Helvetica-Bold').text('GST:', 300, y + 35);
      doc.fillColor('#666').font('Helvetica').text(sellerGST, 350, y + 35);
      doc.fillColor('#333').font('Helvetica-Bold').text('FSSAI:', 300, y + 50);
      doc.fillColor('#666').font('Helvetica').text(sellerFSSAI, 350, y + 50);
      doc.fillColor('#333').font('Helvetica-Bold').text('Address:', 300, y + 65);
      doc.fillColor('#666').font('Helvetica').text(sellerAddress, 350, y + 65, { width: 180 });
      
      // Items table header
      y = 260;
      doc.fillColor('#f4f4f4').rect(50, y, 500, 25).fill();
      doc.fillColor('#333').fontSize(10).font('Helvetica-Bold');
      doc.text('ITEM', 60, y + 8);
      doc.text('QTY', 300, y + 8);
      doc.text('PRICE', 380, y + 8);
      doc.text('TOTAL', 480, y + 8);
      
      y += 30;
      (order.items || []).forEach((item, index) => {
        const price = Number(item.sellingPrice || item.price) || 0;
        const qty = Number(item.quantity) || 0;
        doc.fillColor('#333').font('Helvetica').fontSize(9);
        doc.text(item.name, 60, y);
        doc.text(qty.toString(), 300, y);
        doc.text(`₹${price}`, 380, y);
        doc.text(`₹${(price * qty).toFixed(2)}`, 480, y);
        y += 20;
      });
      
      // Summary
      y += 20;
      doc.rect(350, y, 200, 150).stroke('#eee');
      const summaryY = y + 10;
      const drawSummaryRow = (label, value, isTotal = false) => {
        doc.fillColor(isTotal ? '#E23744' : '#333').font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(isTotal ? 12 : 9);
        doc.text(label, 360, y + 10);
        
        // Format value to 2 decimal places if it's a number
        const formattedValue = typeof value === 'number' ? value.toFixed(2) : value;
        doc.text(`₹${formattedValue}`, 460, y + 10, { align: 'right', width: 80 });
        y += isTotal ? 25 : 18;
      };
      
      drawSummaryRow('Subtotal:', Number(order.subtotal) || 0);
      drawSummaryRow('Discount:', -(Number(order.discount) || 0));
      drawSummaryRow('Delivery Fee:', Number(order.deliveryFee) || 0);
      drawSummaryRow('GST (Food):', (Number(order.foodCgst) || 0) + (Number(order.foodSgst) || 0) + (Number(order.foodIgst) || 0));
      drawSummaryRow('GST (Delivery):', (Number(order.deliveryCgst) || 0) + (Number(order.deliverySgst) || 0) + (Number(order.deliveryIgst) || 0));
      drawSummaryRow('Platform Fee:', Number(order.platformFee) || 0);
      y += 5;
      doc.moveTo(360, y).lineTo(540, y).stroke('#eee');
      y += 10;
      drawSummaryRow('TOTAL:', order.total || 0, true);
      
      // Footer
      doc.fillColor('#E23744').fontSize(10).font('Helvetica-Bold').text('Thank you for ordering with DABBA NATION!', 50, doc.page.height - 70, { align: 'center' });
      doc.fillColor('#666').fontSize(8).font('Helvetica').text('India\'s Premier Food Delivery Platform | support@dabbanation.com', 50, doc.page.height - 55, { align: 'center' });
      
      doc.end();
      
      // Wait for PDF to finish with error handling
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
      
      let s3Url;
      try {
        console.log('☁️ Uploading fallback invoice to S3...');
        const pdfBuffer = fs.readFileSync(tempPdfPath);
        const s3File = {
          originalname: `${invoiceNumber}.pdf`,
          buffer: pdfBuffer,
          mimetype: 'application/pdf'
        };
        s3Url = await uploadToS3(s3File, 'invoices');
        
        // Delete temporary file only if S3 successful
        fs.unlinkSync(tempPdfPath);
        console.log('🗑️ Deleted temporary file after S3 upload:', tempPdfPath);
        
        invoice.pdfPath = s3Url;
        console.log(`✅ Fallback Invoice uploaded to S3: ${s3Url}`);
        console.log(`📄 File size: ${pdfBuffer.length} bytes`);
      } catch (s3Err) {
        console.error('⚠️ Fallback S3 upload failed, keeping local file:', s3Err.message);
        const localRelativePath = `/uploads/invoices/${invoiceNumber}.pdf`;
        invoice.pdfPath = localRelativePath;
        console.log(`📂 Fallback Invoice saved locally: ${localRelativePath}`);
      }
    } catch (fallbackErr) {
      console.log('❌ Fallback PDF also failed:', fallbackErr.message);
      throw new Error('Invoice generation failed completely');
    }
  }

  // ATOMIC UPDATE/INSERT to prevent duplicate key errors
  const finalInvoice = await Invoice.findOneAndUpdate(
    { orderId: order._id },
    {
      $set: {
        invoiceNumber,
        userId: order.userId,
        sellerId: order.sellerId,
        items: validatedItems,
        subtotal: Number(order.subtotal) || 0,
        tax: Number(order.gstAmount) || 0,
        deliveryFee: Number(order.deliveryFee) || 0,
        platformFee: Number(order.platformFee) || 0,
        totalAmount: Number(order.total) || 0,
        paymentStatus: order.paymentStatus || 'pending',
        pdfPath: invoice.pdfPath // Use the path set during generation
      }
    },
    { upsert: true, new: true }
  );

  console.log(`✅ Invoice saved to database: ${finalInvoice.invoiceNumber}`);
  return finalInvoice;
};
