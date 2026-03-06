const { DeliveryPartner } = require('../models/Others');
const Order = require('../models/Order');

exports.registerPartner = async (req, res) => {
  try {
    const { name, phone, email, vehicleType, vehicleNumber, licenseNumber } = req.body;
    const existing = await DeliveryPartner.findOne({ phone });
    if (existing) return res.status(400).json({ success: false, message: 'Phone already registered' });
    const partner = await DeliveryPartner.create({ userId: req.user._id, name, phone, email, vehicleType, vehicleNumber, licenseNumber });
    res.status(201).json({ success: true, partner });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.goOnline = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const partner = await DeliveryPartner.findOneAndUpdate(
      { userId: req.user._id },
      { isOnline: true, isAvailable: true, currentLocation: { type: 'Point', coordinates: [lng, lat] } },
      { new: true }
    );
    res.json({ success: true, partner });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.goOffline = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findOneAndUpdate({ userId: req.user._id }, { isOnline: false, isAvailable: false }, { new: true });
    res.json({ success: true, partner });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    await DeliveryPartner.findOneAndUpdate({ userId: req.user._id }, { currentLocation: { type: 'Point', coordinates: [lng, lat] } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.findNearbyPartners = async (req, res) => {
  try {
    const { lat, lng, radius = 5000 } = req.query;
    const partners = await DeliveryPartner.find({
      isOnline: true, isAvailable: true, activeOrderId: null,
      currentLocation: { $near: { $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }, $maxDistance: Number(radius) } },
    }).limit(10);
    res.json({ success: true, partners });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.assignOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId).populate('sellerId');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const sellerCoords = order.sellerId.address?.location?.coordinates || [72.87, 19.07];
    const partner = await DeliveryPartner.findOne({
      isOnline: true, isAvailable: true, activeOrderId: null,
      currentLocation: { $near: { $geometry: { type: 'Point', coordinates: sellerCoords }, $maxDistance: 10000 } },
    });
    if (!partner) return res.status(404).json({ message: 'No delivery partner available' });
    partner.activeOrderId = order._id; partner.isAvailable = false; await partner.save();
    order.deliveryPartnerId = partner._id; order.status = 'out_for_delivery';
    order.statusHistory.push({ status: 'out_for_delivery', timestamp: new Date() }); await order.save();
    res.json({ success: true, partner, order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.pickupOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.status = 'out_for_delivery';
    order.statusHistory.push({ status: 'out_for_delivery', timestamp: new Date() });
    await order.save();
    res.json({ success: true, order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deliverOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.status = 'delivered'; order.actualDelivery = new Date();
    order.statusHistory.push({ status: 'delivered', timestamp: new Date() });
    if (order.paymentMethod === 'cod') order.paymentStatus = 'paid';
    await order.save();
    const partner = await DeliveryPartner.findById(order.deliveryPartnerId);
    if (partner) { partner.activeOrderId = null; partner.isAvailable = true; partner.totalDeliveries += 1; partner.earnings += order.deliveryFee || 30; await partner.save(); }
    res.json({ success: true, order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getEarnings = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findOne({ userId: req.user._id });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    res.json({ success: true, earnings: partner.earnings, totalDeliveries: partner.totalDeliveries });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getActiveOrder = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findOne({ userId: req.user._id }).populate('activeOrderId');
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    res.json({ success: true, order: partner.activeOrderId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
