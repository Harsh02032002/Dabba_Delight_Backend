const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const User = require('../models/User');
  const Seller = require('../models/Seller');
  const Product = require('../models/Product');
  const Order = require('../models/Order');

  console.log('🌱 Finding Deepak restaurant...');
  const deepakUser = await User.findOne({
    $or: [
      { email: 'deepak.deoria@gmail.com' },
      { email: 'ravistartek@gmail.com' }
    ]
  });

  const deepakSeller = await Seller.findOne({
    $or: [
      { userId: deepakUser._id },
      { email: deepakUser.email },
      { restaurantName: { $regex: 'deepak', $options: 'i' } }
    ]
  });

  if (!deepakSeller) {
    console.error('❌ Deepak seller record not found!');
    process.exit(1);
  }

  console.log(`✅ Found seller: ${deepakSeller.restaurantName || deepakSeller.businessName} (${deepakSeller._id})`);

  let customer = await User.findOne({ role: 'user' });
  if (!customer) {
    customer = await User.create({
      name: 'Aman Verma',
      email: 'aman.customer@gmail.com',
      phone: '9876543299',
      password: 'password123',
      role: 'user',
      isVerified: true
    });
  }

  // Find products of Deepak or create if none
  let products = await Product.find({ sellerId: deepakSeller._id });
  if (products.length === 0) {
    products = [
      await Product.create({
        name: 'Mutton Curry Special',
        description: 'Tender mutton cooked in traditional gravy',
        sellingPrice: 320,
        discountPrice: 360,
        category: 'Main Course',
        isVeg: false,
        sellerId: deepakSeller._id,
        isAvailable: true,
        status: 'published'
      }),
      await Product.create({
        name: 'Handi Chicken',
        description: 'Clay pot cooked chicken with rich spices',
        sellingPrice: 260,
        discountPrice: 300,
        category: 'Main Course',
        isVeg: false,
        sellerId: deepakSeller._id,
        isAvailable: true,
        status: 'published'
      }),
      await Product.create({
        name: 'Fish Curry & Steamed Rice',
        description: 'Fresh fish in spicy mustard gravy with basmati rice',
        sellingPrice: 220,
        discountPrice: 250,
        category: 'Combos',
        isVeg: false,
        sellerId: deepakSeller._id,
        isAvailable: true,
        status: 'published'
      })
    ];
  }

  const p1 = products[0] || { name: 'Mutton Curry', sellingPrice: 320 };
  const p2 = products[1] || { name: 'Handi Chicken', sellingPrice: 260 };
  const p3 = products[2] || { name: 'Fish Curry', sellingPrice: 220 };

  const now = Date.now();
  const orderTemplates = [
    {
      orderNumber: `DN-${now.toString().slice(-5)}01`,
      userId: customer._id,
      sellerId: deepakSeller._id,
      items: [
        { menuItemId: p1._id, name: p1.name, sellingPrice: p1.sellingPrice, quantity: 1, image: p1.image }
      ],
      status: 'pending',
      subtotal: p1.sellingPrice,
      deliveryFee: 30,
      platformFee: 5,
      total: p1.sellingPrice + 35,
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      deliveryAddress: {
        street: 'Station Road, Near Town Hall',
        city: 'Deoria',
        state: 'Uttar Pradesh',
        pincode: '274001',
        fullAddress: 'Station Road, Near Town Hall, Deoria',
        location: { type: 'Point', coordinates: [83.7788, 26.5021] }
      },
      statusHistory: [{ status: 'pending', timestamp: new Date(now - 3 * 60000) }],
      createdAt: new Date(now - 3 * 60000)
    },
    {
      orderNumber: `DN-${now.toString().slice(-5)}02`,
      userId: customer._id,
      sellerId: deepakSeller._id,
      items: [
        { menuItemId: p2._id, name: p2.name, sellingPrice: p2.sellingPrice, quantity: 2, image: p2.image }
      ],
      status: 'pending',
      subtotal: p2.sellingPrice * 2,
      deliveryFee: 30,
      platformFee: 5,
      total: (p2.sellingPrice * 2) + 35,
      paymentMethod: 'online',
      paymentStatus: 'paid',
      deliveryAddress: {
        street: 'Civil Lines, Block B',
        city: 'Deoria',
        state: 'Uttar Pradesh',
        pincode: '274001',
        fullAddress: 'Civil Lines, Block B, Deoria',
        location: { type: 'Point', coordinates: [83.7810, 26.5040] }
      },
      statusHistory: [{ status: 'pending', timestamp: new Date(now - 2 * 60000) }],
      createdAt: new Date(now - 2 * 60000)
    },
    {
      orderNumber: `DN-${now.toString().slice(-5)}03`,
      userId: customer._id,
      sellerId: deepakSeller._id,
      items: [
        { menuItemId: p3._id, name: p3.name, sellingPrice: p3.sellingPrice, quantity: 1, image: p3.image },
        { menuItemId: p2._id, name: p2.name, sellingPrice: p2.sellingPrice, quantity: 1, image: p2.image }
      ],
      status: 'pending',
      subtotal: p3.sellingPrice + p2.sellingPrice,
      deliveryFee: 30,
      platformFee: 5,
      total: p3.sellingPrice + p2.sellingPrice + 35,
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      deliveryAddress: {
        street: 'Subhash Chowk, Main Market',
        city: 'Deoria',
        state: 'Uttar Pradesh',
        pincode: '274001',
        fullAddress: 'Subhash Chowk, Main Market, Deoria',
        location: { type: 'Point', coordinates: [83.7750, 26.5010] }
      },
      statusHistory: [{ status: 'pending', timestamp: new Date(now - 1 * 60000) }],
      createdAt: new Date(now - 1 * 60000)
    }
  ];

  console.log('📦 Creating 3 fresh pending orders for Deepak...');
  for (const ot of orderTemplates) {
    const created = await Order.create(ot);
    console.log(`  ✨ Created Order #${created.orderNumber} (₹${created.total}) - Status: ${created.status}`);
  }

  console.log('🎉 3 Seed Orders created successfully for Deepak!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error creating seed orders:', err);
  process.exit(1);
});
