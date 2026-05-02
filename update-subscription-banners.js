const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const connectDB = require('./config/db');
const SubscriptionPlan = require('./models/SubscriptionPlan');

async function updateBanners() {
  try {
    await connectDB();
    
    // Wait a bit for connection to stabilize
    if (mongoose.connection.readyState !== 1) {
      console.log('⏳ Waiting for connection...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const plans = await SubscriptionPlan.find({});
    console.log(`🔍 Found ${plans.length} subscription plans`);

    for (const plan of plans) {
      let imageName = '';
      if (plan.total_days <= 7) imageName = 'weekly.png';
      else if (plan.total_days <= 14) imageName = 'fortnightly.png';
      else imageName = 'monthly.png';

      const imageUrl = `/uploads/subscriptions/${imageName}`;
      
      console.log(`📝 Updating plan: ${plan.plan_name} (${plan.total_days} days) -> ${imageUrl}`);
      
      plan.banner_image = imageUrl;
      plan.image = imageUrl;
      plan.plan_image = imageUrl;
      await plan.save();
    }

    console.log('✨ All plans updated successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating banners:', error);
    process.exit(1);
  }
}

updateBanners();
