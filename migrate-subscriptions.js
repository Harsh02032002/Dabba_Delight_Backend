require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('./models/Subscription');
const AdminWalletTransaction = require('./models/AdminWalletTransaction');
const walletController = require('./controllers/wallet.controller');
const connectDB = require('./config/db');

async function migrateSubscriptions() {
  try {
    // Connect to database
    await connectDB();
    console.log('Connected to DB');

    // Get all subscriptions
    const subscriptions = await Subscription.find({});
    console.log(`Found ${subscriptions.length} total subscriptions.`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const sub of subscriptions) {
      // Check if wallet transaction already exists for this subscription
      const existingTx = await AdminWalletTransaction.findOne({
        type: 'subscription_payment',
        subscription_id: sub._id
      });

      if (existingTx) {
        skippedCount++;
        continue;
      }

      console.log(`Migrating subscription: ${sub._id} - Amount: ₹${sub.total_amount}`);

      try {
        await walletController.processSubscriptionPayment({
          subscriptionId: sub._id,
          userId: sub.user_id,
          sellerId: sub.seller_id,
          totalAmount: sub.total_amount,
          planName: 'Historical Subscription',
          razorpayIds: { orderId: 'historical', paymentId: 'historical' }
        });
        migratedCount++;
      } catch (err) {
        console.error(`Error migrating subscription ${sub._id}:`, err);
      }
    }

    console.log('\n--- Migration Summary ---');
    console.log(`Migrated: ${migratedCount}`);
    console.log(`Skipped (already in wallet): ${skippedCount}`);
    console.log('-------------------------');

    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateSubscriptions();
