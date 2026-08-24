const mongoose = require('mongoose');
require('dotenv').config();

const Seller = require('./models/Seller');
const Product = require('./models/Product');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0&readPreference=primary';

async function checkSellers() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const sellers = await Seller.find({});
    console.log(`📊 Total Sellers in DB: ${sellers.length}`);

    sellers.forEach((s, idx) => {
      console.log(`\n--- Seller ${idx + 1} ---`);
      console.log(`ID: ${s._id}`);
      console.log(`Name: ${s.businessName}`);
      console.log(`Type: ${s.type}`);
      console.log(`isActive: ${s.isActive}`);
      console.log(`City: ${s.address?.city}`);
      console.log(`Full Address: ${s.address?.fullAddress || s.address?.street}`);
      console.log(`Location Coords:`, s.address?.location?.coordinates);
    });

    const products = await Product.find({});
    console.log(`\n📊 Total Products in DB: ${products.length}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error checking sellers:', err);
    process.exit(1);
  }
}

checkSellers();
