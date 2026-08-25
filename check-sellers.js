const mongoose = require('mongoose');
require('dotenv').config();
const Seller = require('./models/Seller');
const Product = require('./models/Product');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0&readPreference=primary';

async function checkSellers() {
  try {
    await mongoose.connect(MONGO_URI);
    const ids = ['69b11e459fcc0e4e5738f610', '69b700b5bac84394deda3719', '69b6f935aa1187e8e0694e32', '6a2548e6d4c79e41953f9f3f'];
    const sellers = await Seller.find({ _id: { $in: ids } });
    console.log('=== SELLERS CHECK ===');
    sellers.forEach(s => {
      console.log(`ID: ${s._id} | Name: "${s.businessName}" | City: "${s.address?.city}" | Area: "${s.address?.area}" | Coords:`, s.address?.location?.coordinates);
    });

    console.log('\n=== PRODUCTS CHECK FOR THESE SELLERS ===');
    const products = await Product.find({ sellerId: { $in: ids }, isAvailable: true, isDeleted: { $ne: true } }).populate('sellerId', 'businessName address type');
    products.forEach(p => {
      console.log(`Product: "${p.name}" | Category: ${p.category} | Seller: "${p.sellerId?.businessName}" | City: "${p.sellerId?.address?.city}"`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSellers();
