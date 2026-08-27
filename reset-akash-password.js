const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/User');
const Seller = require('./models/Seller');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0';

async function resetPassword() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    let user = await User.findOne({ email: 'akash.kitchen@dabbanation.com' });
    if (!user) {
      console.log('Creating Akash Kitchen user...');
      user = new User({
        name: 'Akash Diwiedi',
        email: 'akash.kitchen@dabbanation.com',
        password: 'akash123',
        phone: '7303023539',
        role: 'seller',
        isVerified: true,
      });
      await user.save();
    } else {
      console.log('Updating Akash Kitchen password...');
      user.password = 'akash123';
      user.isVerified = true;
      user.isBlocked = false;
      await user.save();
    }

    console.log('✅ Akash Kitchen user password reset successfully!');

    // Ensure Seller profile exists & linked
    let seller = await Seller.findOne({ email: 'akash.kitchen@dabbanation.com' });
    if (!seller) {
      seller = await Seller.create({
        userId: user._id,
        businessName: 'Akash Kitchen',
        type: 'home_chef',
        description: 'Ghar jaisi khana, Deoria ki asli swad.',
        phone: '7303023539',
        email: 'akash.kitchen@dabbanation.com',
        address: {
          street: 'Deoria Khas',
          city: 'Deoria',
          state: 'Uttar Pradesh',
          pincode: '274001',
          location: { type: 'Point', coordinates: [83.7788, 26.5021] }
        },
        isActive: true,
        isVerified: true,
      });
      console.log('✅ Created Akash Kitchen Seller profile:', seller._id);
    } else {
      seller.userId = user._id;
      seller.isActive = true;
      seller.isVerified = true;
      await seller.save();
      console.log('✅ Linked Akash Kitchen Seller profile:', seller._id);
    }

    // Verify password match
    const updatedUser = await User.findOne({ email: 'akash.kitchen@dabbanation.com' }).select('+password');
    const isMatch = await updatedUser.comparePassword('akash123');
    console.log('🔐 Password verification test for akash123:', isMatch ? 'PASSED ✅' : 'FAILED ❌');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error resetting password:', err);
    process.exit(1);
  }
}

resetPassword();
