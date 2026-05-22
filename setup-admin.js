require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./models/User');
const connectDB = require('./config/db');

async function setupAdmin() {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('✓ Connected to MongoDB');

    const adminEmail = process.env.ADMIN_EMAIL || 'ad4012507@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Akash@123';
    const adminName = process.env.ADMIN_NAME || 'Admin';

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    
    if (existingAdmin) {
      if (existingAdmin.role === 'admin') {
        console.log('✓ Admin user already exists:', adminEmail);
        console.log('✓ Skipping creation to avoid duplicate');
      } else {
        // Upgrade existing user to admin
        existingAdmin.role = 'admin';
        existingAdmin.password = adminPassword;
        await existingAdmin.save();
        console.log('✓ User upgraded to admin role:', adminEmail);
      }
    } else {
      // Create new admin user
      const adminUser = new User({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        role: 'admin',
        isVerified: true, // Admin accounts should be pre-verified
        phone: '',
      });

      await adminUser.save();
      console.log('✓ Admin user created successfully!');
      console.log('  Email:', adminEmail);
      console.log('  Password: ••••••••• (stored securely)');
    }

    console.log('\n✓ Admin setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('✗ Error setting up admin:', error.message);
    process.exit(1);
  }
}

setupAdmin();
