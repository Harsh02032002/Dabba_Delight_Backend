const Order = require('../models/Order');
const DeliveryPartner = require('../models/Others').DeliveryPartner;
const Seller = require('../models/Seller');
const { Notification } = require('../models/Others');
const { SERVICE_RADIUS_KM, haversineKm, isValidCoords, getEffectiveSellerCoords } = require('../utils/sellerGeo');

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

/**
 * Step 4: Send Order Request to Riders
 * Send notifications to nearest riders one by one
 */
const sendOrderToRiders = async (orderId, io) => {
  try {
    console.log(`📱 Sending order ${orderId} to riders`);
    console.log('🔍 Starting order assignment process...');
    
    const order = await Order.findById(orderId)
      .populate('sellerId', 'businessName address')
      .populate('userId', 'name phone');
    
    if (!order) {
      console.log('❌ ERROR: Order not found');
      throw new Error('Order not found');
    }

    console.log('✅ Order details:', {
      orderNumber: order.orderNumber,
      sellerName: order.sellerId?.businessName,
      customerName: order.userId?.name,
      orderStatus: order.status,
      deliveryPartnerId: order.deliveryPartnerId
    });

    // Find nearest partners
    console.log('🔍 Finding nearest delivery partners...');
    const { success, partners, error } = await findNearestDeliveryPartners(orderId);
    
    console.log('📊 Partner search result:', { success, partnersCount: partners?.length, error });
    
    if (!success || !partners || partners.length === 0) {
      console.log('❌ No nearby delivery partners found');
      console.log('📝 Creating admin notification for manual assignment...');
      // Send notification to admin for manual assignment
      await Notification.create({
        userId: order.userId, // Send to user as fallback since admin notifications need userId
        type: 'system',
        title: '🚨 No Delivery Partners Available',
        message: `Order #${order.orderNumber} needs manual delivery assignment`,
        orderId: orderId,
        read: false
      });
      return { success: false, message: 'No nearby delivery partners found' };
    }

    console.log(`✅ Found ${partners.length} nearby partners, sending order requests...`);
    
    // Send order to each partner (one by one, first come first served)
    for (const partner of partners) {
      try {
        console.log(`📨 Sending order request to partner: ${partner.name}`);
        
        // Create notification for delivery partner
        console.log(`🔍 Creating notification for partner ${partner.name}...`);
        console.log(`  - Partner _id: ${partner._id}`);
        console.log(`  - Partner userId: ${partner.userId}`);
        console.log(`  - Order userId: ${order.userId}`);
        console.log(`  - Order sellerId: ${order.sellerId}`);
        
        try {
          const notification = await Notification.create({
            userId: partner.userId, // Use partner.userId (User ID) not partner._id (DeliveryPartner ID)
            type: 'delivery_request',
            title: '🛵 New Delivery Request',
            message: `${order.sellerId.businessName} → ${order.userId.name}`,
            orderId: orderId,
            read: false,
            data: {
              orderId: orderId,
              orderNumber: order.orderNumber,
              restaurantName: order.sellerId.businessName,
              customerName: order.userId.name,
              totalAmount: order.total,
              estimatedTime: '25-30 mins',
              distance: Number.isFinite(partner._distanceKm) ? partner._distanceKm.toFixed(2) : null,
            }
          });
          console.log(`✅ Notification created successfully for partner ${partner.name}`);
          console.log(`  - Notification ID: ${notification._id}`);
        } catch (notifError) {
          console.error(`❌ Failed to create notification for partner ${partner.name}:`, notifError.message);
          console.error(`  - Error details:`, notifError);
          throw notifError; // Re-throw to see the full error
        }
        
        // Distance rider -> customer (already computed by the 12 km filter)
        const calculatedDistance = Number.isFinite(partner._distanceKm) ? partner._distanceKm.toFixed(2) : null;

        const requestPayload = {
          orderId: orderId,
          orderNumber: order.orderNumber,
          restaurantName: order.sellerId?.businessName || 'Restaurant',
          customerName: order.userId?.name || 'Customer',
          pickupAddress: order.sellerId?.address?.fullAddress || order.sellerId?.address?.street || '',
          dropAddress: order.deliveryAddress?.street || order.deliveryAddress?.fullAddress || '',
          totalAmount: order.total,
          estimatedTime: '25-30 mins',
          distance: calculatedDistance,
          order: {
            _id: orderId,
            orderNumber: order.orderNumber,
            restaurantName: order.sellerId?.businessName || 'Restaurant',
            customerName: order.userId?.name || 'Customer',
            pickupAddress: order.sellerId?.address?.fullAddress || order.sellerId?.address?.street || '',
            dropAddress: order.deliveryAddress?.street || order.deliveryAddress?.fullAddress || '',
            totalAmount: order.total,
            distance: calculatedDistance,
            status: 'out_for_delivery',
            createdAt: order.createdAt || new Date(),
          },
          timeout: 30,
          timestamp: new Date()
        };

        // Send real-time notification to delivery partner (both partner._id and partner.userId rooms)
        if (io) {
          io.to(`delivery_partner_${partner._id}`).emit('delivery_request', requestPayload);
          io.to(`delivery_partner_${partner.userId}`).emit('delivery_request', requestPayload);
        }

        console.log(`📨 Order request sent to partner ${partner.name}`);
        
        // Directly assign the order to the first available partner
        console.log(`🎯 Directly assigning order to partner ${partner.name}...`);
        
        try {
          // Update order with delivery partner
          await Order.findByIdAndUpdate(orderId, {
            deliveryPartnerId: partner._id,
            status: 'out_for_delivery'
          });

          // Update partner status
          await DeliveryPartner.findByIdAndUpdate(partner._id, {
            activeOrderId: orderId,
            isAvailable: false
          });

          console.log(`✅ Order successfully assigned to partner ${partner.name}`);
          
          if (io) {
            const updatedOrderDoc = await Order.findById(orderId).populate('sellerId', 'businessName address').populate('userId', 'name phone');
            io.to(`delivery_partner_${partner._id}`).emit('orderAssigned', { order: updatedOrderDoc });
            io.to(`delivery_partner_${partner.userId}`).emit('orderAssigned', { order: updatedOrderDoc });
          }

          // Send notifications for successful assignment
          await Notification.create([
            {
              userId: order.sellerId,
              type: 'order_accepted',
              title: '✅ Delivery Partner Assigned',
              message: `Order #${order.orderNumber} assigned for delivery`,
              orderId: orderId,
              read: false
            },
            {
              userId: order.userId,
              type: 'order_dispatched',
              title: '🛵 Order On The Way',
              message: `Your order #${order.orderNumber} is out for delivery`,
              orderId: orderId,
              read: false
            }
          ]);
          
          console.log(`✅ Assignment notifications sent`);
          
          return { 
            success: true, 
            assignedTo: partner.name,
            partnerId: partner._id
          };
          
        } catch (assignError) {
          console.error(`❌ Failed to assign order to partner ${partner.name}:`, assignError.message);
          throw assignError;
        }
        
      } catch (notifErr) {
        console.log(`❌ Failed to notify partner ${partner.name}: ${notifErr.message}`);
        continue;
      }
    }

    // If no one accepted after trying all partners
    console.log('❌ No delivery partner accepted the order');
    await Notification.create({
      userId: order.userId, // Send to user as fallback since system notifications need userId
      type: 'system',
      title: '🚨 Delivery Order Unassigned',
      message: `Order #${order.orderNumber} was not accepted by any delivery partner`,
      orderId: orderId,
      read: false
    });

    return { success: false, message: 'No delivery partner accepted the order' };

  } catch (error) {
    console.error('❌ Error sending order to riders:', error.message);
    
    // Add specific error logging for userId validation
    if (error.message && error.message.includes('userId: Path `userId` is required')) {
      console.error('🔍 Notification userId validation error detected!');
      console.error('🔍 This error occurs when creating notifications with invalid userId');
      console.error('🔍 Check all Notification.create() calls in delivery-assignment.service.js');
    }
    
    return { success: false, error: error.message };
  }
};

/**
 * Calculate distance between two coordinates in km
 */
const calculateDistance = (coord1, coord2) => {
  console.log(`🧮 Calculating distance between:`);
  console.log(`  - Point 1: [${coord1[0]}, ${coord1[1]}]`);
  console.log(`  - Point 2: [${coord2[0]}, ${coord2[1]}]`);
  
  const R = 6371; // Earth's radius in km
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
  const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
  
  console.log(`  - dLat: ${dLat} radians`);
  console.log(`  - dLon: ${dLon} radians`);
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(coord1[1] * Math.PI / 180) * Math.cos(coord2[1] * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
    
  console.log(`  - a: ${a}`);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  
  console.log(`  - c: ${c}`);
  console.log(`  - Raw distance: ${distance} km`);
  
  const result = distance.toFixed(2);
  console.log(`  - Final distance: ${result} km`);
  
  return result;
};

/**
 * Step 5: Handle Delivery Partner Response
 */
const handleDeliveryResponse = async (orderId, partnerId, response, io) => {
  try {
    console.log(`📬 Delivery partner ${partnerId} ${response} order ${orderId}`);
    
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    if (response === 'accepted') {
      // Assign delivery partner to order
      order.deliveryPartnerId = partnerId;
      order.status = 'out_for_delivery';
      order.statusHistory.push({
        status: 'out_for_delivery',
        timestamp: new Date(),
        updatedBy: partnerId
      });
      await order.save();

      // Update partner availability
      await DeliveryPartner.findByIdAndUpdate(partnerId, {
        isAvailable: false,
        currentOrder: orderId
      });

      // Send notifications
      await Notification.create([
        {
          userId: order.sellerId,
          type: 'order_accepted',
          title: '✅ Delivery Partner Assigned',
          message: `Order #${order.orderNumber} assigned for delivery`,
          orderId: orderId,
          read: false
        },
        {
          userId: order.userId,
          type: 'order_dispatched',
          title: '🛵 Order On The Way',
          message: `Your order #${order.orderNumber} is out for delivery`,
          orderId: orderId,
          read: false
        }
      ]);

      // Send real-time notifications
      if (io) {
        io.to(`seller_${order.sellerId}`).emit('order_status_update', {
          orderId: orderId,
          status: 'out_for_delivery',
          message: 'Delivery partner assigned'
        });

        io.to(`user_${order.userId}`).emit('order_status_update', {
          orderId: orderId,
          status: 'out_for_delivery',
          message: 'Your order is on the way!'
        });
      }

      return { success: true, message: 'Delivery partner assigned successfully' };

    } else if (response === 'rejected') {
      // Create notification for rejection
      // Get the delivery partner to find their userId
      const deliveryPartner = await DeliveryPartner.findById(partnerId);
      if (deliveryPartner) {
        await Notification.create({
          userId: deliveryPartner.userId, // Use deliveryPartner.userId not partnerId
          type: 'delivery_rejected',
          title: '❌ Order Rejected',
          message: `You rejected order #${order.orderNumber}`,
          orderId: orderId,
          read: false
        });
      }

      return { success: true, message: 'Delivery partner rejection recorded' };
    }

  } catch (error) {
    console.error('❌ Error handling delivery response:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  findNearestDeliveryPartners,
  sendOrderToRiders,
  handleDeliveryResponse,
  calculateDistance
};
