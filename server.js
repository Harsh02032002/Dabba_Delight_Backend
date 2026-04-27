const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');

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
const io = new Server(server, {
  cors: { 
    origin: ['http://localhost:8081', 'http://localhost:8082', 'http://localhost:8080', 'http://localhost:5173','http://56.228.4.127', 'http://13.62.196.51'], 
    methods: ['GET', 'POST'] 
  },
});

// Socket authentication middleware (uses same JWT_SECRET as auth/partner login)
const { getJwtSecret } = require('./utils/jwt');
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      console.log('❌ Socket auth: No token provided');
      return next(new Error('Authentication error: No token provided'));
    }

    console.log('🔐 Socket auth: Verifying token...');
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, getJwtSecret());
    
    // Attach user info to socket
    socket.userId = decoded.id;
    socket.userEmail = decoded.email;
    socket.userRole = decoded.role;
    
    console.log(`✅ Socket authenticated: ${socket.userEmail} (${socket.userRole})`);
    next();
  } catch (err) {
    console.error('❌ Socket authentication error:', err.message);
    console.log('🔑 Token being verified:', socket.handshake.auth.token?.substring(0, 20) + '...');
    
    // Don't block connection entirely, just mark as unauthenticated
    socket.authenticated = false;
    socket.authError = err.message;
    next();
  }
});

io.on('connection', (socket) => {
  // Check if authentication was successful
  if (socket.authError) {
    console.log(`❌ Socket ${socket.id} connected but not authenticated: ${socket.authError}`);
    // Allow connection but limit functionality
    socket.emit('auth_error', { message: socket.authError });
    return;
  }

  console.log('✅ Socket connected:', socket.id, 'User:', socket.userEmail, 'Role:', socket.userRole);

  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`📱 Socket ${socket.id} joined room: ${room}`);
  });
  
  socket.on('leave_room', (room) => {
    socket.leave(room);
    console.log(`📱 Socket ${socket.id} left room: ${room}`);
  });

  // Delivery partner specific events (only for authenticated users)
  if (socket.userRole === 'delivery') {
    socket.on('partnerOnline', () => {
      console.log(`🛵 Partner ${socket.userEmail} went online`);
      socket.broadcast.emit('partnerStatusUpdate', { 
        partnerId: socket.userId, 
        status: 'online',
        email: socket.userEmail
      });
    });

    socket.on('partnerOffline', () => {
      console.log(`🛵 Partner ${socket.userEmail} went offline`);
      socket.broadcast.emit('partnerStatusUpdate', { 
        partnerId: socket.userId, 
        status: 'offline',
        email: socket.userEmail
      });
    });

    socket.on('locationUpdate', (data) => {
      console.log(`📍 Location update from ${socket.userEmail}:`, data);
      socket.broadcast.emit('partnerLocationUpdate', {
        partnerId: socket.userId,
        partnerEmail: socket.userEmail,
        location: data,
        timestamp: new Date()
      });
    });

    // Join partner-specific room for targeted updates
    socket.join(`partner_${socket.userId}`);
    console.log(`📱 Partner ${socket.userEmail} joined room: partner_${socket.userId}`);
  }

  // User specific events (only for authenticated users)
  if (socket.userRole === 'user') {
    socket.on('userOnline', () => {
      console.log(`👤 User ${socket.userEmail} went online`);
      socket.broadcast.emit('userStatusUpdate', { 
        userId: socket.userId, 
        status: 'online',
        email: socket.userEmail
      });
    });

    socket.on('userOffline', () => {
      console.log(`👤 User ${socket.userEmail} went offline`);
      socket.broadcast.emit('userStatusUpdate', { 
        userId: socket.userId, 
        status: 'offline',
        email: socket.userEmail
      });
    });

    socket.on('userLocationUpdate', (data) => {
      console.log(`📍 User location update from ${socket.userEmail}:`, data);
      socket.broadcast.emit('userLocationUpdate', {
        userId: socket.userId,
        userEmail: socket.userEmail,
        location: data,
        timestamp: new Date()
      });
    });

    socket.on('trackOrder', (data) => {
      console.log(`📦 User ${socket.userEmail} tracking order:`, data.orderId);
      socket.join(`order_${data.orderId}`);
      console.log(`📱 User ${socket.userEmail} joined order room: order_${data.orderId}`);
    });

    // Join user-specific room for targeted updates
    socket.join(`user_${socket.userId}`);
    console.log(`📱 User ${socket.userEmail} joined room: user_${socket.userId}`);
  }

  socket.on('disconnect', (reason) => {
    console.log('❌ Socket disconnected:', socket.id, 'User:', socket.userEmail, 'Reason:', reason);
    
    // Notify others about disconnection
    if (socket.userRole === 'delivery') {
      socket.broadcast.emit('partnerStatusUpdate', { 
        partnerId: socket.userId, 
        status: 'offline',
        email: socket.userEmail,
        reason: reason
      });
    } else if (socket.userRole === 'user') {
      socket.broadcast.emit('userStatusUpdate', { 
        userId: socket.userId, 
        status: 'offline',
        email: socket.userEmail,
        reason: reason
      });
    }
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
});

// Make io accessible in routes
app.set('io', io);

// ─── Middleware ──────────────────────────────────────
// Enable compression for CORS preflight
app.use(cors({ 
  origin: ['http://localhost:8081', 'http://localhost:8082', 'http://localhost:8080', 'http://localhost:5173', 'http://13.62.196.51'], 
  credentials: true 
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
