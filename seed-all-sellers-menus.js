const mongoose = require('mongoose');
require('dotenv').config();

const Product = require('./models/Product');
const Seller = require('./models/Seller');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0&readPreference=primary';

const sampleHomeChefItems = [
  {
    name: 'Ghar Ki Thali (Special)',
    description: '4 Phulka Roti, Dal Fry, Seasonal Sabzi, Jeera Rice, Salad & Sweet.',
    sellingPrice: 140,
    costPrice: 90,
    category: 'Main Course',
    isVeg: true,
    preparationTime: 25,
    tags: ['thali', 'home cooked', 'healthy'],
    image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop',
    isAvailable: true,
    isAdminApproved: true,
    status: 'published',
  },
  {
    name: 'Home Style Dal Tadka',
    description: 'Authentic yellow dal tempered with desi ghee, cumin & garlic.',
    sellingPrice: 120,
    costPrice: 70,
    category: 'Main Course',
    isVeg: true,
    preparationTime: 20,
    tags: ['dal', 'healthy', 'comfort food'],
    image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop',
    isAvailable: true,
    isAdminApproved: true,
    status: 'published',
  },
  {
    name: 'Maa Ke Hath Ki Roti (4 Pcs)',
    description: 'Fresh whole wheat soft chapatis prepared fresh on order.',
    sellingPrice: 40,
    costPrice: 20,
    category: 'Breads',
    isVeg: true,
    preparationTime: 15,
    tags: ['roti', 'chapati', 'bread'],
    image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?q=80&w=600&auto=format&fit=crop',
    isAvailable: true,
    isAdminApproved: true,
    status: 'published',
  },
  {
    name: 'Homestyle Paneer Bhurji',
    description: 'Fresh cottage cheese scrambled with onions, tomatoes and green chillies.',
    sellingPrice: 180,
    costPrice: 110,
    category: 'Main Course',
    isVeg: true,
    preparationTime: 25,
    tags: ['paneer', 'veg', 'bhurji'],
    image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc0?q=80&w=600&auto=format&fit=crop',
    isAvailable: true,
    isAdminApproved: true,
    status: 'published',
  }
];

const sampleRestaurantItems = [
  {
    name: 'Paneer Butter Masala',
    description: 'Rich and creamy curry made with paneer, butter and cashew gravy.',
    sellingPrice: 240,
    costPrice: 160,
    category: 'Main Course',
    isVeg: true,
    preparationTime: 25,
    tags: ['paneer', 'curry', 'creamy'],
    image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc0?q=80&w=600&auto=format&fit=crop',
    isAvailable: true,
    isAdminApproved: true,
    status: 'published',
  },
  {
    name: 'Special Chicken Biryani',
    description: 'Fragrant basmati rice slow-cooked with tender chicken and spices.',
    sellingPrice: 280,
    costPrice: 180,
    category: 'Rice',
    isVeg: false,
    preparationTime: 35,
    tags: ['biryani', 'rice', 'chicken'],
    image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=600&auto=format&fit=crop',
    isAvailable: true,
    isAdminApproved: true,
    status: 'published',
  },
  {
    name: 'Butter Naan (2 Pcs)',
    description: 'Soft tandoori naan brushed with fresh butter.',
    sellingPrice: 60,
    costPrice: 30,
    category: 'Breads',
    isVeg: true,
    preparationTime: 12,
    tags: ['naan', 'bread', 'butter'],
    image: 'https://images.unsplash.com/photo-1606859191214-25f0a1c6a265?q=80&w=600&auto=format&fit=crop',
    isAvailable: true,
    isAdminApproved: true,
    status: 'published',
  }
];

async function seedAllSellersMenus() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const sellers = await Seller.find({ isActive: true });
    console.log(`📊 Found ${sellers.length} active sellers`);

    let totalCreated = 0;

    for (const s of sellers) {
      const existingCount = await Product.countDocuments({ sellerId: s._id, isAvailable: true, isDeleted: { $ne: true } });
      if (existingCount === 0) {
        console.log(`➕ Seeding products for seller: "${s.businessName}" (${s.type})`);
        const itemsToSeed = (s.type === 'home_chef' || s.type === 'home-chef') ? sampleHomeChefItems : sampleRestaurantItems;
        for (const item of itemsToSeed) {
          await Product.create({
            ...item,
            sellerId: s._id,
          });
          totalCreated++;
        }
      } else {
        console.log(`ℹ️ Seller "${s.businessName}" already has ${existingCount} menu products.`);
      }
    }

    console.log(`\n🎉 Seeded ${totalCreated} new menu products for active sellers!`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding all seller menus:', err);
    process.exit(1);
  }
}

seedAllSellersMenus();
