require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./models/User');
const connectDB = require('./config/db');

async function resetAdmin() {
  try {
    await connectDB();
    console.log('✓ Connected to MongoDB');

    const adminEmail = 'ad4012507@gmail.com';

    // Delete existing admin user
    const deleted = await User.deleteOne({ email: adminEmail });
    console.log(`✓ Deleted existing admin user (if any): ${deleted.deletedCount} document(s)`);

    // Create new admin user with fresh password
    const adminUser = new User({
      name: 'Admin',
      email: adminEmail,
      password: 'Akash@123',  // Will be hashed automatically
      role: 'admin',
      isVerified: true,
      phone: '',
    });

    await adminUser.save();
    console.log('✓ Admin user created with fresh password!');

    // Verify it was saved correctly
    const saved = await User.findOne({ email: adminEmail }).select('+password');
    if (saved) {
      const isMatch = await saved.comparePassword('Akash@123');
      console.log('✓ Password verification:', isMatch ? 'PASS ✓' : 'FAIL ✗');
    }

    console.log('\n✅ Admin reset completed!');
    console.log('Email: ad4012507@gmail.com');
    console.log('Password: Akash@123');
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

resetAdmin();
