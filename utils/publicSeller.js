/**
 * Kitchen data safe for anyone to see (kitchen list, nearby, kitchen page).
 * Contact details, bank and KYC data are only shown to the customer of an order, the seller and admins.
 */
const PRIVATE_SELLER_FIELDS = [
  'phone', 'email', 'bankDetails', 'kycDocuments', 'kycRejectReason', 'kycSubmittedAt',
  'referralCode', 'referredBy', 'wallet', 'razorpayContactId', 'razorpayFundAccountId',
];

const toPublicSeller = (seller) => {
  if (!seller) return seller;
  const obj = typeof seller.toObject === 'function' ? seller.toObject() : { ...seller };
  for (const k of PRIVATE_SELLER_FIELDS) delete obj[k];
  if (obj.userId && typeof obj.userId === 'object') obj.userId = obj.userId._id || obj.userId;
  return obj;
};

module.exports = { toPublicSeller, PRIVATE_SELLER_FIELDS };
