const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');

const app = express();
const server = http.createServer(app);

// ─── Socket.IO ──────────────────────────────────────
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join_room', (room) => socket.join(room));
  socket.on('leave_room', (room) => socket.leave(room));

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// Make io accessible in routes
app.set('io', io);

// ─── Middleware ──────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
app.use('/api/seller', require('./routes/seller.routes'));
app.use('/api/seller/profile', require('./routes/seller.profile.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/admin', require('./routes/warehouse.routes'));

// ─── Health Check ───────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Dabba Nation API is running', timestamp: new Date() });
});

// ─── Error Handler ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// ─── Start Server ───────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Dabba Nation server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
});
