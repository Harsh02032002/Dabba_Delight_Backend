require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./models/User');
const connectDB = require('./config/db');

async function checkAdmin() {
  try {
    await connectDB();
    console.log('✓ Connected to MongoDB');

    const admin = await User.findOne({ email: 'ad4012507@gmail.com' }).select('+password');
    
    if (!admin) {
      console.log('✗ Admin user not found');
      process.exit(1);
    }

    console.log('\n📋 Admin User Details:');
    console.log('  Email:', admin.email);
    console.log('  Name:', admin.name);
    console.log('  Role:', admin.role);
    console.log('  Password Hash:', admin.password ? '✓ Set' : '✗ Not set');
    console.log('  Is Verified:', admin.isVerified);
    console.log('  Is Blocked:', admin.isBlocked);
    console.log('  Created At:', admin.createdAt);

    // Try to compare password
    try {
      const isMatch = await admin.comparePassword('Akash@123');
      console.log('  Password Match Test:', isMatch ? '✓ PASS' : '✗ FAIL');
    } catch (err) {
      console.log('  Password Match Test:', '✗ ERROR -', err.message);
    }

    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

checkAdmin();
