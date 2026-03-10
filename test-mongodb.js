const mongoose = require('mongoose');

// Test MongoDB connection
async function testConnection() {
  try {
    console.log('🔍 Testing MongoDB connection...');
    
    // Try different connection strings
    const connectionStrings = [
      'mongodb://localhost:27017/dabba-nation',
      'mongodb://127.0.0.1:27017/dabba-nation',
      'mongodb://localhost:27017/test',
      'mongodb://127.0.0.1:27017/test'
    ];
    
    for (const uri of connectionStrings) {
      try {
        console.log(`🔗 Trying: ${uri}`);
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS: 3000,
          connectTimeoutMS: 3000
        });
        
        console.log('✅ Connected successfully!');
        
        // Test basic operations
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        console.log(`📊 Found ${collections.length} collections`);
        
        await mongoose.disconnect();
        console.log('🔌 Disconnected');
        return true;
      } catch (error) {
        console.log(`❌ Failed: ${error.message}`);
        await mongoose.disconnect();
      }
    }
    
    console.log('💡 MongoDB is not running or not accessible');
    console.log('📝 Please ensure MongoDB is installed and running');
    console.log('🔧 You can install MongoDB from: https://www.mongodb.com/try/download/community');
    
    return false;
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    return false;
  }
}

testConnection().then(success => {
  if (success) {
    console.log('🎉 MongoDB is ready for seeding!');
  } else {
    console.log('⚠️ Please start MongoDB before running the seed script');
  }
  process.exit(success ? 0 : 1);
});
