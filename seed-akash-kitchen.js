const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (e) {}

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/User');
const Seller = require('./models/Seller');
const Product = require('./models/Product');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0';

async function seedAkashKitchen() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // 1. Create User for Akash Kitchen
    let user = await User.findOne({ email: 'akash.kitchen@dabbanation.com' });
    if (!user) {
      const hashedPassword = await bcrypt.hash('akash123', 10);
      user = await User.create({
        name: 'Akash Diwiedi',
        email: 'akash.kitchen@dabbanation.com',
        password: hashedPassword,
        phone: '+917303023539',
        role: 'seller',
        isVerified: true,
      });
      console.log('✅ User created:', user._id);
    } else {
      console.log('ℹ️  User already exists:', user._id);
    }

    // 2. Create / Update Seller — Akash Kitchen, Deoria
    let seller = await Seller.findOne({ email: 'akash.kitchen@dabbanation.com' });
    const sellerData = {
      userId: user._id,
      businessName: 'Akash Kitchen',
      type: 'home_chef',
      description: 'Ghar jaisi khana, Deoria ki asli swad. Fresh tiffin, thali aur homemade meals roz subah se.',
      phone: '+917303023539',
      email: 'akash.kitchen@dabbanation.com',
      logo: 'https://images.unsplash.com/photo-1567364816519-cbc9c4ffe1eb?w=400&h=400&fit=crop&q=80',
      coverImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=400&fit=crop&q=80',
      address: {
        street: 'East Shastri Nagar, Ram Gulam Tola',
        city: 'Deoria',
        state: 'Uttar Pradesh',
        pincode: '274001',
        fullAddress: 'East Shastri Nagar, Ram Gulam Tola, Deoria, Uttar Pradesh - 274001',
        location: {
          type: 'Point',
          coordinates: [83.7797, 26.5024], // [lng, lat] Deoria, UP
        },
      },
      operatingHours: {
        monday:    { open: '07:00', close: '21:00', isOpen: true },
        tuesday:   { open: '07:00', close: '21:00', isOpen: true },
        wednesday: { open: '07:00', close: '21:00', isOpen: true },
        thursday:  { open: '07:00', close: '21:00', isOpen: true },
        friday:    { open: '07:00', close: '21:00', isOpen: true },
        saturday:  { open: '07:00', close: '21:00', isOpen: true },
        sunday:    { open: '08:00', close: '20:00', isOpen: true },
      },
      cuisines: ['North Indian', 'Home Cooked', 'Tiffin', 'UP Special'],
      tags: ['Tiffin Service', 'Fresh Meals', 'Veg', 'Home Chef', 'Deoria'],
      rating: 4.8,
      totalOrders: 120,
      commissionRate: 15,
      isActive: true,
      isVerified: true,
      kycStatus: 'verified',
    };

    if (!seller) {
      seller = await Seller.create(sellerData);
      console.log('✅ Created Seller — Akash Kitchen:', seller._id);
    } else {
      seller = await Seller.findByIdAndUpdate(seller._id, sellerData, { new: true });
      console.log('✅ Updated Seller — Akash Kitchen:', seller._id);
    }

    // Ensure 2dsphere index
    await Seller.collection.createIndex({ 'address.location': '2dsphere' });
    console.log('✅ 2dsphere index ensured');

    // 3. Menu Items for Akash Kitchen
    const menu = [
      {
        name: 'Akash Special Tiffin',
        description: '4 Chapati, Dal Tadka, Sabzi, Rice, Salad & Achaar — fresh daily tiffin.',
        price: 120,
        sellingPrice: 120,
        costPrice: 75,
        category: 'Tiffin',
        isVeg: true,
        preparationTime: 20,
        tags: ['tiffin', 'daily', 'fresh'],
        image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop',
        sellerId: seller._id,
        stock: 80,
      },
      {
        name: 'Desi Ghee Thali',
        description: 'Dal, 2 Sabzi, 4 Roti, Rice, Raita, Salad — full meal in pure desi ghee.',
        price: 150,
        sellingPrice: 150,
        costPrice: 95,
        category: 'Main Course',
        isVeg: true,
        preparationTime: 25,
        tags: ['thali', 'desi ghee', 'full meal'],
        image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=600&auto=format&fit=crop',
        sellerId: seller._id,
        stock: 60,
      },
      {
        name: 'Baati Chokha',
        description: 'Traditional Sattu Baati with smoky Baingan-Tamatar Chokha and ghee.',
        price: 140,
        sellingPrice: 140,
        costPrice: 90,
        category: 'Main Course',
        isVeg: true,
        preparationTime: 30,
        tags: ['baati chokha', 'UP special', 'traditional'],
        image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=600&auto=format&fit=crop',
        sellerId: seller._id,
        stock: 40,
      },
      {
        name: 'Kadhi Chawal',
        description: 'Homemade kadhi with pakoda served with steamed rice.',
        price: 90,
        sellingPrice: 90,
        costPrice: 55,
        category: 'Main Course',
        isVeg: true,
        preparationTime: 15,
        tags: ['kadhi chawal', 'comfort food'],
        image: 'https://images.unsplash.com/photo-1596797038530-2c107229654b?q=80&w=600&auto=format&fit=crop',
        sellerId: seller._id,
        stock: 50,
      },
      {
        name: 'Puri Sabzi (6 Puri)',
        description: 'Crispy puris with aloo sabzi — perfect breakfast.',
        price: 60,
        sellingPrice: 60,
        costPrice: 35,
        category: 'Breakfast',
        isVeg: true,
        preparationTime: 10,
        tags: ['puri sabzi', 'breakfast'],
        image: 'https://images.unsplash.com/photo-1567337710282-00832b415979?q=80&w=600&auto=format&fit=crop',
        sellerId: seller._id,
        stock: 100,
      },
      {
        name: 'Kheer (Bowl)',
        description: 'Traditional rice kheer made with full-fat milk and dry fruits.',
        price: 50,
        sellingPrice: 50,
        costPrice: 30,
        category: 'Dessert',
        isVeg: true,
        preparationTime: 10,
        tags: ['kheer', 'sweet', 'dessert'],
        image: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?q=80&w=600&auto=format&fit=crop',
        sellerId: seller._id,
        stock: 60,
      },
    ];

    let added = 0;
    for (const item of menu) {
      await Product.findOneAndUpdate(
        { name: item.name, sellerId: seller._id },
        item,
        { upsert: true, new: true }
      );
      added++;
    }
    console.log(`✅ Added/Updated ${added} menu items for Akash Kitchen`);
    console.log('🎉 Done! Akash Kitchen is live in Deoria.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

seedAkashKitchen();
