const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (e) {}

const mongoose = require('mongoose');
require('dotenv').config();

const Seller = require('./models/Seller');
const Product = require('./models/Product');
const User = require('./models/User');

const rawUri = process.env.MONGO_URI || 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0&readPreference=primary';
const MONGO_URI = rawUri.replace('%%40', '%40');

// Known city coordinates [longitude, latitude]
const CITY_COORDS = {
  chandigarh: [76.7794, 30.7333],
  deoria: [83.7797, 26.5024],
  mumbai: [72.8777, 19.0760],
  delhi: [77.2090, 28.6139],
};

async function fixAllSellersAndProducts() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB Atlas');

    // 1. Approve & Activate ALL Sellers in Database
    const sellers = await Seller.find({});
    console.log(`📊 Found ${sellers.length} sellers in MongoDB`);

    for (const seller of sellers) {
      const cityLower = (seller.address?.city || seller.address?.fullAddress || '').toLowerCase();
      let coords = seller.address?.location?.coordinates;

      // Assign valid city coordinates if missing or default [0, 0]
      if (!coords || !Array.isArray(coords) || (coords[0] === 0 && coords[1] === 0)) {
        if (cityLower.includes('chandigarh')) {
          coords = CITY_COORDS.chandigarh;
        } else if (cityLower.includes('deoria')) {
          coords = CITY_COORDS.deoria;
        } else if (cityLower.includes('mumbai')) {
          coords = CITY_COORDS.mumbai;
        } else {
          coords = CITY_COORDS.chandigarh; // Default fallback to Chandigarh
        }
      }

      seller.isActive = true;
      seller.isVerified = true;
      seller.kycStatus = 'verified';
      if (!seller.address) seller.address = {};
      if (!seller.address.location) seller.address.location = { type: 'Point', coordinates: coords };
      seller.address.location.coordinates = coords;

      await seller.save();
      console.log(`✅ Approved & Activated Seller: "${seller.businessName}" | City: ${seller.address?.city || 'Chandigarh'} | Coords: [${coords.join(', ')}]`);
    }

    // 2. Approve & Publish ALL Products in Database
    const productsResult = await Product.updateMany(
      { isDeleted: { $ne: true } },
      {
        $set: {
          isAdminApproved: true,
          status: 'published',
          isAvailable: true,
          isDeleted: false,
        }
      }
    );
    console.log(`\n✅ Approved & Published ${productsResult.modifiedCount || productsResult.nModified || 'all'} menu products in DB`);

    // Ensure 2dsphere index exists on Seller.address.location
    try {
      await Seller.collection.createIndex({ 'address.location': '2dsphere' });
      console.log('✅ 2dsphere index verified on Seller collection');
    } catch (e) {
      console.log('Index note:', e.message);
    }

    // 3. Summary of all live sellers and their products
    const liveSellers = await Seller.find({ isActive: true });
    console.log(`\n🎉 SUMMARY OF LIVE SELLERS (${liveSellers.length}):`);

    for (const s of liveSellers) {
      const prodCount = await Product.countDocuments({ sellerId: s._id, isAvailable: true, isDeleted: { $ne: true } });
      console.log(`- Seller: "${s.businessName}" (${s.type}) | City: ${s.address?.city || 'Chandigarh'} | Products Live: ${prodCount}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error fixing sellers & products:', err);
    process.exit(1);
  }
}

fixAllSellersAndProducts();
