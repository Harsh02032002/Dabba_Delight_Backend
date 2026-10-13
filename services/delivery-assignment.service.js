const Order = require('../models/Order');
const User = require('../models/User');
const DeliveryPartner = require('../models/Others').DeliveryPartner;
const { SERVICE_RADIUS_KM, haversineKm, isValidCoords, getEffectiveSellerCoords } = require('../utils/sellerGeo');
const {
  RIDER_ELIGIBLE_STATUSES,
  TERMINAL_STATUSES,
  MAX_ACTIVE_ORDERS_PER_RIDER,
  getRiderPayout,
} = require('./order-lifecycle.service');
const {
  createAndSendNotification,
  notifyRidersNewRequest,
  notifyOrderAssigned,
} = require('../utils/pushNotification.service');

/** Normalise a partner's currentLocation into [lng, lat] or null */
const getPartnerPoint = (partner) => {
  const c = partner?.currentLocation?.coordinates;
  if (!c) return null;
  const pt = Array.isArray(c) ? [Number(c[0]), Number(c[1])] : (c.lng != null && c.lat != null ? [Number(c.lng), Number(c.lat)] : null);
  return pt && isValidCoords(pt) ? pt : null;
};

/**
 * Step 3: Find Nearest Delivery Boy
 * Rule: only riders within SERVICE_RADIUS_KM (12 km) of the CUSTOMER's delivery
 * location, sorted by distance. No "send to everyone" fallback.
 */
const findNearestDeliveryPartners = async (orderId) => {
  try {
    console.log(`🔍 Finding nearest delivery partners for order ${orderId}`);
    console.log('🔍 Starting delivery partner search process...');
    
    const order = await Order.findById(orderId)
      .populate('sellerId', 'businessName address location')
      .populate('userId', 'name deliveryAddress');
    
    if (!order) {
      console.log('❌ ERROR: Order not found');
      throw new Error('Order not found');
    }

    console.log('✅ Order found:', {
      orderNumber: order.orderNumber,
      sellerId: order.sellerId?._id,
      sellerName: order.sellerId?.businessName,
      restaurantLocation: order.sellerId?.address?.location?.coordinates,
      orderStatus: order.status
    });

    // Restaurant (pickup) location - pin corrected against declared city if needed
    const sellerDoc = order.sellerId?.toObject ? order.sellerId.toObject() : order.sellerId;
    const { coords: sellerPoint } = getEffectiveSellerCoords(sellerDoc || {});
    const restaurantLocation = sellerPoint ? { type: 'Point', coordinates: sellerPoint } : null;

    // Customer (drop) location - this is what the 12 km rider rule is based on
    const rawDrop = order.deliveryAddress?.location?.coordinates;
    const dropPoint = Array.isArray(rawDrop) && isValidCoords([Number(rawDrop[0]), Number(rawDrop[1])])
      ? [Number(rawDrop[0]), Number(rawDrop[1])]
      : null;
    // If the order has no drop coords, the seller is already within 12 km of the
    // customer (enforced at order placement), so use the pickup point as reference.
    const referencePoint = dropPoint || sellerPoint;

    console.log(`🏪 Pickup: ${sellerPoint ? sellerPoint.join(',') : 'n/a'} | 🏠 Drop: ${dropPoint ? dropPoint.join(',') : 'n/a'} | radius ${SERVICE_RADIUS_KM} km`);

    if (!referencePoint) {
      console.log('❌ ERROR: Neither customer nor restaurant location available');
      throw new Error('Delivery location not available');
    }

    // All online + free delivery partners
    const allOnlinePartners = await DeliveryPartner.find({
      isOnline: true,
      isAvailable: true,
      activeOrderId: null,
      currentLocation: { $exists: true },
    });

    console.log(`👥 Found ${allOnlinePartners.length} online partners`);
    if (allOnlinePartners.length === 0) {
      return { success: false, message: 'No online delivery partners available' };
    }

    // Keep only riders within SERVICE_RADIUS_KM of the customer, nearest first
    const nearbyPartners = [];
    for (const partner of allOnlinePartners) {
      const partnerPoint = getPartnerPoint(partner);
      if (!partnerPoint) {
        console.log(`❌ Partner ${partner.name} has no valid live location - skipped`);
        continue;
      }
      const distNum = haversineKm(referencePoint, partnerPoint);
      if (distNum <= SERVICE_RADIUS_KM) {
        partner._distanceKm = distNum;
        nearbyPartners.push(partner);
        console.log(`✅ Partner ${partner.name} is ${distNum.toFixed(2)} km from customer - eligible`);
      } else {
        console.log(`❌ Partner ${partner.name} is ${distNum.toFixed(2)} km away (> ${SERVICE_RADIUS_KM} km) - rejected`);
      }
    }
    nearbyPartners.sort((a, b) => a._distanceKm - b._distanceKm);

    console.log(`📍 Found ${nearbyPartners.length} delivery partners within ${SERVICE_RADIUS_KM} km`);

    if (nearbyPartners.length === 0) {
      console.log(`❌ No delivery partner within ${SERVICE_RADIUS_KM} km of the customer`);
      return { success: false, message: `No delivery partners within ${SERVICE_RADIUS_KM} km` };
    }
    
    return {
      success: true,
      partners: nearbyPartners,
      restaurantLocation: restaurantLocation?.coordinates || null,
      customerLocation: dropPoint
    };

  } catch (error) {
    console.error('❌ Error finding delivery partners:', error.message);
    return { success: false, error: error.message };
  }
};

/** Rider-safe address summary (area only — full address/phone are shared after acceptance) */
const summarizeDropArea = (addr) => {
  if (!addr || typeof addr !== 'object') return '';
  return [addr.city, addr.pincode].filter(Boolean).join(' - ');
};

/** Payload for an order offered to riders before acceptance (no customer contact details) */
const buildDeliveryRequestPayload = (order, distanceKm) => {
  const seller = order.sellerId && typeof order.sellerId === 'object' ? order.sellerId : {};
  const pickupAddress = seller.address?.fullAddress || seller.address?.street || '';
  const dropArea = summarizeDropArea(order.deliveryAddress);
  const distance = Number.isFinite(distanceKm) ? distanceKm.toFixed(2) : null;
  const summary = {
    _id: order._id,
    orderId: order._id,
    orderNumber: order.orderNumber,
    restaurantName: seller.businessName || 'Restaurant',
    pickupAddress,
    dropAddress: dropArea,
    totalAmount: order.total,
    riderPayout: getRiderPayout(order),
    distance,
    status: order.status,
    createdAt: order.createdAt || new Date(),
  };
  return { ...summary, order: summary, estimatedTime: '25-30 mins', timeout: 30, timestamp: new Date() };
};

/**
 * Step 4: Offer an eligible order to nearby riders.
 * The order is NOT assigned here — riders accept it through acceptOrder / assignOrderToRider,
 * which claims it atomically so only one rider can win.
 */
const sendOrderToRiders = async (orderId, io) => {
  try {
    const order = await Order.findById(orderId).populate('sellerId', 'businessName address');
    if (!order) throw new Error('Order not found');

    if (order.deliveryPartnerId) {
      return { success: true, message: 'Delivery partner already assigned', alreadyAssigned: true };
    }
    if (!RIDER_ELIGIBLE_STATUSES.includes(order.status)) {
      return { success: false, message: `Order is ${order.status}; not offered to riders` };
    }

    const { success, partners } = await findNearestDeliveryPartners(orderId);

    if (!success || !partners || partners.length === 0) {
      console.log(`❌ No nearby delivery partners for order ${order.orderNumber}`);
      const admins = await User.find({ role: 'admin' }).select('_id').lean();
      for (const admin of admins) {
        await createAndSendNotification({
          userId: admin._id,
          title: '🚨 No Delivery Partners Available',
          message: `Order #${order.orderNumber} needs manual delivery assignment`,
          type: 'system',
          orderId: order._id,
          io,
          dedupeKey: `${order._id}:no_riders:${admin._id}`,
        });
      }
      return { success: false, message: 'No nearby delivery partners found' };
    }

    for (const partner of partners) {
      const payload = buildDeliveryRequestPayload(order, partner._distanceKm);
      if (io) {
        io.to(`delivery_partner_${partner._id}`).emit('delivery_request', payload);
        io.to(`delivery_partner_${partner.userId}`).emit('delivery_request', payload);
      }
    }
    await notifyRidersNewRequest({ order, riders: partners, io });

    console.log(`📨 Order ${order.orderNumber} offered to ${partners.length} nearby partner(s)`);
    return { success: true, notified: partners.length };
  } catch (error) {
    console.error('❌ Error sending order to riders:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Calculate distance between two coordinates in km
 */
const calculateDistance = (coord1, coord2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
  const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(coord1[1] * Math.PI / 180) * Math.cos(coord2[1] * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return (R * c).toFixed(2);
};

/** Free a rider whose activeOrderId points at a finished / foreign order */
const clearStaleRiderReservation = async (partner) => {
  if (!partner?.activeOrderId) return partner;
  const current = await Order.findById(partner.activeOrderId).select('status deliveryPartnerId').lean();
  const stillMine = current
    && !TERMINAL_STATUSES.includes(current.status)
    && String(current.deliveryPartnerId) === String(partner._id);
  if (stillMine) return partner;
  const cleared = await DeliveryPartner.findOneAndUpdate(
    { _id: partner._id, activeOrderId: partner.activeOrderId },
    { $set: { activeOrderId: null, isAvailable: !!partner.isOnline } },
    { new: true },
  );
  return cleared || (await DeliveryPartner.findById(partner._id)) || partner;
};

/** Release a rider from an order (cancellation / failed claim) */
const releaseRider = async (partnerId, orderId) => {
  if (!partnerId) return null;
  const partner = await DeliveryPartner.findOneAndUpdate(
    { _id: partnerId, activeOrderId: orderId },
    { $set: { activeOrderId: null } },
    { new: true },
  );
  if (partner) {
    partner.isAvailable = !!partner.isOnline;
    await partner.save();
  }
  return partner;
};

/**
 * Step 5: Rider accepts an order — race-safe.
 *  1. Reserve the rider (activeOrderId: null → orderId); enforces one active delivery per rider.
 *  2. Claim the order (deliveryPartnerId: null → rider) only while it is still eligible.
 * Both steps are single atomic updates, so concurrent accepts cannot both succeed.
 * @returns {{ success: boolean, code?: number, message: string, order?: object, alreadyAccepted?: boolean }}
 */
const assignOrderToRider = async (orderId, partnerDoc, io) => {
  let partner = await clearStaleRiderReservation(partnerDoc);

  const existing = await Order.findById(orderId).select('status deliveryPartnerId').lean();
  if (!existing) return { success: false, code: 404, message: 'Order not found' };
  if (existing.deliveryPartnerId && String(existing.deliveryPartnerId) === String(partner._id)) {
    const order = await Order.findById(orderId).populate('sellerId', 'businessName address phone').populate('userId', 'name phone');
    return { success: true, alreadyAccepted: true, message: 'You have already accepted this order', order };
  }
  if (existing.deliveryPartnerId) {
    return { success: false, code: 409, message: 'Order already taken by another delivery partner' };
  }
  if (!RIDER_ELIGIBLE_STATUSES.includes(existing.status)) {
    return { success: false, code: 409, message: `Order is no longer available (${existing.status})` };
  }

  // 1. Reserve rider capacity (MAX_ACTIVE_ORDERS_PER_RIDER = 1 → activeOrderId must be free)
  const reserved = await DeliveryPartner.findOneAndUpdate(
    { _id: partner._id, activeOrderId: null },
    { $set: { activeOrderId: existing._id, isAvailable: false } },
    { new: true },
  );
  if (!reserved) {
    return {
      success: false,
      code: 409,
      message: `You can handle ${MAX_ACTIVE_ORDERS_PER_RIDER} active delivery at a time. Complete your current order first.`,
    };
  }
  partner = reserved;

  // 2. Claim the order atomically
  const now = new Date();
  const claimed = await Order.findOneAndUpdate(
    {
      _id: existing._id,
      status: { $in: RIDER_ELIGIBLE_STATUSES },
      $or: [{ deliveryPartnerId: null }, { deliveryPartnerId: { $exists: false } }],
    },
    {
      $set: { deliveryPartnerId: partner._id, deliveryStatus: 'assigned', riderAssignedAt: now },
      $push: { statusHistory: { status: 'rider_assigned', timestamp: now, updatedBy: partner._id } },
    },
    { new: true },
  ).populate('sellerId', 'businessName address phone').populate('userId', 'name phone pushToken fcmToken');

  if (!claimed) {
    await releaseRider(partner._id, existing._id);
    return { success: false, code: 409, message: 'Order already taken by another delivery partner' };
  }

  console.log(`✅ Order ${claimed.orderNumber} accepted by partner ${partner.name}`);

  if (io) {
    const customerId = claimed.userId?._id || claimed.userId;
    const sellerId = claimed.sellerId?._id || claimed.sellerId;
    const payload = {
      orderId: claimed._id,
      orderNumber: claimed.orderNumber,
      status: claimed.status,
      deliveryStatus: 'assigned',
      deliveryPartner: {
        _id: partner._id,
        name: partner.name,
        phone: partner.phone,
        vehicleType: partner.vehicleType,
      },
      message: `${partner.name} will deliver your order`,
      timestamp: now,
    };
    io.to(`order_${claimed._id}`).emit('order_status_update', payload);
    io.to(`user_${customerId}`).emit('order_status_update', payload);
    io.to(`seller_${sellerId}`).emit('order_status_update', payload);
    // Other riders drop this order from their lists / incoming-request modal
    io.to('delivery_partners').emit('delivery_request_taken', { orderId: claimed._id, orderNumber: claimed.orderNumber });
  }

  notifyOrderAssigned({ order: claimed, customer: claimed.userId, rider: partner, io })
    .catch(e => console.warn('notifyOrderAssigned error:', e.message));

  return { success: true, message: 'Order accepted', order: claimed, partner };
};

/**
 * Legacy entry point (socket acceptOrder / rejectOrder).
 * @param partnerId DeliveryPartner _id
 */
const handleDeliveryResponse = async (orderId, partnerId, response, io) => {
  try {
    if (response === 'accepted') {
      const partner = await DeliveryPartner.findById(partnerId);
      if (!partner) return { success: false, message: 'Delivery partner not found' };
      return assignOrderToRider(orderId, partner, io);
    }
    // Rejections are not persisted: the order simply stays available to other riders
    return { success: true, message: 'Delivery partner rejection recorded' };
  } catch (error) {
    console.error('❌ Error handling delivery response:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  findNearestDeliveryPartners,
  sendOrderToRiders,
  assignOrderToRider,
  releaseRider,
  handleDeliveryResponse,
  calculateDistance,
  buildDeliveryRequestPayload,
};
