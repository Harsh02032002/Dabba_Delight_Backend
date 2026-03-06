// ============================================
// SEED SCRIPT — Creates admin user on first run
// Run: node seed.js
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const { Category } = require('./models/Others');

const connectDB = require('./config/db');

const seed = async () => {
  await connectDB();

  // Create admin
  const adminExists = await User.findOne({ role: 'admin' });
  if (!adminExists) {
    await User.create({
      name: 'Admin',
      email: process.env.ADMIN_EMAIL || 'admin@dabbanation.com',
      password: process.env.ADMIN_PASSWORD || 'admin123456',
      role: 'admin',
      isVerified: true,
    });
    console.log('✅ Admin user created');
    console.log(`   Email: ${process.env.ADMIN_EMAIL || 'admin@dabbanation.com'}`);
    console.log(`   Password: ${process.env.ADMIN_PASSWORD || 'admin123456'}`);
  } else {
    console.log('ℹ️  Admin user already exists');
  }

  // Create default categories
  const categories = [
    { name: 'Biryani', slug: 'biryani', icon: '🍚', sortOrder: 1 },
    { name: 'Thali', slug: 'thali', icon: '🍛', sortOrder: 2 },
    { name: 'Chinese', slug: 'chinese', icon: '🥡', sortOrder: 3 },
    { name: 'South Indian', slug: 'south-indian', icon: '🫕', sortOrder: 4 },
    { name: 'Snacks', slug: 'snacks', icon: '🍿', sortOrder: 5 },
    { name: 'Desserts', slug: 'desserts', icon: '🍰', sortOrder: 6 },
    { name: 'Beverages', slug: 'beverages', icon: '🥤', sortOrder: 7 },
    { name: 'Healthy', slug: 'healthy', icon: '🥗', sortOrder: 8 },
    { name: 'Street Food', slug: 'street-food', icon: '🌮', sortOrder: 9 },
    { name: 'Combo', slug: 'combo', icon: '🎁', sortOrder: 10 },
  ];

  for (const cat of categories) {
    await Category.findOneAndUpdate({ name: cat.name }, cat, { upsert: true });
  }
  console.log('✅ Default categories seeded');

  await mongoose.disconnect();
  console.log('🎉 Seed complete!');
  process.exit(0);
};

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
