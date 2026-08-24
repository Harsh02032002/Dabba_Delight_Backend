const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (e) {}

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/User');
const Seller = require('./models/Seller');
const Product = require('./models/Product');

const rawUri = process.env.MONGO_URI || 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0&readPreference=primary';
const MONGO_URI = rawUri.replace('%%40', '%40');

async function addDeoriaSeller() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // 1. Check if seller already exists
    let existingUser = await User.findOne({ email: 'deoria.rasoi@dabbanation.com' });
    if (!existingUser) {
      const hashedPassword = await bcrypt.hash('deoria123', 10);
      existingUser = await User.create({
        name: 'Anita Verma (Deoria Rasoi)',
        email: 'deoria.rasoi@dabbanation.com',
        password: hashedPassword,
        phone: '+919838123456',
        role: 'seller',
        isVerified: true,
      });
      console.log('✅ User created for Deoria Seller:', existingUser._id);
    } else {
      console.log('ℹ️ User already exists:', existingUser._id);
    }

    // 2. Create or update Seller in Deoria (Coords: [83.7797, 26.5024])
    let seller = await Seller.findOne({ userId: existingUser._id });
    const sellerData = {
      userId: existingUser._id,
      businessName: 'Deoria Swad Rasoi',
      type: 'home_chef',
      description: 'Authentic home-cooked UP thali, Baati Chokha, tiffin and fresh meals in Deoria.',
      phone: '+919838123456',
      email: 'deoria.rasoi@dabbanation.com',
      logo: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop',
      coverImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=400&fit=crop',
      address: {
        street: 'Station Road, Near Malviya Road',
        city: 'Deoria',
        state: 'Uttar Pradesh',
        pincode: '274001',
        fullAddress: 'Station Road, Near Malviya Road, Deoria, Uttar Pradesh - 274001',
        location: {
          type: 'Point',
          coordinates: [83.7797, 26.5024], // GeoJSON [lng, lat] for Deoria
        },
      },
      operatingHours: {
        monday: { open: '08:00', close: '22:00', isOpen: true },
        tuesday: { open: '08:00', close: '22:00', isOpen: true },
        wednesday: { open: '08:00', close: '22:00', isOpen: true },
        thursday: { open: '08:00', close: '22:00', isOpen: true },
        friday: { open: '08:00', close: '22:00', isOpen: true },
        saturday: { open: '08:00', close: '22:00', isOpen: true },
        sunday: { open: '08:00', close: '22:00', isOpen: true },
      },
      cuisines: ['North Indian', 'UP Special', 'Home Cooked', 'Thali'],
      tags: ['Home Chef', 'Veg', 'Fresh Meals', 'Tiffin Service'],
      rating: 4.9,
      totalOrders: 42,
      isActive: true,
      isVerified: true,
      kycStatus: 'verified',
    };

    if (!seller) {
      seller = await Seller.create(sellerData);
      console.log('✅ Created Deoria Seller:', seller.businessName, seller._id);
    } else {
      seller = await Seller.findByIdAndUpdate(seller._id, sellerData, { new: true });
      console.log('✅ Updated Deoria Seller:', seller.businessName, seller._id);
    }

    // Ensure 2dsphere index exists on address.location
    await Seller.collection.createIndex({ 'address.location': '2dsphere' });
    console.log('✅ 2dsphere index ensured on Seller collection');

    // 3. Create Menu Items for Deoria Swad Rasoi
    const deoriaMenu = [
      {
        name: 'Deoria Special Desi Ghee Thali',
        description: '4 Chapati, Dal Tadka, Seasonal Sabzi, Rice, Salad & Pickle cooked in pure Desi Ghee.',
        sellingPrice: 130,
        costPrice: 90,
        price: 130,
        category: 'Main Course',
        isVeg: true,
        preparationTime: 20,
        tags: ['thali', 'desi ghee', 'home style'],
        image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop',
        sellerId: seller._id,
        stock: 50,
      },
      {
        name: 'Ghar ki Baati Chokha',
        description: 'Traditional Sattu-stuffed Baati served with smoky Baingan & Tamatar Chokha and ghee.',
        sellingPrice: 150,
        costPrice: 100,
        price: 150,
        category: 'Main Course',
        isVeg: true,
        preparationTime: 25,
        tags: ['baati chokha', 'traditional', 'up special'],
        image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=600&auto=format&fit=crop',
        sellerId: seller._id,
        stock: 40,
      },
      {
        name: 'Fresh Tawa Roti (Set of 5)',
        description: 'Soft whole-wheat rotis made fresh on order.',
        sellingPrice: 35,
        costPrice: 15,
        price: 35,
        category: 'Breads',
        isVeg: true,
        preparationTime: 10,
        tags: ['roti', 'chapati'],
        image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?q=80&w=600&auto=format&fit=crop',
        sellerId: seller._id,
        stock: 100,
      }
    ];

    for (const item of deoriaMenu) {
      await Product.findOneAndUpdate(
        { name: item.name, sellerId: seller._id },
        item,
        { upsert: true, new: true }
      );
    }
    console.log('✅ Added 3 Deoria Menu items for seller:', seller.businessName);

    console.log('🎉 Successfully created Deoria Home Chef seller and menu items!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding Deoria seller:', error);
    process.exit(1);
  }
}

addDeoriaSeller();
