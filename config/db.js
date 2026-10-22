const mongoose = require('mongoose');
const dns = require('dns');

// If Node is using a local router DNS that does not support SRV lookups,
// mongodb+srv fails with querySrv ECONNREFUSED.
// Prepend public DNS resolvers (8.8.8.8, 1.1.1.1) so Atlas SRV lookups succeed reliably.
try {
  const currentServers = dns.getServers();
  const hasPublic = currentServers && currentServers.some(s => s === '8.8.8.8' || s === '1.1.1.1');
  if (!hasPublic) {
    dns.setServers(['8.8.8.8', '1.1.1.1', ...(currentServers || [])]);
  }
} catch (e) {
  // Ignore DNS config failure if restricted in environment
}

/**
 * Sanitizes and repairs common MONGO_URI formatting errors:
 * - Strips surrounding quotes
 * - Automatically percent-encodes literal '@' in password to '%40'
 * - Repairs malformed percent-encoding (e.g. '%' not followed by 2 hex digits)
 */
function sanitizeMongoUri(rawUri) {
  if (!rawUri || typeof rawUri !== 'string') return rawUri;
  let uri = rawUri.trim();
  if ((uri.startsWith('"') && uri.endsWith('"')) || (uri.startsWith("'") && uri.endsWith("'"))) {
    uri = uri.slice(1, -1).trim();
  }

  const protocolIndex = uri.indexOf('://');
  const lastAtIndex = uri.lastIndexOf('@');
  if (protocolIndex !== -1 && lastAtIndex > protocolIndex) {
    const prefix = uri.slice(0, protocolIndex + 3);
    const userinfo = uri.slice(protocolIndex + 3, lastAtIndex);
    const suffix = uri.slice(lastAtIndex);
    
    const colonIndex = userinfo.indexOf(':');
    if (colonIndex !== -1) {
      let username = userinfo.slice(0, colonIndex);
      let password = userinfo.slice(colonIndex + 1);

      // If password contains literal '@', encode it as %40
      password = password.replace(/@/g, '%40');

      // Fix any invalid % encoding in username or password
      // (a % not followed by two hex digits is replaced with %25)
      const fixEncoding = (str) => str.replace(/%(?![0-9a-fA-F]{2})/g, '%25');

      try {
        decodeURIComponent(username);
      } catch (_) {
        username = fixEncoding(username);
      }

      try {
        decodeURIComponent(password);
      } catch (_) {
        password = fixEncoding(password);
      }

      return `${prefix}${username}:${password}${suffix}`;
    }
  }
  return uri;
}

const connectDB = async () => {
  try {
    // Check if MONGO_URI is defined
    const rawUri = process.env.MONGO_URI;
    if (!rawUri) throw new Error('MONGO_URI is not set');

    const mongoUri = sanitizeMongoUri(rawUri);

    console.log('🔗 Connecting to MongoDB...');
    
    // Optimized connection options for better performance
    const conn = await mongoose.connect(mongoUri, {
      maxPoolSize: 20,              // Connection pool for concurrent requests
      serverSelectionTimeoutMS: 8000,  // Timeout for server selection
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

    return conn;
  } catch (error) {
    console.error(`❌ MongoDB connection failed: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
