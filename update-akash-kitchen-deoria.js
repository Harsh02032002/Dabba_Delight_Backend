const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (e) {}

const mongoose = require('mongoose');
require('dotenv').config();

const Seller = require('./models/Seller');
const Product = require('./models/Product');

const rawUri = process.env.MONGO_URI || 'mongodb+srv://Harsh:Harsh%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0&readPreference=primary';
const MONGO_URI = rawUri.replace('%%40', '%40');

// Deoria Coordinates [longitude, latitude]
const DEORIA_COORDS = [83.7797, 26.5024];

async function updateAkashKitchenToDeoria() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB Atlas');

    // 1. Find Akash Kitchen seller in DB
    const seller = await Seller.findOne({ businessName: { $regex: 'Akash Kitchen', $options: 'i' } });
    if (!seller) {
      console.log('❌ Akash Kitchen seller not found in DB');
      process.exit(1);
    }

    console.log(`🔍 Found Seller: "${seller.businessName}" | Current City: ${seller.address?.city} | ID: ${seller._id}`);

    // 2. Update Akash Kitchen to Deoria, UP
    seller.address = {
      ...seller.address,
      street: seller.address?.street || 'Civil Lines, Malviya Road',
      city: 'Deoria',
      state: 'Uttar Pradesh',
      pincode: seller.address?.pincode || '274001',
      fullAddress: 'Civil Lines, Malviya Road, Deoria, Uttar Pradesh - 274001',
      location: {
        type: 'Point',
        coordinates: DEORIA_COORDS,
      },
    };
    seller.isActive = true;
    seller.isVerified = true;
    seller.kycStatus = 'verified';

    await seller.save();
    console.log(`✅ SUCCESSFULLY UPDATED "${seller.businessName}" TO DEORIA, UTTAR PRADESH!`);
    console.log(`📍 Coords set to Deoria: [${DEORIA_COORDS.join(', ')}]`);

    // 3. Ensure all products for Akash Kitchen are live
    const productsResult = await Product.updateMany(
      { sellerId: seller._id },
      { $set: { isAdminApproved: true, status: 'published', isAvailable: true, isDeleted: false } }
    );
    console.log(`✅ Published ${productsResult.modifiedCount || productsResult.nModified || 'all'} menu items for Akash Kitchen`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error updating Akash Kitchen:', err);
    process.exit(1);
  }
}

updateAkashKitchenToDeoria();
