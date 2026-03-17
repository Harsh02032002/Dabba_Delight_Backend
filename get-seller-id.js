const mongoose = require('mongoose');
const Seller = require('./models/Seller');

mongoose.connect('mongodb+srv://Harsh:Harsh%%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0')
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
