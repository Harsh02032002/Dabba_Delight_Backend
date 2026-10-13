const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (e) {}

const path = require('path');
const fs = require('fs');

// ─── Crash guard for harmless Windows temp-file locks ───
// Puppeteer/Chrome profile cleanup can reject with EBUSY/EPERM after the PDF is
// already generated. Don't let that kill the whole API server.
const isHarmlessTempLockError = (err) =>
  !!err &&
  ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(err.code) &&
  /puppeteer|chrome|dn-invoice-chrome|lockfile/i.test(String(err.path || err.message || ''));

process.on('unhandledRejection', (reason) => {
  if (isHarmlessTempLockError(reason)) {
    console.warn(`⚠️ Ignored temp-file lock error (${reason.code}): ${reason.path || reason.message}`);
    return;
  }
  // Preserve Node's default behaviour for real bugs
  throw reason;
});

const envPath = path.join(__dirname, '.env');

try {
  const qrSrc = 'C:/Users/HP/.gemini/antigravity-ide/brain/6f714bfc-f825-4f15-8599-fadbf2129b3b/media__1787561050571.jpg';
  if (fs.existsSync(qrSrc)) {
    const targets = [
      path.join(__dirname, '../DabbaExpoApp/assets/images/payment_qr.jpg'),
      path.join(__dirname, '../dabba-delights/dabba-delights/public/payment_qr.jpg'),
      path.join(__dirname, 'public/payment_qr.jpg'),
      path.join(__dirname, 'uploads/payment_qr.jpg')
    ];
    targets.forEach(target => {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(qrSrc, target);
    });

    const imgData = fs.readFileSync(qrSrc);
    const base64Str = `data:image/jpeg;base64,${imgData.toString('base64')}`;
    const tsContent = `export const QR_CODE_BASE64 = "${base64Str}";\nexport const QR_CODE_UPI = "phonepe://pay?pa=AKASHDIWIVEDI@upi&pn=AKASH%20DIWIVEDI";\nexport const PAYMENT_QR_DATA = {\n  payeeName: "AKASH DIWIVEDI",\n  upiId: "AKASHDIWIVEDI@upi",\n  qrImage: "${base64Str}"\n};\n`;

    const expoAssetsDir = path.join(__dirname, '../DabbaExpoApp/src/assets');
    if (!fs.existsSync(expoAssetsDir)) fs.mkdirSync(expoAssetsDir, { recursive: true });
    fs.writeFileSync(path.join(expoAssetsDir, 'qrCodeData.ts'), tsContent);

    const webAssetsDir = path.join(__dirname, '../dabba-delights/dabba-delights/src/assets');
    if (!fs.existsSync(webAssetsDir)) fs.mkdirSync(webAssetsDir, { recursive: true });
    fs.writeFileSync(path.join(webAssetsDir, 'qrCodeData.ts'), tsContent);
    console.log('✅ QR Image copied and base64 helper generated!');
  }
} catch (e) {
  console.error('QR Setup error:', e.message);
}

console.log('🔧 Loading environment from:', envPath);
console.log('📁 .env file exists:', fs.existsSync(envPath));

require('dotenv').config({ path: envPath });

// Debug: Check if dotenv loaded variables
console.log('🔍 Debug - EMAIL_USER after dotenv:', process.env.EMAIL_USER);
console.log('🔍 Debug - EMAIL_PASS after dotenv:', process.env.EMAIL_PASS ? 'SET' : 'UNDEFINED');
console.log('🔍 Debug - JWT_SECRET after dotenv:', process.env.JWT_SECRET ? 'SET' : 'UNDEFINED');

// Additional check for specific variables
if (!process.env.JWT_SECRET && fs.existsSync(envPath)) {
  try {
    const c = fs.readFileSync(envPath, 'utf8');
    const m = c && c.match(/JWT_SECRET\s*=\s*([^\r\n#]+)/);
    if (m) process.env.JWT_SECRET = m[1].trim();
  } catch (error) {
    console.error('❌ Error reading JWT_SECRET:', error.message);
  }
}

// Additional check for specific variables
if (!process.env.JWT_SECRET && fs.existsSync(envPath)) {
  try {
    const c = fs.readFileSync(envPath, 'utf8');
    const m = c && c.match(/JWT_SECRET\s*=\s*([^\r\n#]+)/);
    if (m) process.env.JWT_SECRET = m[1].trim();
  } catch (error) {
    console.error('❌ Error reading JWT_SECRET:', error.message);
  }
}

// Set fallback values from memory if not loaded
if (!process.env.MONGO_URI) {
  process.env.MONGO_URI = 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0&readPreference=primary';
  console.log('🔄 Using fallback MONGO_URI');
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'QWEWRWETWQEIUTIOEKALDJGAADSKGLJASDKLGJIOETU';
  console.log('🔄 Using fallback JWT_SECRET');
}

if (!process.env.RAZORPAY_KEY_ID) {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_RDG5JVvoKELSk0';
  console.log('🔄 Using fallback RAZORPAY_KEY_ID');
}

if (!process.env.RAZORPAY_KEY_SECRET) {
  process.env.RAZORPAY_KEY_SECRET = 'N5tamdzyBKMT2E1M2TVR01PT';
  console.log('🔄 Using fallback RAZORPAY_KEY_SECRET');
}

if (!process.env.FRONTEND_URL) {
  process.env.FRONTEND_URL = 'http://localhost:8080';
  console.log('🔄 Using fallback FRONTEND_URL');
}

// Cloudinary fallbacks (needed when .env not present on production server)
if (!process.env.CLOUDINARY_CLOUD_NAME) {
  process.env.CLOUDINARY_CLOUD_NAME = 'dnagpw02j';
  console.log('🔄 Using fallback CLOUDINARY_CLOUD_NAME');
}

if (!process.env.CLOUDINARY_API_KEY) {
  process.env.CLOUDINARY_API_KEY = '877691165821265';
  console.log('🔄 Using fallback CLOUDINARY_API_KEY');
}

if (!process.env.CLOUDINARY_API_SECRET) {
  process.env.CLOUDINARY_API_SECRET = '6tlAylPl-wxPCwa93RPsDDRk7WM';
  console.log('🔄 Using fallback CLOUDINARY_API_SECRET');
}

if (!process.env.BACKEND_URL) {
  process.env.BACKEND_URL = process.env.NODE_ENV === 'production' ? 'https://api.dabbanation.in' : `http://localhost:${process.env.PORT || 5000}`;
  console.log('🔄 Using fallback BACKEND_URL:', process.env.BACKEND_URL);
}

if (!process.env.JWT_SECRET && fs.existsSync(envPath)) {
  try {
    const v = fs.readFileSync(envPath, 'utf8').match(/JWT_SECRET\s*=\s*([^\r\n#]+)/)?.[1]?.trim();
    if (v) process.env.JWT_SECRET = v;
  } catch (_) {}
}

const express = require('express');
const cors = require('cors');
const compression = require('compression'); // Response compression
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');

const app = express();
const server = http.createServer(app);

// ─── Compression Middleware (GZIP) ─────────────────
app.use(compression({
  level: 6, // Compression level (1-9, 6 is good balance)
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress responses with no content
    if (req.headers['x-no-compression']) return false;
    // Compress JSON and text responses
    return compression.filter(req, res);
  }
}));

// ─── Socket.IO ──────────────────────────────────────
// ─── Socket.IO Normalization (handle /api/socket.io & /socket.io) ────
server.prependListener('request', (req, res) => {
  if (req.url && req.url.startsWith('/api/socket.io')) {
    req.url = req.url.replace('/api/socket.io', '/socket.io');
  }
});
server.prependListener('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/api/socket.io')) {
    req.url = req.url.replace('/api/socket.io', '/socket.io');
  }
});

// ─── Socket.IO ──────────────────────────────────────
const io = new Server(server, {
  cors: { 
    origin: '*', 
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 25000,
});

// Socket authentication middleware (uses same JWT_SECRET as auth/partner login)
const { getJwtSecret } = require('./utils/jwt');
const { DeliveryPartner } = require('./models/Others');
const Order = require('./models/Order');
const User = require('./models/User');

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      console.log('⚠️ Socket connected without token — guest mode');
      socket.userRole = 'guest';
      return next();
    }

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, getJwtSecret());
    socket.userId = (decoded.id || decoded._id || '').toString();
    socket.userEmail = decoded.email || '';
    socket.userRole = decoded.role;

    // If role missing in token, fetch from DB
    if (!socket.userRole && socket.userId) {
      const u = await User.findById(socket.userId).select('role email').lean();
      if (u) {
        socket.userRole = u.role || 'user';
        socket.userEmail = socket.userEmail || u.email;
      } else {
        socket.userRole = 'user';
      }
    }

    console.log(`✅ Socket authenticated: ${socket.userEmail || socket.userId} (${socket.userRole})`);
    next();
  } catch (err) {
    console.error('⚠️ Socket auth token invalid, continuing as guest:', err.message);
    socket.authError = err.message;
    socket.userRole = 'guest';
    next();
  }
});

const SellerModel = require('./models/Seller');

/** Whether this socket may see live data for an order (owner, assigned rider, its seller, admin) */
const canAccessOrder = (socket, order) => {
  if (!socket.userId || !order) return false;
  if (socket.userRole === 'admin') return true;
  const ownerId = order.userId?._id || order.userId;
  if (ownerId && String(ownerId) === socket.userId) return true;
  const riderId = order.deliveryPartnerId?._id || order.deliveryPartnerId;
  if (socket.deliveryPartnerId && riderId && String(riderId) === socket.deliveryPartnerId) return true;
  const sellerId = order.sellerId?._id || order.sellerId;
  if (socket.sellerId && sellerId && String(sellerId) === socket.sellerId) return true;
  return false;
};

const joinSellerRoom = async (socket) => {
  if (socket.userRole !== 'seller' || !socket.userId) return null;
  if (!socket.sellerId) {
    const seller = await SellerModel.findOne({ userId: socket.userId }).select('_id').lean();
    if (!seller) return null;
    socket.sellerId = seller._id.toString();
  }
  socket.join(`seller_${socket.sellerId}`);
  return socket.sellerId;
};

io.on('connection', async (socket) => {
  console.log(`✅ Socket connected: ${socket.id} | User: ${socket.userId || 'guest'} | Role: ${socket.userRole}`);

  // Auto-join personal rooms
  if (socket.userId) {
    socket.join(`user_${socket.userId}`);
    socket.join(`partner_${socket.userId}`);
    socket.join(`delivery_partner_${socket.userId}`);

    // If partner, also join by DeliveryPartner _id
    if (socket.userRole === 'delivery') {
      socket.join('delivery_partners');
      try {
        const dp = await DeliveryPartner.findOne({ userId: socket.userId });
        if (dp) {
          socket.deliveryPartnerId = dp._id.toString();
          socket.join(`delivery_partner_${dp._id}`);
          socket.join(`partner_${dp._id}`);
        }
      } catch (e) {}
    }

    if (socket.userRole === 'seller') {
      try { await joinSellerRoom(socket); } catch (e) {}
    }

    if (socket.userRole === 'admin') socket.join('admins');
  }

  // Seller web dashboard asks to join its restaurant room
  socket.on('join_seller_room', async () => {
    try {
      const sellerId = await joinSellerRoom(socket);
      if (sellerId) console.log(`🏪 Socket ${socket.id} joined seller room: seller_${sellerId}`);
    } catch (e) {}
  });

  // Only rooms the socket is entitled to: its own personal rooms or an order it can access
  socket.on('join_room', async (room) => {
    if (typeof room !== 'string') return;
    if (socket.rooms.has(room)) return;
    const match = room.match(/^order_([a-f0-9]{24})$/i);
    if (!match) {
      console.log(`🚫 Socket ${socket.id} denied room: ${room}`);
      return;
    }
    try {
      const order = await Order.findById(match[1]).select('userId sellerId deliveryPartnerId').lean();
      if (!canAccessOrder(socket, order)) {
        console.log(`🚫 Socket ${socket.id} denied room: ${room}`);
        return;
      }
      socket.join(room);
      console.log(`📱 Socket ${socket.id} joined room: ${room}`);
    } catch (e) {}
  });
  
  socket.on('leave_room', (room) => {
    socket.leave(room);
    console.log(`📱 Socket ${socket.id} left room: ${room}`);
  });

  // ─── Delivery Partner Events ──────────────────────────
  socket.on('partnerOnline', async () => {
    console.log(`🛵 Partner went online: ${socket.userId}`);
    if (socket.userId) {
      await DeliveryPartner.findOneAndUpdate({ userId: socket.userId }, { isOnline: true, isAvailable: true }).catch(() => {});
    }
    io.to('admins').emit('partnerStatusUpdate', {
      partnerId: socket.userId,
      status: 'online',
    });
  });

  socket.on('partnerOffline', async () => {
    console.log(`🛵 Partner went offline: ${socket.userId}`);
    if (socket.userId) {
      await DeliveryPartner.findOneAndUpdate({ userId: socket.userId }, { isOnline: false, isAvailable: false }).catch(() => {});
    }
    io.to('admins').emit('partnerStatusUpdate', {
      partnerId: socket.userId,
      status: 'offline',
    });
  });

  // Rider sends GPS location
  socket.on('locationUpdate', async (data) => {
    const lat = Number(data?.lat ?? data?.latitude);
    const lng = Number(data?.lng ?? data?.longitude);
    const orderId = data?.orderId;

    if (!isNaN(lat) && !isNaN(lng) && socket.userId) {
      try {
        const partner = await DeliveryPartner.findOneAndUpdate(
          { userId: socket.userId },
          { 
            $set: { 
              'currentLocation.type': 'Point',
              'currentLocation.coordinates': [lng, lat]
            } 
          },
          { new: true }
        );

        const targetOrderId = orderId || partner?.activeOrderId;
        if (targetOrderId && partner) {
          // Only relay the location for an order this rider is actually delivering
          const ord = await Order.findOne({ _id: targetOrderId, deliveryPartnerId: partner._id }).select('userId status').lean();
          if (ord && !['delivered', 'cancelled'].includes(ord.status)) {
            const payload = {
              orderId: targetOrderId,
              partnerId: partner._id,
              lat,
              lng,
              timestamp: new Date()
            };
            io.to(`order_${targetOrderId}`).emit('delivery_location_update', payload);
            io.to(`user_${ord.userId}`).emit('delivery_location_update', payload);
          }
        }
      } catch (err) {
        console.error('Error in locationUpdate handler:', err.message);
      }
    }

    // Live rider positions are visible to admins only
    io.to('admins').emit('partnerLocationUpdate', {
      partnerId: socket.userId,
      lat,
      lng,
      timestamp: new Date()
    });
  });

  // Rider app echoes status changes here after the REST call succeeds.
  // The REST endpoints persist, validate and broadcast; this event must never change order state.
  socket.on('orderStatusUpdate', (data) => {
    const { orderId, status } = data || {};
    if (orderId && status) {
      console.log(`📦 orderStatusUpdate (informational): Order ${orderId} -> ${status}`);
    }
  });

  // ─── Customer Live Tracking Events ────────────────────
  socket.on('trackOrder', async (data) => {
    const orderId = data?.orderId;
    if (!orderId) return;

    try {
      const order = await Order.findById(orderId)
        .populate('sellerId', 'businessName address phone')
        .populate('deliveryPartnerId', 'name phone vehicleType currentLocation rating');

      if (!order) {
        return socket.emit('track_order_error', { message: 'Order not found' });
      }

      // Authorization: owner, assigned rider, the order's seller, or admin
      if (!canAccessOrder(socket, order)) {
        return socket.emit('track_order_error', { orderId, message: 'Unauthorized to track this order' });
      }

      socket.join(`order_${orderId}`);
      console.log(`📱 Socket ${socket.id} joined order tracking room: order_${orderId}`);

      // Immediately send current tracking coordinates
      let riderLocation = null;
      let riderInfo = null;

      if (order.deliveryPartnerId) {
        const dp = order.deliveryPartnerId;
        if (dp.currentLocation?.coordinates && Array.isArray(dp.currentLocation.coordinates) && dp.currentLocation.coordinates.length === 2) {
          riderLocation = {
            lat: dp.currentLocation.coordinates[1],
            lng: dp.currentLocation.coordinates[0],
          };
        }
        riderInfo = {
          name: dp.name || 'Delivery Partner',
          phone: dp.phone,
          vehicleType: dp.vehicleType || 'bike',
          rating: dp.rating || 5.0,
        };
      }

      const pickupCoords = order.pickupLocation?.coordinates || order.sellerId?.address?.location?.coordinates || [77.2090, 28.6139];
      const dropCoords = order.dropLocation?.coordinates || order.deliveryAddress?.location?.coordinates || [77.2190, 28.6229];

      socket.emit('track_order_init', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        deliveryStatus: order.deliveryStatus || null,
        restaurantName: order.sellerId?.businessName || 'Restaurant',
        pickupCoords: { lat: pickupCoords[1], lng: pickupCoords[0] },
        dropCoords: { lat: dropCoords[1], lng: dropCoords[0] },
        riderLocation,
        riderInfo,
      });
    } catch (err) {
      console.error('Error handling trackOrder:', err.message);
    }
  });

  socket.on('untrackOrder', (data) => {
    if (data?.orderId) {
      socket.leave(`order_${data.orderId}`);
      console.log(`📱 Socket ${socket.id} left order tracking room: order_${data.orderId}`);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`❌ Socket disconnected: ${socket.id} (User: ${socket.userId || 'guest'}) | Reason: ${reason}`);
    if (socket.userId && socket.userRole === 'delivery') {
      io.to('admins').emit('partnerStatusUpdate', {
        partnerId: socket.userId, 
        status: 'offline',
      });
    }
  });

  socket.on('error', (err) => {
    console.error(`❌ Socket error (${socket.id}):`, err);
  });
});

// Make io accessible in routes
app.set('io', io);

// ─── Middleware ──────────────────────────────────────
// Enable flexible CORS for local development and production
app.use(cors({ 
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-requested-with", "x-user-id"],
}));

// Handle preflight requests explicitly
app.options("*", cors({
  origin: true,
  credentials: true,
}));

// ─── PUBLIC ROUTES (Must be before other routes) ─────
const publicCtrl = require('./controllers/public.controller');
app.get('/api/public/gst-settings', publicCtrl.getPublicGSTSettings);
app.get('/api/public/platform-config', publicCtrl.getPublicPlatformConfig);

// Request logging for performance monitoring
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Body parsing middleware
const jsonParser = express.json({ limit: '10mb' });
const urlencodedParser = express.urlencoded({ extended: true });

// Routes that need file upload (no JSON parsing)
app.use('/api/subscriptions', (req, res, next) => {
  console.log('=== SUBSCRIPTION ROUTE HIT ===');
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  console.log('Content-Type:', req.headers['content-type']);
  
  // Apply JSON parser for non-file-upload requests
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next();
  }
  jsonParser(req, res, next);
}, require('./routes/subscription.routes'));

// Body parsing middleware for other routes
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next();
  }
  jsonParser(req, res, next);
});

app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next();
  }
  urlencodedParser(req, res, next);
});

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// ─── Connect Database ───────────────────────────────
connectDB();

// ─── Routes ─────────────────────────────────────────
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/user', require('./routes/user.routes'));
app.use('/api/user/orders', require('./routes/order.routes'));
app.use('/api/user/wishlist', require('./routes/wishlist.routes'));
app.use('/api/user/notifications', require('./routes/notification.routes'));
app.use('/api/search', require('./routes/search.routes'));
app.use('/api/products', require('./routes/product.routes'));
app.use('/api/invoice', require('./routes/invoice.routes'));
app.use('/api/payment', require('./routes/payment.routes'));
app.use('/api/delivery', require('./routes/delivery.routes'));
app.use('/api/partner', require('./routes/partner.routes'));
app.use('/api/order', require('./routes/partner.routes'));
app.use('/api/seller', require('./routes/seller.routes'));
app.use('/api/seller/profile', require('./routes/seller.profile.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/admin', require('./routes/warehouse.routes'));
app.use('/api/wallet', require('./routes/wallet.routes'));
app.use('/api', require('./routes/seed.routes'));

// ─── Health Check ───────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Dabba Nation API is running', timestamp: new Date() });
});

// ─── Error Handler ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// ─── Start Server ───────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dabba Nation server running on port ${PORT}`);
  console.log('✅ Invoice System v2.0 (Forced Regeneration) active');
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
});
