const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../config/db');
const SubscriptionPlan = require('../models/SubscriptionPlan');

const seedPlans = async () => {
  try {
    await connectDB();
    
    const plans = [
      {
        plan_name: '7 Days Plan',
        description: 'Launch Offer: Perfect for a quick weekly supply of homemade meals.',
        total_amount: 994,
        total_days: 7,
        per_day_value: 142,
        badge: 'TRIAL',
        display_order: 1,
        features: [
          'Homemade Food',
          'Lunch + Dinner',
          'Daily Delivery',
          'Healthy & Nutritious'
        ],
        is_active: true,
        is_public: true,
        is_available: true
      },
      {
        plan_name: '14 Days Plan',
        description: 'Launch Offer: Two weeks of hassle-free homemade food delivery.',
        total_amount: 1792,
        total_days: 14,
        per_day_value: 128,
        badge: 'POPULAR',
        display_order: 2,
        features: [
          'Homemade Food',
          'Lunch + Dinner',
          'Daily Delivery',
          'Great Value',
          'Balanced Diet'
        ],
        is_active: true,
        is_public: true,
        is_available: true
      },
      {
        plan_name: '30 Days Plan',
        description: 'Launch Offer: Full month of homemade food. Best value for regular users.',
        total_amount: 3540,
        total_days: 30,
        per_day_value: 118,
        badge: 'BEST VALUE',
        display_order: 3,
        features: [
          'Save ₹1000 on Monthly Plan',
          'Free Delivery on Monthly',
          'Homemade Food',
          'Lunch + Dinner',
          'Priority Support'
        ],
        is_active: true,
        is_public: true,
        is_available: true
      }
    ];

    // Clear existing plans (optional - user might want to keep others, but usually for seeding we start fresh or update)
    // For safety, we'll only add if they don't exist or just add them.
    for (const plan of plans) {
      await SubscriptionPlan.findOneAndUpdate(
        { plan_name: plan.plan_name },
        plan,
        { upsert: true, new: true }
      );
      console.log(`✅ Plan processed: ${plan.plan_name}`);
    }

    console.log('✨ All subscription plans seeded successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding plans:', err.message);
    process.exit(1);
  }
};

seedPlans();
