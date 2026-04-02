const GSTSettings = require('../models/GSTSettings');

function normalizeState(state) {
  if (!state || typeof state !== 'string') return '';
  return state.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Customer pays: subtotal + food GST + delivery + delivery GST (seller / logistics).
 * Platform records (settlement / commission invoice only): commission + GST on commission — NOT added to customer total.
 *
 * @param {number} params.platformFeeRupee — fixed fee from config (stored on order for ops; not charged to customer here)
 */
function computeOrderGSTAndCommission({
  subtotal,
  deliveryFee = 0,
  platformFeeRupee = 0,
  sellerState,
  customerState,
  settings,
}) {
  const sNorm = normalizeState(sellerState);
  const cNorm = normalizeState(customerState);
  const sameState = sNorm && cNorm && sNorm === cNorm;
  const gstMode = !sNorm || !cNorm ? 'unknown' : sameState ? 'intra' : 'inter';

  const gstOn = settings?.gstApplicable;

  let foodCgst = 0;
  let foodSgst = 0;
  let foodIgst = 0;
  let deliveryCgst = 0;
  let deliverySgst = 0;
  let deliveryIgst = 0;

  if (gstOn && settings.foodGSTEnabled) {
    const fc = (Number(settings.foodCGSTRate) || 0) / 100;
    const fs = (Number(settings.foodSGSTRate) || 0) / 100;
    const igstRateSetting = Number(settings.foodIGSTRate) || 0;
    const interFoodRate =
      igstRateSetting > 0 ? igstRateSetting / 100 : fc + fs;

    if (sameState || gstMode === 'unknown') {
      foodCgst = subtotal * fc;
      foodSgst = subtotal * fs;
    } else {
      foodIgst = subtotal * interFoodRate;
    }
  }

  if (gstOn && settings.deliveryGSTEnabled && deliveryFee > 0) {
    const dc = (Number(settings.deliveryCGSTRate) || 0) / 100;
    const ds = (Number(settings.deliverySGSTRate) || 0) / 100;
    const digstSetting = Number(settings.deliveryIGSTRate) || 0;
    const interDelRate = digstSetting > 0 ? digstSetting / 100 : dc + ds;

    if (sameState || gstMode === 'unknown') {
      deliveryCgst = deliveryFee * dc;
      deliverySgst = deliveryFee * ds;
    } else {
      deliveryIgst = deliveryFee * interDelRate;
    }
  }

  const foodGSTTotal = foodCgst + foodSgst + foodIgst;
  const deliveryGSTTotal = deliveryCgst + deliverySgst + deliveryIgst;
  const gstAmount = foodGSTTotal + deliveryGSTTotal;

  let commission = 0;
  let commissionGST = 0;
  if (gstOn && settings.platformGSTEnabled) {
    const cr = (Number(settings.platformCommissionRate) || 0) / 100;
    const cgr = (Number(settings.platformGSTRate) || 0) / 100;
    commission = subtotal * cr;
    commissionGST = commission * cgr;
  }

  const customerPayable =
    subtotal + foodGSTTotal + (Number(deliveryFee) || 0) + deliveryGSTTotal;

  return {
    gstMode,
    sameState,
    foodCgst,
    foodSgst,
    foodIgst,
    deliveryCgst,
    deliverySgst,
    deliveryIgst,
    commission,
    commissionGST,
    gstAmount,
    foodGSTTotal,
    deliveryGSTTotal,
    /** Amount the customer must pay (subscription applied on top of this) */
    customerPayable,
    /** For records / seller settlement only */
    platformFeeRupee: Number(platformFeeRupee) || 0,
  };
}

async function getGSTSettingsDoc() {
  return GSTSettings.getCurrentSettings();
}

module.exports = {
  normalizeState,
  computeOrderGSTAndCommission,
  getGSTSettingsDoc,
};
