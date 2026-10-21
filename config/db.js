const mongoose = require('mongoose');
const dns =require("dns");
// If Node is using a local resolver (127.0.0.1) that is not responding,
// SRV lookups (used by mongodb+srv) will fail with ECONNREFUSED.
// Fall back to public DNS servers so the driver can resolve Atlas SRV records.
const currentServers = dns.getServers();
if (currentServers && currentServers.includes("127.0.0.1")) {
  console.warn(
    "Local DNS server 127.0.0.1 detected — switching to public DNS for SRV lookups",
  );
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

const connectDB = async () => {
  try {
    // Check if MONGO_URI is defined
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) throw new Error('MONGO_URI is not set');

    console.log('🔗 Connecting to MongoDB...');
    
    // Optimized connection options for better performance
    const conn = await mongoose.connect(mongoUri, {
      maxPoolSize: 20,              // Connection pool for concurrent requests
      serverSelectionTimeoutMS: 5000,  // Timeout for server selection
      socketTimeoutMS: 45000,       // Socket timeout
      connectTimeoutMS: 10000,      // Connection timeout
      minPoolSize: 5,               // Minimum connections in pool
      maxIdleTimeMS: 30000,         // Max idle time before closing connection
      waitQueueTimeoutMS: 5000,       // Queue timeout
      // Performance optimizations
      readPreference: 'primary',  // Must be 'primary' for transactions to work
    });
    
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
    console.log('🗄️  Database:', conn.connection.name);
    console.log(`📊 Connection Pool Size: ${conn.connection.getClient().options.maxPoolSize}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err.message);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️  MongoDB disconnected. Will attempt to reconnect...');
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });
    
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    console.error('Full error:', err);
    // Don't exit, let server start without DB for now
    console.log('⚠️  Starting server without database...');
  }
};

module.exports = connectDB;
