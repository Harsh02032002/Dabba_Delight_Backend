const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/User');
const Seller = require('./models/Seller');
const Product = require('./models/Product');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0&readPreference=primary';

async function fixAndSeedDeoria() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB Atlas');

    // 1. Find all existing sellers in DB to update any Deoria/UP sellers
    const allSellers = await Seller.find({});
    console.log(`📊 Found ${allSellers.length} total sellers in DB`);

    // Ensure 2dsphere index exists on Seller.address.location
    try {
      await Seller.collection.createIndex({ 'address.location': '2dsphere' });
      console.log('✅ 2dsphere index created/ensured on Seller address.location');
    } catch (e) {
      console.log('Index creation info:', e.message);
    }

    // 2. Fix or Create User for Deoria Tiffin Service / Home Chef
    let user = await User.findOne({ email: 'deoria.tiffin@dabbanation.com' });
    if (!user) {
      const hashedPassword = await bcrypt.hash('deoria123', 10);
      user = await User.create({
        name: 'Deoria Tiffin Service Owner',
        email: 'deoria.tiffin@dabbanation.com',
        password: hashedPassword,
        phone: '+919838999888',
        role: 'seller',
        isVerified: true,
      });
      console.log('✅ Created User for Deoria Tiffin Service:', user._id);
    }

    // Deoria Coordinates: Longitude 83.7797, Latitude 26.5024
    const deoriaCoords = [83.7797, 26.5024];

    // 3. Create / Update "Deoria Tiffin Service & Home Kitchen"
    let deoriaSeller = await Seller.findOne({
      $or: [
        { email: 'deoria.tiffin@dabbanation.com' },
        { businessName: { $regex: 'Deoria', $options: 'i' } },
        { 'address.city': { $regex: 'Deoria', $options: 'i' } }
      ]
    });

    const sellerPayload = {
      userId: user._id,
      businessName: 'Deoria Tiffin Service & Swad Rasoi',
      type: 'home_chef',
      description: 'Fresh & Hygienic Home-Cooked Daily Tiffin Service and UP Special Meals in Deoria.',
      phone: '+919838999888',
      email: 'deoria.tiffin@dabbanation.com',
      logo: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop',
      coverImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=400&fit=crop',
      address: {
        street: 'Station Road, Near Civil Lines',
        city: 'Deoria',
        state: 'Uttar Pradesh',
        pincode: '274001',
        fullAddress: 'Station Road, Near Civil Lines, Deoria, Uttar Pradesh - 274001',
        location: {
          type: 'Point',
          coordinates: deoriaCoords,
        },
      },
      operatingHours: {
        monday: { open: '07:00', close: '22:00', isOpen: true },
        tuesday: { open: '07:00', close: '22:00', isOpen: true },
        wednesday: { open: '07:00', close: '22:00', isOpen: true },
        thursday: { open: '07:00', close: '22:00', isOpen: true },
        friday: { open: '07:00', close: '22:00', isOpen: true },
        saturday: { open: '07:00', close: '22:00', isOpen: true },
        sunday: { open: '07:00', close: '22:00', isOpen: true },
      },
      cuisines: ['North Indian', 'UP Special', 'Tiffin Service', 'Home Cooked'],
      tags: ['Tiffin Service', 'Home Chef', 'Veg', 'Fresh Meals', 'Daily Subscriptions'],
      rating: 4.9,
      totalOrders: 85,
      isActive: true,
      isVerified: true,
      kycStatus: 'verified',
    };

    if (!deoriaSeller) {
      deoriaSeller = await Seller.create(sellerPayload);
      console.log('✅ Created Deoria Tiffin Service Seller:', deoriaSeller._id);
    } else {
      deoriaSeller = await Seller.findByIdAndUpdate(deoriaSeller._id, sellerPayload, { new: true });
      console.log('✅ Updated Deoria Tiffin Service Seller:', deoriaSeller._id);
    }

    // Also update any existing sellers in DB that have city "Deoria" or address containing "Deoria"
    await Seller.updateMany(
      {
        $or: [
          { 'address.city': { $regex: 'Deoria', $options: 'i' } },
          { 'address.fullAddress': { $regex: 'Deoria', $options: 'i' } }
        ]
      },
      {
        $set: {
          isActive: true,
          isVerified: true,
          kycStatus: 'verified',
          'address.location': { type: 'Point', coordinates: deoriaCoords },
          'address.city': 'Deoria',
          'address.state': 'Uttar Pradesh',
        }
      }
    );
    console.log('✅ Activated and set exact coordinates for all Deoria sellers');

    // 4. Create/Update Menu Items for Deoria Seller with status='published' & isAdminApproved=true
    const menuItems = [
      {
        name: 'Deoria Special Daily Tiffin Thali',
        description: '4 Chapati, Dal Tadka, Seasonal Sabzi, Basmati Rice, Salad & Pickle cooked in Desi Ghee.',
        sellingPrice: 120,
        costPrice: 80,
        price: 120,
        category: 'Main Course',
        isVeg: true,
        isAvailable: true,
        status: 'published',
        isAdminApproved: true,
        preparationTime: 20,
        tags: ['tiffin', 'thali', 'home style', 'desi ghee'],
        image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop',
        sellerId: deoriaSeller._id,
        stock: 100,
      },
      {
        name: 'UP Special Baati Chokha Meal',
        description: 'Sattu-stuffed Baati (2 Pcs) served with smoky Baingan-Tamatar Chokha and pure ghee.',
        sellingPrice: 140,
        costPrice: 90,
        price: 140,
        category: 'Main Course',
        isVeg: true,
        isAvailable: true,
        status: 'published',
        isAdminApproved: true,
        preparationTime: 25,
        tags: ['baati chokha', 'up special', 'tiffin'],
        image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=600&auto=format&fit=crop',
        sellerId: deoriaSeller._id,
        stock: 50,
      },
      {
        name: 'Home Style Paneer Sabzi & Paratha Combo',
        description: 'Paneer Masala + 2 Butter Parathas + Salad.',
        sellingPrice: 160,
        costPrice: 100,
        price: 160,
        category: 'Main Course',
        isVeg: true,
        isAvailable: true,
        status: 'published',
        isAdminApproved: true,
        preparationTime: 20,
        tags: ['paneer', 'paratha', 'combo'],
        image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc0?q=80&w=600&auto=format&fit=crop',
        sellerId: deoriaSeller._id,
        stock: 60,
      },
      {
        name: 'Fresh Tawa Roti (Set of 5)',
        description: 'Soft whole wheat rotis made fresh on tawa.',
        sellingPrice: 35,
        costPrice: 15,
        price: 35,
        category: 'Breads',
        isVeg: true,
        isAvailable: true,
        status: 'published',
        isAdminApproved: true,
        preparationTime: 10,
        tags: ['roti', 'chapati'],
        image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?q=80&w=600&auto=format&fit=crop',
        sellerId: deoriaSeller._id,
        stock: 200,
      }
    ];

    for (const item of menuItems) {
      await Product.findOneAndUpdate(
        { name: item.name, sellerId: deoriaSeller._id },
        item,
        { upsert: true, new: true }
      );
    }
    console.log(`✅ Seeded ${menuItems.length} published & approved menu items for Deoria Seller!`);

    // Ensure all products for Deoria sellers are approved and published
    await Product.updateMany(
      { sellerId: deoriaSeller._id },
      { $set: { isAdminApproved: true, status: 'published', isAvailable: true, isDeleted: false } }
    );
    console.log('✅ Approved & published all products for Deoria seller');

    console.log('\n🎉 ALL DEORIA SELLERS & MENUS ARE NOW LIVE & VERIFIED!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error fixing Deoria sellers:', err);
    process.exit(1);
  }
}

fixAndSeedDeoria();
