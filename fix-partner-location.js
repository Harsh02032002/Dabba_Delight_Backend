const mongoose = require('mongoose');
const DeliveryPartner = require('./models/Others').DeliveryPartner;

mongoose.connect('mongodb+srv://Harsh:Harsh%%402925@cluster0.hddqr9e.mongodb.net/Dabbanation_db?retryWrites=true&w=majority&appName=Cluster0')
.then(async () => {
  console.log('Connected to MongoDB');
  
  try {
    // Find Naina's delivery partner
    const partner = await DeliveryPartner.findOne({ email: 'nainas@gmail.com' });
    
    if (partner) {
      console.log('✅ Found partner:', partner.name);
      console.log('📍 Current location:', partner.currentLocation?.coordinates);
      
      // Update to Chandigarh coordinates
      const updatedPartner = await DeliveryPartner.findByIdAndUpdate(
        partner._id,
        {
          currentLocation: {
            type: 'Point',
            coordinates: [76.74593435736934, 30.73561296326452] // Chandigarh
          }
        },
        { new: true }
      );
      
      console.log('✅ Updated location to:', updatedPartner.currentLocation?.coordinates);
      console.log('🎯 Partner is now ready for order assignment!');
    } else {
      console.log('❌ Partner not found');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});
