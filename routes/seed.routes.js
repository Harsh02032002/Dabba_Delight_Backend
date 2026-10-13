const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Seller = require('../models/Seller');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { DeliveryPartner } = require('../models/Others');

// Sample data for restaurants (Chandigarh & nearby within 12km of Buterla/Sector 41, plus 1 in Deoria for distant testing)
const sellersData = [
  {
    name: 'Rajesh Kumar',
    email: 'rajesh.restaurant@gmail.com',
    password: 'password123',
    phone: '+919876543210',
    role: 'seller',
    businessName: 'Rajesh Biryani House',
    type: 'restaurant',
    description: 'Authentic Hyderabadi biryanis, kebabs and Mughlai curries in Chandigarh since 2012',
    logo: 'https://images.unsplash.com/photo-1552567480-92a164e77461?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&h=400&fit=crop',
    address: {
      street: 'SCO 120, Sector 35-C Inner Market',
      city: 'Chandigarh',
      state: 'Chandigarh',
      pincode: '160035',
      location: {
        type: 'Point',
        coordinates: [76.7640, 30.7240] // ~2.3 km from Buterla
      }
    },
    operatingHours: {
      monday: { open: '11:00', close: '23:00', isOpen: true },
      tuesday: { open: '11:00', close: '23:00', isOpen: true },
      wednesday: { open: '11:00', close: '23:00', isOpen: true },
      thursday: { open: '11:00', close: '23:00', isOpen: true },
      friday: { open: '11:00', close: '23:00', isOpen: true },
      saturday: { open: '11:00', close: '23:59', isOpen: true },
      sunday: { open: '11:00', close: '23:59', isOpen: true }
    },
    cuisines: ['Biryani', 'Mughlai', 'North Indian'],
    tags: ['Biryani', 'Mughlai', 'Non-Veg', 'Best Seller'],
    rating: 4.6,
    totalOrders: 1420,
    totalRevenue: 285000,
    commissionRate: 15,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
  },
  {
    name: 'Priya Sharma',
    email: 'priya.pasta@gmail.com',
    password: 'password123',
    phone: '+919876543211',
    role: 'seller',
    businessName: "Priya's Italian Kitchen",
    type: 'restaurant',
    description: 'Authentic Italian wood-fired pizzas, handcrafted pastas and garlic breads',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: 'Booth 45, Sector 22-B Market',
      city: 'Chandigarh',
      state: 'Chandigarh',
      pincode: '160022',
      location: {
        type: 'Point',
        coordinates: [76.7720, 30.7320] // ~2.6 km from Buterla
      }
    },
    operatingHours: {
      monday: { open: '12:00', close: '22:30', isOpen: true },
      tuesday: { open: '12:00', close: '22:30', isOpen: true },
      wednesday: { open: '12:00', close: '22:30', isOpen: true },
      thursday: { open: '12:00', close: '22:30', isOpen: true },
      friday: { open: '12:00', close: '23:00', isOpen: true },
      saturday: { open: '12:00', close: '23:00', isOpen: true },
      sunday: { open: '12:00', close: '22:30', isOpen: true }
    },
    cuisines: ['Italian', 'Continental', 'Pizza'],
    tags: ['Italian', 'Pizza', 'Pasta', 'Cheese'],
    rating: 4.7,
    totalOrders: 980,
    totalRevenue: 195000,
    commissionRate: 15,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
  },
  {
    name: 'Amit Singh',
    email: 'amit.burger@gmail.com',
    password: 'password123',
    phone: '+919876543212',
    role: 'seller',
    businessName: 'Burger Point',
    type: 'restaurant',
    description: 'Juicy gourmet burgers, loaded cheesy fries, shakes and fast food',
    logo: 'https://images.unsplash.com/photo-1568901346375-23c44588b664?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565901346375-23c44588b664?w=800&h=400&fit=crop',
    address: {
      street: 'SCO 82, Sector 17 Plaza',
      city: 'Chandigarh',
      state: 'Chandigarh',
      pincode: '160017',
      location: {
        type: 'Point',
        coordinates: [76.7800, 30.7400] // ~3.5 km from Buterla
      }
    },
    operatingHours: {
      monday: { open: '10:00', close: '23:00', isOpen: true },
      tuesday: { open: '10:00', close: '23:00', isOpen: true },
      wednesday: { open: '10:00', close: '23:00', isOpen: true },
      thursday: { open: '10:00', close: '23:00', isOpen: true },
      friday: { open: '10:00', close: '23:59', isOpen: true },
      saturday: { open: '10:00', close: '23:59', isOpen: true },
      sunday: { open: '10:00', close: '23:00', isOpen: true }
    },
    cuisines: ['Burgers', 'Fast Food', 'Snacks'],
    tags: ['Burgers', 'Fries', 'Fast Food'],
    rating: 4.5,
    totalOrders: 2150,
    totalRevenue: 340000,
    commissionRate: 15,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
  },
  {
    name: 'Deepak Kumar',
    email: 'deepak.deoria@gmail.com',
    password: 'password123',
    phone: '+919876543219',
    role: 'seller',
    businessName: 'Deepak Non veg store',
    type: 'restaurant',
    description: 'Fresh chicken and mutton delicacies in Deoria UP',
    logo: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=400&fit=crop',
    address: {
      street: 'Mahuwani Chauraha',
      city: 'Deoria',
      state: 'Uttar Pradesh',
      pincode: '274001',
      location: {
        type: 'Point',
        coordinates: [83.7788, 26.5021] // ~832 km from Chandigarh (Used to test >12km filtering)
      }
    },
    operatingHours: {
      monday: { open: '10:00', close: '22:00', isOpen: true },
      tuesday: { open: '10:00', close: '22:00', isOpen: true },
      wednesday: { open: '10:00', close: '22:00', isOpen: true },
      thursday: { open: '10:00', close: '22:00', isOpen: true },
      friday: { open: '10:00', close: '22:00', isOpen: true },
      saturday: { open: '10:00', close: '22:00', isOpen: true },
      sunday: { open: '10:00', close: '22:00', isOpen: true }
    },
    cuisines: ['North Indian', 'Curry', 'Non-Veg'],
    tags: ['Mutton', 'Chicken', 'Curry'],
    rating: 4.2,
    totalOrders: 320,
    totalRevenue: 54000,
    commissionRate: 15,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
  }
];

// Sample data for home chefs (Chandigarh & Mohali within 12km)
const homeChefsData = [
  {
    name: 'Geeta Devi',
    email: 'gk5499411@gmail.com',
    password: 'password123',
    phone: '7676802874',
    role: 'seller',
    businessName: 'Geeta ki Rasoi',
    type: 'home_chef',
    description: 'Pure homestyle Punjabi thalis, dal makhani, and fresh phulkas cooked with love',
    logo: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=400&fit=crop',
    address: {
      street: 'House 142, Buterla, Sector 41-B',
      city: 'Chandigarh',
      state: 'Chandigarh',
      pincode: '160041',
      location: {
        type: 'Point',
        coordinates: [76.7460, 30.7358] // ~0.1 km from Buterla
      }
    },
    operatingHours: {
      monday: { open: '08:00', close: '22:00', isOpen: true },
      tuesday: { open: '08:00', close: '22:00', isOpen: true },
      wednesday: { open: '08:00', close: '22:00', isOpen: true },
      thursday: { open: '08:00', close: '22:00', isOpen: true },
      friday: { open: '08:00', close: '22:00', isOpen: true },
      saturday: { open: '08:00', close: '22:00', isOpen: true },
      sunday: { open: '08:00', close: '21:00', isOpen: true }
    },
    cuisines: ['Home Food', 'North Indian', 'Thali'],
    tags: ['Ghar Ka Khana', 'Pure Desi Ghee', 'Thali', 'Vegetarian'],
    rating: 4.9,
    totalOrders: 650,
    totalRevenue: 98000,
    commissionRate: 12,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
  },
  {
    name: 'Sunita Sharma',
    email: 'sunita.kitchen@gmail.com',
    password: 'password123',
    phone: '+919876543215',
    role: 'seller',
    businessName: "Sunita's Kitchen",
    type: 'home_chef',
    description: 'Homely nutritious meals, fresh sabzis, dal and rotis prepared daily in hygienic home setup',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: 'House 245, Sector 37-C',
      city: 'Chandigarh',
      state: 'Chandigarh',
      pincode: '160036',
      location: {
        type: 'Point',
        coordinates: [76.7550, 30.7420] // ~1.2 km from Buterla
      }
    },
    operatingHours: {
      monday: { open: '07:30', close: '21:30', isOpen: true },
      tuesday: { open: '07:30', close: '21:30', isOpen: true },
      wednesday: { open: '07:30', close: '21:30', isOpen: true },
      thursday: { open: '07:30', close: '21:30', isOpen: true },
      friday: { open: '07:30', close: '21:30', isOpen: true },
      saturday: { open: '07:30', close: '21:00', isOpen: true },
      sunday: { open: '07:30', close: '21:00', isOpen: true }
    },
    cuisines: ['Home Food', 'Comfort Food', 'Daily Meals'],
    tags: ['Tiffin', 'Daily Meals', 'Home Cooked', 'Vegetarian'],
    rating: 4.8,
    totalOrders: 490,
    totalRevenue: 73000,
    commissionRate: 12,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
  },
  {
    name: 'Ramesh Iyer',
    email: 'ramesh.tiffin@gmail.com',
    password: 'password123',
    phone: '+919876543216',
    role: 'seller',
    businessName: "Ramesh's Tiffin Service",
    type: 'home_chef',
    description: 'Crispy authentic South Indian dosas, soft idlis, vadas and traditional filter coffee',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: 'Phase 7, Sector 61',
      city: 'Mohali',
      state: 'Punjab',
      pincode: '160062',
      location: {
        type: 'Point',
        coordinates: [76.7170, 30.7040] // ~4.5 km from Buterla
      }
    },
    operatingHours: {
      monday: { open: '06:30', close: '21:00', isOpen: true },
      tuesday: { open: '06:30', close: '21:00', isOpen: true },
      wednesday: { open: '06:30', close: '21:00', isOpen: true },
      thursday: { open: '06:30', close: '21:00', isOpen: true },
      friday: { open: '06:30', close: '21:00', isOpen: true },
      saturday: { open: '06:30', close: '20:30', isOpen: true },
      sunday: { open: '06:30', close: '20:30', isOpen: true }
    },
    cuisines: ['South Indian', 'Tiffin', 'Breakfast'],
    tags: ['Dosa', 'Idli', 'Sambar', 'South Indian'],
    rating: 4.7,
    totalOrders: 720,
    totalRevenue: 92000,
    commissionRate: 12,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
  }
];

// Menu items mapped per business name
const sellerMenuCatalog = {
  'Geeta ki Rasoi': [
    {
      name: 'Special Ghar Ki Thali',
      description: '4 Butter Phulke, Dal Tadka, Paneer Sabzi, Jeera Rice, Salad, Pickle & Gulab Jamun.',
      sellingPrice: 149,
      discountPrice: 199,
      category: 'Thali',
      isVeg: true,
      preparationTime: 25,
      image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Punjabi Dal Makhani',
      description: 'Slow-cooked whole black lentils simmered overnight with fresh cream and butter.',
      sellingPrice: 139,
      discountPrice: 169,
      category: 'Main Course',
      isVeg: true,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Maa Ke Hath Ka Rajma Chawal',
      description: 'Mouth-watering Kashmiri Rajma cooked in homestyle spices served with aromatic Basmati Rice.',
      sellingPrice: 129,
      discountPrice: 159,
      category: 'Combos',
      isVeg: true,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Homestyle Paneer Bhurji',
      description: 'Crumbled fresh malai paneer sauteed with onion, juicy tomatoes, ginger, and green chillies.',
      sellingPrice: 159,
      discountPrice: 199,
      category: 'Main Course',
      isVeg: true,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc0?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Aloo Pyaaz Paratha Combo (2 Pcs)',
      description: 'Crispy stuffed golden parathas served with creamy fresh dahi, white butter & pickle.',
      sellingPrice: 89,
      discountPrice: 119,
      category: 'Breads',
      isVeg: true,
      preparationTime: 15,
      image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Desi Ghee Phulka (Pack of 5)',
      description: 'Super soft, 100% whole wheat home chapatis made fresh on order with pure desi ghee.',
      sellingPrice: 45,
      discountPrice: 60,
      category: 'Breads',
      isVeg: true,
      preparationTime: 10,
      image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Kadhi Pakora with Jeera Rice',
      description: 'Authentic sour curd Punjabi kadhi with soft crispy onion pakoras served with cumin rice.',
      sellingPrice: 119,
      discountPrice: 149,
      category: 'Combos',
      isVeg: true,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Matar Paneer Ghar Jaisa',
      description: 'Tender green peas and soft paneer cubes in homestyle mildly spiced onion-tomato gravy.',
      sellingPrice: 149,
      discountPrice: 180,
      category: 'Main Course',
      isVeg: true,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc0?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Sweet Gulab Jamun (2 Pcs)',
      description: 'Melt-in-mouth warm khoya gulab jamuns dipped in saffron cardamom sugar syrup.',
      sellingPrice: 40,
      discountPrice: 50,
      category: 'Desserts',
      isVeg: true,
      preparationTime: 5,
      image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    }
  ],

  'Rajesh Biryani House': [
    {
      name: 'Hyderabadi Chicken Dum Biryani',
      description: 'Aromatic basmati rice layered with succulent chicken pieces, slow-cooked in handi with saffron and mint.',
      sellingPrice: 240,
      discountPrice: 280,
      category: 'Biryani',
      isVeg: false,
      preparationTime: 30,
      image: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Mutton Dum Biryani',
      description: 'Tender goat meat slow-cooked with aged basmati rice, caramelised onions and royal Mughlai spices.',
      sellingPrice: 320,
      discountPrice: 370,
      category: 'Biryani',
      isVeg: false,
      preparationTime: 35,
      image: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Butter Chicken Handi',
      description: 'Tender tandoori chicken cooked in rich makhani gravy with butter, cream, and dried fenugreek.',
      sellingPrice: 280,
      discountPrice: 330,
      category: 'Main Course',
      isVeg: false,
      preparationTime: 25,
      image: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Tandoori Chicken Half (4 Pcs)',
      description: 'Classic roasted chicken marinated in yogurt and tandoori spices, char-grilled to smoky perfection.',
      sellingPrice: 220,
      discountPrice: 260,
      category: 'Starters',
      isVeg: false,
      preparationTime: 25,
      image: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Garlic Butter Naan',
      description: 'Crispy and fluffy tandoori naan brushed with melted garlic butter and chopped coriander.',
      sellingPrice: 45,
      discountPrice: 55,
      category: 'Breads',
      isVeg: true,
      preparationTime: 10,
      image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    }
  ],

  "Priya's Italian Kitchen": [
    {
      name: 'Wood-Fired Margherita Pizza',
      description: 'Hand-stretched dough topped with San Marzano tomato sauce, fresh mozzarella, and sweet basil leaves.',
      sellingPrice: 199,
      discountPrice: 249,
      category: 'Pizza',
      isVeg: true,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1604382355076-af4b0eb60143?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Farmhouse Loaded Pizza',
      description: 'Crunchy bell peppers, sweet corn, black olives, sliced mushrooms, and double mozzarella cheese.',
      sellingPrice: 269,
      discountPrice: 320,
      category: 'Pizza',
      isVeg: true,
      preparationTime: 25,
      image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Creamy Alfredo White Pasta',
      description: 'Penne pasta tossed in rich parmesan cream sauce with sauteed garlic and fresh herbs.',
      sellingPrice: 179,
      discountPrice: 219,
      category: 'Pasta',
      isVeg: true,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1621996346565-e3d5d6281292?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Cheesy Garlic Breadsticks (4 Pcs)',
      description: 'Warm, golden baked artisan bread infused with roasted garlic butter and melted mozzarella.',
      sellingPrice: 99,
      discountPrice: 129,
      category: 'Starters',
      isVeg: true,
      preparationTime: 15,
      image: 'https://images.unsplash.com/photo-1619535860434-ba1d8fa12536?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    }
  ],

  'Burger Point': [
    {
      name: 'Crispy Veggie Crunch Burger',
      description: 'Golden spiced potato & corn patty with fresh lettuce, sliced tomatoes, cheese slice and creamy mayo.',
      sellingPrice: 79,
      discountPrice: 99,
      category: 'Burgers',
      isVeg: true,
      preparationTime: 15,
      image: 'https://images.unsplash.com/photo-1568901346375-23c44588b664?w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Double Patty Chicken Cheese Burger',
      description: 'Juicy grilled chicken patties stacked with cheddar cheese, crispy onions, and smoky BBQ sauce.',
      sellingPrice: 149,
      discountPrice: 189,
      category: 'Burgers',
      isVeg: false,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Peri Peri Crispy French Fries',
      description: 'Hot, crunchy potato fries dusted with tangy and spicy African peri peri seasoning.',
      sellingPrice: 69,
      discountPrice: 89,
      category: 'Sides',
      isVeg: true,
      preparationTime: 10,
      image: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Thick Belgian Cold Coffee',
      description: 'Chilled, creamy and rich blended coffee made with premium roasted beans and vanilla ice cream.',
      sellingPrice: 59,
      discountPrice: 79,
      category: 'Beverages',
      isVeg: true,
      preparationTime: 5,
      image: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    }
  ],

  "Sunita's Kitchen": [
    {
      name: 'Daily Homely Meal Thali',
      description: '3 Tawa Rotis, Arhar Dal, Seasonal Sabzi, Steamed Rice, Dahi and Fresh Salad.',
      sellingPrice: 139,
      discountPrice: 169,
      category: 'Thali',
      isVeg: true,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Kadhi Chawal Ghar Jaisa',
      description: 'Crispy besan pakoras simmered in tangy spiced yogurt curry, served with hot cumin rice.',
      sellingPrice: 119,
      discountPrice: 140,
      category: 'Combos',
      isVeg: true,
      preparationTime: 15,
      image: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Matar Paneer Ghar Jaisa',
      description: 'Soft malai paneer cubes and sweet green peas in a homestyle mild tomato onion curry.',
      sellingPrice: 149,
      discountPrice: 179,
      category: 'Main Course',
      isVeg: true,
      preparationTime: 20,
      image: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc0?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    }
  ],

  "Ramesh's Tiffin Service": [
    {
      name: 'South Indian Mini Tiffin',
      description: '2 Idlis, 1 Medu Vada, Mini Masala Dosa, Sambhar and 2 varieties of fresh coconut chutney.',
      sellingPrice: 149,
      discountPrice: 180,
      category: 'Combos',
      isVeg: true,
      preparationTime: 15,
      image: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Crispy Butter Masala Dosa',
      description: 'Golden fermented rice-lentil crepe smeared with butter, stuffed with spiced potato masala.',
      sellingPrice: 99,
      discountPrice: 120,
      category: 'Tiffin',
      isVeg: true,
      preparationTime: 15,
      image: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Soft Ghee Idli (4 Pcs)',
      description: 'Steamed fluffy rice cakes served with hot vegetable lentil sambar and creamy coconut chutney.',
      sellingPrice: 79,
      discountPrice: 99,
      category: 'Tiffin',
      isVeg: true,
      preparationTime: 10,
      image: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?q=80&w=600&auto=format&fit=crop',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    }
  ],

  'Deepak Non veg store': [
    {
      name: 'Mutton Curry',
      description: 'Tender pieces of mutton slow-cooked in a rich and flavorful gravy with aromatic Indian spices (Deoria).',
      sellingPrice: 320,
      discountPrice: 360,
      category: 'Main Course',
      isVeg: false,
      preparationTime: 45,
      image: 'https://res.cloudinary.com/dnagpw02j/image/upload/v1790662693/products/1790662692320-857203e1464ef711.jpg',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Handi Chicken',
      description: 'Tender chicken slow-cooked in traditional clay pot gravy with authentic local spices.',
      sellingPrice: 260,
      discountPrice: 300,
      category: 'Main Course',
      isVeg: false,
      preparationTime: 30,
      image: 'https://res.cloudinary.com/dnagpw02j/image/upload/v1790254571/products/1790254570260-940040f70fa6e16f.jpg',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Fish Curry',
      description: 'Fresh fish steaks in spicy mustard-coriander broth served homestyle.',
      sellingPrice: 160,
      discountPrice: 190,
      category: 'Main Course',
      isVeg: false,
      preparationTime: 35,
      image: 'https://res.cloudinary.com/dnagpw02j/image/upload/v1790662345/products/1790662344361-006802e17e229b3a.jpg',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    },
    {
      name: 'Steamed Rice',
      description: 'Fluffy long-grain basmati rice steamed fresh.',
      sellingPrice: 60,
      discountPrice: 70,
      category: 'Sides',
      isVeg: true,
      preparationTime: 15,
      image: 'https://res.cloudinary.com/dnagpw02j/image/upload/v1790662855/products/1790662854821-e6074ba94d4b7ab5.jpg',
      isAvailable: true,
      isAdminApproved: true,
      status: 'published',
    }
  ]
};

// Seed sellers and their products
const seedAllHandler = async (req, res) => {
  try {
    console.log('🌱 Starting comprehensive database seeding...');

    // 1. Clear old sellers and products
    await Seller.deleteMany({});
    await Product.deleteMany({});
    console.log('🗑️ Cleared existing sellers and products');

    const createdSellers = [];

    // 2. Insert sellers
    for (const s of [...sellersData, ...homeChefsData]) {
      let user = await User.findOne({ email: s.email });
      if (!user) {
        user = new User({
          name: s.name,
          email: s.email,
          password: s.password,
          phone: s.phone,
          role: 'seller',
          isVerified: true,
          businessName: s.businessName,
        });
        await user.save();
      } else {
        user.password = s.password;
        user.isVerified = true;
        user.isBlocked = false;
        user.role = 'seller';
        user.phone = s.phone;
        user.businessName = s.businessName;
        await user.save();
      }

      const seller = new Seller({
        userId: user._id,
        ...s,
      });
      await seller.save();
      createdSellers.push(seller);
      console.log(`✅ Created seller: ${seller.businessName} (${seller.type}) in ${seller.address?.city}`);
    }

    // 3. Insert dishes for each seller
    let totalItemsCreated = 0;
    for (const seller of createdSellers) {
      const items = sellerMenuCatalog[seller.businessName] || sellerMenuCatalog['Geeta ki Rasoi'].slice(0, 4);
      for (const item of items) {
        await Product.create({
          ...item,
          sellerId: seller._id,
        });
        totalItemsCreated++;
      }
      console.log(`🍔 Seeded ${items.length} items for ${seller.businessName}`);
    }

    // 4. Seed sample orders for Geeta ki Rasoi
    await Order.deleteMany({});
    let customer = await User.findOne({ role: 'user' });
    if (!customer) {
      customer = new User({
        name: 'Aman Verma',
        email: 'aman.customer@gmail.com',
        phone: '9876543299',
        password: 'password123',
        role: 'user',
        isVerified: true,
      });
      await customer.save();
    }

    const geetaSeller = createdSellers.find(s => s.businessName === 'Geeta ki Rasoi');
    let ordersCreatedCount = 0;

    if (geetaSeller) {
      const geetaProducts = await Product.find({ sellerId: geetaSeller._id });
      const p1 = geetaProducts[0] || { name: 'Special Ghar Ki Thali', sellingPrice: 149 };
      const p2 = geetaProducts[1] || { name: 'Punjabi Dal Makhani', sellingPrice: 139 };
      const p3 = geetaProducts[2] || { name: 'Maa Ke Hath Ka Rajma Chawal', sellingPrice: 129 };
      const p4 = geetaProducts[3] || { name: 'Homestyle Paneer Bhurji', sellingPrice: 159 };

      const now = Date.now();
      const sampleOrders = [
        {
          orderNumber: `DN-${now.toString().slice(-5)}05`,
          userId: customer._id,
          sellerId: geetaSeller._id,
          items: [
            { menuItemId: p1._id, name: p1.name, sellingPrice: p1.sellingPrice, quantity: 2, image: p1.image },
          ],
          status: 'delivered',
          subtotal: p1.sellingPrice * 2,
          deliveryFee: 30,
          platformFee: 5,
          total: (p1.sellingPrice * 2) + 35,
          paymentMethod: 'online',
          paymentStatus: 'paid',
          deliveryAddress: {
            street: 'Flat 101, Sector 22-A',
            city: 'Chandigarh',
            state: 'Chandigarh',
            pincode: '160022',
            fullAddress: 'Flat 101, Sector 22-A, Chandigarh',
            location: { type: 'Point', coordinates: [76.7720, 30.7320] }
          },
          statusHistory: [
            { status: 'pending', timestamp: new Date(now - 120 * 60000) },
            { status: 'confirmed', timestamp: new Date(now - 110 * 60000) },
            { status: 'preparing', timestamp: new Date(now - 100 * 60000) },
            { status: 'ready', timestamp: new Date(now - 70 * 60000) },
            { status: 'out_for_delivery', timestamp: new Date(now - 50 * 60000) },
            { status: 'delivered', timestamp: new Date(now - 25 * 60000) }
          ],
          createdAt: new Date(now - 60 * 60000)
        },
        {
          orderNumber: `DN-${now.toString().slice(-5)}04`,
          userId: customer._id,
          sellerId: geetaSeller._id,
          items: [
            { menuItemId: p4._id, name: p4.name, sellingPrice: p4.sellingPrice, quantity: 1, image: p4.image },
            { menuItemId: p1._id, name: p1.name, sellingPrice: p1.sellingPrice, quantity: 1, image: p1.image },
          ],
          status: 'ready',
          subtotal: p4.sellingPrice + p1.sellingPrice,
          deliveryFee: 30,
          platformFee: 5,
          total: p4.sellingPrice + p1.sellingPrice + 35,
          paymentMethod: 'cod',
          paymentStatus: 'pending',
          deliveryAddress: {
            street: 'SCO 45, Sector 35-C',
            city: 'Chandigarh',
            state: 'Chandigarh',
            pincode: '160035',
            fullAddress: 'SCO 45, Sector 35-C, Chandigarh',
            location: { type: 'Point', coordinates: [76.7640, 30.7240] }
          },
          statusHistory: [
            { status: 'pending', timestamp: new Date(now - 45 * 60000) },
            { status: 'confirmed', timestamp: new Date(now - 40 * 60000) },
            { status: 'preparing', timestamp: new Date(now - 35 * 60000) },
            { status: 'ready', timestamp: new Date(now - 10 * 60000) }
          ],
          createdAt: new Date(now - 30 * 60000)
        },
        {
          orderNumber: `DN-${now.toString().slice(-5)}03`,
          userId: customer._id,
          sellerId: geetaSeller._id,
          items: [
            { menuItemId: p3._id, name: p3.name, sellingPrice: p3.sellingPrice, quantity: 2, image: p3.image },
          ],
          status: 'preparing',
          subtotal: p3.sellingPrice * 2,
          deliveryFee: 30,
          platformFee: 5,
          total: (p3.sellingPrice * 2) + 35,
          paymentMethod: 'online',
          paymentStatus: 'paid',
          deliveryAddress: {
            street: 'Booth 12, Sector 37-C',
            city: 'Chandigarh',
            state: 'Chandigarh',
            pincode: '160036',
            fullAddress: 'Booth 12, Sector 37-C, Chandigarh',
            location: { type: 'Point', coordinates: [76.7550, 30.7420] }
          },
          statusHistory: [
            { status: 'pending', timestamp: new Date(now - 30 * 60000) },
            { status: 'confirmed', timestamp: new Date(now - 25 * 60000) },
            { status: 'preparing', timestamp: new Date(now - 20 * 60000) }
          ],
          createdAt: new Date(now - 20 * 60000)
        },
        {
          orderNumber: `DN-${now.toString().slice(-5)}02`,
          userId: customer._id,
          sellerId: geetaSeller._id,
          items: [
            { menuItemId: p3._id, name: p3.name, sellingPrice: p3.sellingPrice, quantity: 1, image: p3.image },
            { menuItemId: p2._id, name: p2.name, sellingPrice: p2.sellingPrice, quantity: 1, image: p2.image },
          ],
          status: 'confirmed',
          subtotal: p3.sellingPrice + p2.sellingPrice,
          deliveryFee: 30,
          platformFee: 5,
          total: p3.sellingPrice + p2.sellingPrice + 35,
          paymentMethod: 'cod',
          paymentStatus: 'pending',
          deliveryAddress: {
            street: 'House 88, Sector 40-D',
            city: 'Chandigarh',
            state: 'Chandigarh',
            pincode: '160040',
            fullAddress: 'House 88, Sector 40-D, Chandigarh',
            location: { type: 'Point', coordinates: [76.7375, 30.7385] }
          },
          statusHistory: [
            { status: 'pending', timestamp: new Date(now - 15 * 60000) },
            { status: 'confirmed', timestamp: new Date(now - 10 * 60000) }
          ],
          createdAt: new Date(now - 10 * 60000)
        },
        {
          orderNumber: `DN-${now.toString().slice(-5)}01`,
          userId: customer._id,
          sellerId: geetaSeller._id,
          items: [
            { menuItemId: p1._id, name: p1.name, sellingPrice: p1.sellingPrice, quantity: 2, image: p1.image },
            { menuItemId: p2._id, name: p2.name, sellingPrice: p2.sellingPrice, quantity: 1, image: p2.image },
          ],
          status: 'pending', // 🟢 NEW INCOMING ORDER WAITING FOR SELLER TO CONFIRM & ACCEPT!
          subtotal: (p1.sellingPrice * 2) + p2.sellingPrice,
          deliveryFee: 30,
          platformFee: 5,
          total: (p1.sellingPrice * 2) + p2.sellingPrice + 35,
          paymentMethod: 'cod',
          paymentStatus: 'pending',
          deliveryAddress: {
            street: 'House 52, Sector 41-B',
            city: 'Chandigarh',
            state: 'Chandigarh',
            pincode: '160041',
            fullAddress: 'House 52, Sector 41-B, Buterla, Chandigarh',
            location: { type: 'Point', coordinates: [76.7410, 30.7325] }
          },
          statusHistory: [
            { status: 'pending', timestamp: new Date(now - 2 * 60000) }
          ],
          createdAt: new Date(now) // Latest created so it appears at top
        },
      ];

      for (const orderData of sampleOrders) {
        await Order.create(orderData);
        ordersCreatedCount++;
      }
      console.log(`📦 Seeded ${ordersCreatedCount} sample orders for Geeta ki Rasoi!`);
    }

    // 5. Connect rider Nana to an active order in Chandigarh
    const partner = await DeliveryPartner.findOne({ isOnline: true }) || await DeliveryPartner.findOne();
    if (partner) {
      const activeOrderForRider = await Order.findOne({ 'deliveryAddress.street': 'House 88, Sector 40-D' });
      if (activeOrderForRider) {
        activeOrderForRider.deliveryPartnerId = partner._id;
        activeOrderForRider.status = 'out_for_delivery';
        activeOrderForRider.pickupLocation = {
          type: 'Point',
          coordinates: [76.7410, 30.7325] // Geeta ki Rasoi in Buterla, Chandigarh
        };
        activeOrderForRider.dropLocation = {
          type: 'Point',
          coordinates: [76.7375, 30.7385] // Sector 40-D, Chandigarh
        };
        await activeOrderForRider.save();

        partner.activeOrderId = activeOrderForRider._id;
        partner.currentLocation = {
          type: 'Point',
          coordinates: [76.7400, 30.7340] // In Chandigarh between Sector 40/41
        };
        partner.city = 'Chandigarh';
        partner.isOnline = true;
        await partner.save();
        console.log(`🚴 Assigned active Chandigarh order ${activeOrderForRider.orderNumber} to rider ${partner.name || partner._id}`);
      }
    }

    res.json({
      success: true,
      message: 'Seeded sellers, products and sample orders successfully!',
      sellersCount: createdSellers.length,
      productsCount: totalItemsCreated,
      ordersCount: ordersCreatedCount,
      restaurants: createdSellers.filter(s => s.type === 'restaurant').map(s => `${s.businessName} (${s.address?.city})`),
      homeChefs: createdSellers.filter(s => s.type === 'home_chef').map(s => `${s.businessName} (${s.address?.city})`),
    });
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

router.get('/seed-all', seedAllHandler);
router.post('/seed-all', seedAllHandler);
router.get('/seed-sellers', seedAllHandler);
router.post('/seed-sellers', seedAllHandler);
router.get('/seed-menus', seedAllHandler);
router.post('/seed-menus', seedAllHandler);

module.exports = router;
