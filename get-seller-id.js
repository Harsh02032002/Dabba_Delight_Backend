require('dotenv').config(); if (!process.env.MONGO_URI) { console.error('MONGO_URI is required (set it in the environment)'); process.exit(1); }
const mongoose = require('mongoose');
const Seller = require('./models/Seller');

mongoose.connect(process.env.MONGO_URI)
.then(async () => {
  console.log('Connected to MongoDB');
  
  const seller = await Seller.findOne({ businessName: 'Tifin Service' });
  if (seller) {
    console.log('✅ Seller found:');
    console.log('ID:', seller._id.toString());
    console.log('Name:', seller.businessName);
    console.log('City:', seller.address?.city);
  } else {
    console.log('❌ Seller not found, checking all sellers...');
    const sellers = await Seller.find({});
    console.log('All sellers:', sellers.map(s => ({ id: s._id.toString(), name: s.businessName })));
  }
  process.exit(0);
})
.catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
