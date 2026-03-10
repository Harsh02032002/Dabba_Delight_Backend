const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Seller = require('../models/Seller');

// Sample data for sellers
const sellersData = [
  {
    name: 'Rajesh Kumar',
    email: 'rajesh.restaurant@gmail.com',
    password: 'password123',
    phone: '+919876543210',
    role: 'seller',
    businessName: 'Rajesh Biryani House',
    type: 'restaurant',
    description: 'Authentic Hyderabadi biryanis and Mughlai cuisine since 2010',
    phone: '+919876543210',
    email: 'rajesh.biryani@gmail.com',
    logo: 'https://images.unsplash.com/photo-1552567480-92a164e77461?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&h=400&fit=crop',
    address: {
      street: '123 Food Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
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
    tags: ['Biryani', 'Mughlai', 'Non-Veg', 'Dine-in'],
    rating: 4.5,
    totalOrders: 1250,
    totalRevenue: 250000,
    commissionRate: 15,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar1.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan1.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai1.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank1.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '1234567890',
      ifscCode: 'HDFC0001234',
      accountHolder: 'Rajesh Kumar',
      bankName: 'HDFC Bank'
    }
  },
  {
    name: 'Priya Sharma',
    email: 'priya.pasta@gmail.com',
    password: 'password123',
    phone: '+919876543211',
    role: 'seller',
    businessName: 'Priya\'s Italian Kitchen',
    type: 'restaurant',
    description: 'Authentic Italian cuisine with fresh pasta and wood-fired pizzas',
    phone: '+919876543211',
    email: 'priya.italian@gmail.com',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: '456 Pizza Lane',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400002',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
      }
    },
    operatingHours: {
      monday: { open: '12:00', close: '22:00', isOpen: true },
      tuesday: { open: '12:00', close: '22:00', isOpen: true },
      wednesday: { open: '12:00', close: '22:00', isOpen: true },
      thursday: { open: '12:00', close: '22:00', isOpen: true },
      friday: { open: '12:00', close: '23:00', isOpen: true },
      saturday: { open: '12:00', close: '23:00', isOpen: true },
      sunday: { open: '12:00', close: '22:00', isOpen: true }
    },
    cuisines: ['Italian', 'Continental', 'Pizza'],
    tags: ['Italian', 'Pizza', 'Pasta', 'Vegetarian'],
    rating: 4.7,
    totalOrders: 890,
    totalRevenue: 180000,
    commissionRate: 15,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar2.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan2.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai2.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank2.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '2345678901',
      ifscCode: 'ICIC0001234',
      accountHolder: 'Priya Sharma',
      bankName: 'ICICI Bank'
    }
  },
  {
    name: 'Amit Singh',
    email: 'amit.burger@gmail.com',
    password: 'password123',
    phone: '+919876543212',
    role: 'seller',
    businessName: 'Burger Point',
    type: 'restaurant',
    description: 'Juicy burgers, fries and American fast food',
    phone: '+919876543212',
    email: 'amit.burger@gmail.com',
    logo: 'https://images.unsplash.com/photo-1568901346375-23c44588b664?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565901346375-23c44588b664?w=800&h=400&fit=crop',
    address: {
      street: '789 Burger Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400003',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
      }
    },
    operatingHours: {
      monday: { open: '10:00', close: '23:00', isOpen: true },
      tuesday: { open: '10:00', close: '23:00', isOpen: true },
      wednesday: { open: '10:00', close: '23:00', isOpen: true },
      thursday: { open: '10:00', close: '23:00', isOpen: true },
      friday: { open: '10:00', close: '00:00', isOpen: true },
      saturday: { open: '10:00', close: '00:00', isOpen: true },
      sunday: { open: '10:00', close: '23:00', isOpen: true }
    },
    cuisines: ['American', 'Fast Food', 'Burgers'],
    tags: ['Burgers', 'Fast Food', 'American', 'Delivery'],
    rating: 4.3,
    totalOrders: 2100,
    totalRevenue: 320000,
    commissionRate: 15,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar3.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan3.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai3.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank3.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '3456789012',
      ifscCode: 'SBIN0001234',
      accountHolder: 'Amit Singh',
      bankName: 'State Bank of India'
    }
  },
  {
    name: 'Neha Patel',
    email: 'neha.chinese@gmail.com',
    password: 'password123',
    phone: '+919876543213',
    role: 'seller',
    businessName: 'Dragon Wok',
    type: 'restaurant',
    description: 'Authentic Chinese and Thai cuisine with fresh ingredients',
    phone: '+919876543213',
    email: 'neha.chinese@gmail.com',
    logo: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: '321 China Town',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400004',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
      }
    },
    operatingHours: {
      monday: { open: '11:30', close: '22:30', isOpen: true },
      tuesday: { open: '11:30', close: '22:30', isOpen: true },
      wednesday: { open: '11:30', close: '22:30', isOpen: true },
      thursday: { open: '11:30', close: '22:30', isOpen: true },
      friday: { open: '11:30', close: '23:00', isOpen: true },
      saturday: { open: '11:30', close: '23:00', isOpen: true },
      sunday: { open: '11:30', close: '22:30', isOpen: true }
    },
    cuisines: ['Chinese', 'Thai', 'Asian'],
    tags: ['Chinese', 'Thai', 'Noodles', 'Rice'],
    rating: 4.4,
    totalOrders: 1560,
    totalRevenue: 280000,
    commissionRate: 15,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar4.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan4.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai4.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank4.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '4567890123',
      ifscCode: 'PNB0001234',
      accountHolder: 'Neha Patel',
      bankName: 'Punjab National Bank'
    }
  },
  {
    name: 'Karan Mehta',
    email: 'karan.south@gmail.com',
    password: 'password123',
    phone: '+919876543214',
    role: 'seller',
    businessName: 'South Indian Express',
    type: 'restaurant',
    description: 'Traditional South Indian dishes - Dosas, Idlis and more',
    phone: '+919876543214',
    email: 'karan.south@gmail.com',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: '656 South Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400005',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
      }
    },
    operatingHours: {
      monday: { open: '06:00', close: '22:00', isOpen: true },
      tuesday: { open: '06:00', close: '22:00', isOpen: true },
      wednesday: { open: '06:00', close: '22:00', isOpen: true },
      thursday: { open: '06:00', close: '22:00', isOpen: true },
      friday: { open: '06:00', close: '22:00', isOpen: true },
      saturday: { open: '06:00', close: '22:00', isOpen: true },
      sunday: { open: '06:00', close: '22:00', isOpen: true }
    },
    cuisines: ['South Indian', 'Dosas', 'Idlis'],
    tags: ['South Indian', 'Dosas', 'Idlis', 'Vegetarian'],
    rating: 4.6,
    totalOrders: 1890,
    totalRevenue: 290000,
    commissionRate: 15,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar5.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan5.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai5.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank5.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '5678901234',
      ifscCode: 'KOTAK0001234',
      accountHolder: 'Karan Mehta',
      bankName: 'Kotak Mahindra Bank'
    }
  }
];

// Sample data for home chefs
const homeChefsData = [
  {
    name: 'Sunita Rao',
    email: 'sunita.home@gmail.com',
    password: 'password123',
    phone: '+919876543215',
    role: 'seller',
    businessName: 'Sunita\'s Kitchen',
    type: 'home_chef',
    description: 'Homely Maharashtrian meals cooked with love and traditional recipes',
    phone: '+919876543215',
    email: 'sunita.kitchen@gmail.com',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: '123 Home Lane',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400006',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
      }
    },
    operatingHours: {
      monday: { open: '07:00', close: '21:00', isOpen: true },
      tuesday: { open: '07:00', close: '21:00', isOpen: true },
      wednesday: { open: '07:00', close: '21:00', isOpen: true },
      thursday: { open: '07:00', close: '21:00', isOpen: true },
      friday: { open: '07:00', close: '21:00', isOpen: true },
      saturday: { open: '07:00', close: '20:00', isOpen: true },
      sunday: { open: '07:00', close: '20:00', isOpen: true }
    },
    cuisines: ['Maharashtrian', 'Home Food', 'Traditional'],
    tags: ['Home Food', 'Maharashtrian', 'Vegetarian', 'Daily Meals'],
    rating: 4.8,
    totalOrders: 450,
    totalRevenue: 67000,
    commissionRate: 12,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar6.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan6.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai6.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank6.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '6789012345',
      ifscCode: 'AXIS0001234',
      accountHolder: 'Sunita Rao',
      bankName: 'Axis Bank'
    }
  },
  {
    name: 'Ramesh Iyer',
    email: 'ramesh.south@gmail.com',
    password: 'password123',
    phone: '+919876543216',
    role: 'seller',
    businessName: 'Ramesh\'s Tiffin Service',
    type: 'home_chef',
    description: 'Traditional South Indian tiffin service with daily meal plans',
    phone: '+919876543216',
    email: 'ramesh.tiffin@gmail.com',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: '456 Tiffin Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400007',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
      }
    },
    operatingHours: {
      monday: { open: '06:00', close: '20:00', isOpen: true },
      tuesday: { open: '06:00', close: '20:00', isOpen: true },
      wednesday: { open: '06:00', close: '20:00', isOpen: true },
      thursday: { open: '06:00', close: '20:00', isOpen: true },
      friday: { open: '06:00', close: '20:00', isOpen: true },
      saturday: { open: '06:00', close: '19:00', isOpen: true },
      sunday: { open: '06:00', close: '19:00', isOpen: true }
    },
    cuisines: ['South Indian', 'Tiffin', 'Home Food'],
    tags: ['Tiffin', 'South Indian', 'Home Food', 'Daily Meals'],
    rating: 4.7,
    totalOrders: 680,
    totalRevenue: 85000,
    commissionRate: 12,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar7.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan7.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai7.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank7.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '7890123456',
      ifscCode: 'CITI0001234',
      accountHolder: 'Ramesh Iyer',
      bankName: 'Citibank'
    }
  },
  {
    name: 'Anita Deshmukh',
    email: 'anita.punjab@gmail.com',
    password: 'password123',
    phone: '+919876543217',
    role: 'seller',
    businessName: 'Anita\'s Punjabi Kitchen',
    type: 'home_chef',
    description: 'Authentic Punjabi home-cooked meals with rich flavors',
    phone: '+919876543217',
    email: 'anita.punjabi@gmail.com',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: '789 Punjabi Lane',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400008',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
      }
    },
    operatingHours: {
      monday: { open: '07:30', close: '21:30', isOpen: true },
      tuesday: { open: '07:30', close: '21:30', isOpen: true },
      wednesday: { open: '07:30', close: '21:30', isOpen: true },
      thursday: { open: '07:30', close: '21:30', isOpen: true },
      friday: { open: '07:30', close: '21:30', isOpen: true },
      saturday: { open: '07:30', close: '20:30', isOpen: true },
      sunday: { open: '07:30', close: '20:30', isOpen: true }
    },
    cuisines: ['Punjabi', 'North Indian', 'Home Food'],
    tags: ['Punjabi', 'North Indian', 'Home Food', 'Rich Flavors'],
    rating: 4.9,
    totalOrders: 520,
    totalRevenue: 78000,
    commissionRate: 12,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar8.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan8.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai8.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank8.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '8901234567',
      ifscCode: 'HDFC0005678',
      accountHolder: 'Anita Deshmukh',
      bankName: 'HDFC Bank'
    }
  },
  {
    name: 'Fatima Sheikh',
    email: 'fatima.mughlai@gmail.com',
    password: 'password123',
    phone: '+919876543218',
    role: 'seller',
    businessName: 'Fatima\'s Mughlai Kitchen',
    type: 'home_chef',
    description: 'Traditional Mughlai and Awadhi cuisine from family recipes',
    phone: '+919876543218',
    email: 'fatima.mughlai@gmail.com',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: '321 Mughlai Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400009',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
      }
    },
    operatingHours: {
      monday: { open: '08:00', close: '21:00', isOpen: true },
      tuesday: { open: '08:00', close: '21:00', isOpen: true },
      wednesday: { open: '08:00', close: '21:00', isOpen: true },
      thursday: { open: '08:00', close: '21:00', isOpen: true },
      friday: { open: '08:00', close: '21:00', isOpen: true },
      saturday: { open: '08:00', close: '20:00', isOpen: true },
      sunday: { open: '08:00', close: '20:00', isOpen: true }
    },
    cuisines: ['Mughlai', 'Awadhi', 'North Indian'],
    tags: ['Mughlai', 'Awadhi', 'North Indian', 'Traditional'],
    rating: 4.6,
    totalOrders: 380,
    totalRevenue: 57000,
    commissionRate: 12,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar9.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan9.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai9.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank9.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '9012345678',
      ifscCode: 'ICIC0005678',
      accountHolder: 'Fatima Sheikh',
      bankName: 'ICICI Bank'
    }
  },
  {
    name: 'Lakshmi Nair',
    email: 'lakshmi.kerala@gmail.com',
    password: 'password123',
    phone: '+919876543219',
    role: 'seller',
    businessName: 'Lakshmi\'s Kerala Kitchen',
    type: 'home_chef',
    description: 'Authentic Kerala cuisine with coconut-based traditional recipes',
    phone: '+919876543219',
    email: 'lakshmi.kerala@gmail.com',
    logo: 'https://images.unsplash.com/photo-1555396273-3f4e8503b5b0?w=400&h=400&fit=crop',
    coverImage: 'https://images.unsplash.com/photo-1565299624946-b28f40a9ae15?w=800&h=400&fit=crop',
    address: {
      street: '654 Kerala Lane',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400010',
      location: {
        type: 'Point',
        coordinates: [72.8777, 19.0760]
      }
    },
    operatingHours: {
      monday: { open: '07:00', close: '20:00', isOpen: true },
      tuesday: { open: '07:00', close: '20:00', isOpen: true },
      wednesday: { open: '07:00', close: '20:00', isOpen: true },
      thursday: { open: '07:00', close: '20:00', isOpen: true },
      friday: { open: '07:00', close: '20:00', isOpen: true },
      saturday: { open: '07:00', close: '19:00', isOpen: true },
      sunday: { open: '07:00', close: '19:00', isOpen: true }
    },
    cuisines: ['Kerala', 'South Indian', 'Coconut-based'],
    tags: ['Kerala', 'South Indian', 'Coconut', 'Traditional'],
    rating: 4.5,
    totalOrders: 420,
    totalRevenue: 63000,
    commissionRate: 12,
    isActive: true,
    isVerified: true,
    kycStatus: 'verified',
    kycDocuments: {
      aadhaar: { url: 'https://example.com/aadhaar10.jpg', status: 'verified' },
      pan: { url: 'https://example.com/pan10.jpg', status: 'verified' },
      fssai: { url: 'https://example.com/fssai10.jpg', status: 'verified' },
      bankProof: { url: 'https://example.com/bank10.jpg', status: 'verified' }
    },
    bankDetails: {
      accountNumber: '0123456789',
      ifscCode: 'SBI0005678',
      accountHolder: 'Lakshmi Nair',
      bankName: 'State Bank of India'
    }
  }
];

// POST /api/seed-sellers - Seed sellers data
router.post('/seed-sellers', async (req, res) => {
  try {
    console.log('🌱 Starting database seeding...');
    
    // Clear existing sellers
    await Seller.deleteMany({});
    console.log('🗑️ Cleared existing sellers');
    
    // Create users and sellers
    const createdSellers = [];
    
    for (const sellerData of [...sellersData, ...homeChefsData]) {
      // Create user first
      const user = new User({
        name: sellerData.name,
        email: sellerData.email,
        password: sellerData.password,
        phone: sellerData.phone,
        role: 'seller',
        isVerified: true,
        businessName: sellerData.businessName
      });
      
      const savedUser = await user.save();
      console.log(`✅ Created user: ${sellerData.name}`);
      
      // Create seller
      const seller = new Seller({
        userId: savedUser._id,
        ...sellerData
      });
      
      const savedSeller = await seller.save();
      console.log(`✅ Created seller: ${sellerData.businessName} (${sellerData.type})`);
      
      createdSellers.push({
        ...savedSeller.toObject(),
        user: {
          name: savedUser.name,
          email: savedUser.email,
          isVerified: savedUser.isVerified
        }
      });
    }
    
    console.log('🎉 Database seeding completed successfully!');
    console.log(`📊 Created ${sellersData.length} restaurants and ${homeChefsData.length} home chefs`);
    
    res.json({
      success: true,
      message: 'Database seeded successfully!',
      data: {
        totalSellers: createdSellers.length,
        restaurants: createdSellers.filter(s => s.type === 'restaurant').length,
        homeChefs: createdSellers.filter(s => s.type === 'home_chef').length,
        sellers: createdSellers
      }
    });
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    res.status(500).json({
      success: false,
      message: 'Error seeding database',
      error: error.message
    });
  }
});

// GET /api/seed-sellers - Get seeding status
router.get('/seed-sellers', async (req, res) => {
  try {
    const totalSellers = await Seller.countDocuments();
    const restaurants = await Seller.countDocuments({ type: 'restaurant' });
    const homeChefs = await Seller.countDocuments({ type: 'home_chef' });
    
    res.json({
      success: true,
      data: {
        totalSellers,
        restaurants,
        homeChefs
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error getting seed status',
      error: error.message
    });
  }
});

module.exports = router;
