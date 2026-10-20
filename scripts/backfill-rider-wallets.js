/**
 * One-off: rebuild each rider's withdrawable wallet from their wallet history.
 *
 * Before the DeliveryPartner schema had a `wallet` path, payout credits and withdrawal
 * debits were recorded in WalletTransaction but the balance itself was never stored.
 * balance = delivery payouts (credit) − withdrawals (debit), floored at 0.
 *
 * MONGO_URI must be set explicitly (.env is not read, so it never picks a database by accident).
 * Dry run (default) prints what would change; nothing is written:
 *   MONGO_URI=... node scripts/backfill-rider-wallets.js
 * Apply:
 *   MONGO_URI=... node scripts/backfill-rider-wallets.js --apply
 */
const mongoose = require('mongoose');
const { DeliveryPartner, WalletTransaction } = require('../models/Others');

const apply = process.argv.includes('--apply');

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Set MONGO_URI to the database you mean to update.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const sums = await WalletTransaction.aggregate([
    { $match: { deliveryPartnerId: { $ne: null } } },
    {
      $group: {
        _id: '$deliveryPartnerId',
        credits: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
        debits: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } },
      },
    },
  ]);
  const byPartner = new Map(sums.map((s) => [String(s._id), s]));
  const partners = await DeliveryPartner.find({}).select('_id name wallet earnings').lean();

  let changed = 0;
  for (const p of partners) {
    const s = byPartner.get(String(p._id)) || { credits: 0, debits: 0 };
    const balance = Math.max(0, Math.round((s.credits - s.debits) * 100) / 100);
    const current = typeof p.wallet === 'number' ? p.wallet : null;
    if (current === balance) continue;
    changed += 1;
    console.log(`${p.name || p._id}: wallet ${current ?? '(none)'} -> ${balance}  (payouts ${s.credits}, withdrawals ${s.debits}, lifetime earnings ${p.earnings || 0})`);
    if (apply) await DeliveryPartner.updateOne({ _id: p._id }, { $set: { wallet: balance } });
  }
  console.log(`${changed} rider(s) ${apply ? 'updated' : 'would change (dry run, use --apply to write)'}`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
