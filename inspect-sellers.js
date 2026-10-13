const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dabba-nation';
  console.log('Connecting to:', uri);
  await mongoose.connect(uri);
  const Seller = mongoose.model('Seller', new mongoose.Schema({}, { strict: false }));
  const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }));

  const sellers = await Seller.find({}).lean();
  console.log(`Total sellers: ${sellers.length}`);
  sellers.forEach(s => {
    console.log(`- Seller ID: ${s._id}, Name: ${s.businessName}, City: ${s.address?.city}, Type: ${s.type}, Coords: ${JSON.stringify(s.address?.location?.coordinates)}`);
  });

  const products = await Product.find({}).lean();
  console.log(`Total products: ${products.length}`);
  products.slice(0, 10).forEach(p => {
    console.log(`- Product: ${p.name}, SellerId: ${p.sellerId}`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
