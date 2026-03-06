const { Warehouse, DeliveryPartner, DeliveryPayConfig, DeliverySettlement, AuditLog, Notification } = require('../models/Others');
const Seller = require('../models/Seller');

// ─── Audit Log Helper ───────────────────────────
async function logAction(req, action, entity, entityId, details = {}) {
  await AuditLog.create({ userId: req.user._id, action, entity, entityId, details, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
}

// ════════════════════════════════════════════════
// WAREHOUSE CRUD
// ════════════════════════════════════════════════

exports.getWarehouses = async (req, res) => {
  try {
    const { city, type, status } = req.query;
    const filter = {};
    if (city) filter['address.city'] = { $regex: city, $options: 'i' };
    if (type) filter.type = type;
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    const warehouses = await Warehouse.find(filter)
      .populate('mappedSellers', 'businessName type')
      .populate('assignedPartners', 'name phone isOnline')
      .sort({ createdAt: -1 });
    res.json({ success: true, warehouses });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getWarehouseById = async (req, res) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id)
      .populate('mappedSellers', 'businessName type logo phone rating')
      .populate('assignedPartners', 'name phone vehicleType isOnline shiftStatus');
    if (!warehouse) return res.status(404).json({ message: 'Warehouse not found' });
    res.json({ success: true, warehouse });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createWarehouse = async (req, res) => {
  try {
    const { name, type, address, manager, capacity, operatingHours, deliveryRadius, zone } = req.body;
    const code = 'WH-' + name.substring(0, 3).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    const warehouse = await Warehouse.create({ name, code, type, address, manager, capacity, operatingHours, deliveryRadius, zone });
    await logAction(req, 'warehouse_created', 'Warehouse', warehouse._id, { name });
    res.status(201).json({ success: true, warehouse });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateWarehouse = async (req, res) => {
  try {
    const warehouse = await Warehouse.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!warehouse) return res.status(404).json({ message: 'Warehouse not found' });
    await logAction(req, 'warehouse_updated', 'Warehouse', warehouse._id);
    res.json({ success: true, warehouse });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteWarehouse = async (req, res) => {
  try {
    await Warehouse.findByIdAndDelete(req.params.id);
    await logAction(req, 'warehouse_deleted', 'Warehouse', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.toggleWarehouseStatus = async (req, res) => {
  try {
    const wh = await Warehouse.findById(req.params.id);
    wh.isActive = !wh.isActive;
    await wh.save();
    res.json({ success: true, warehouse: wh });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.mapSellerToWarehouse = async (req, res) => {
  try {
    const { sellerId } = req.body;
    const warehouse = await Warehouse.findByIdAndUpdate(req.params.id, { $addToSet: { mappedSellers: sellerId } }, { new: true });
    res.json({ success: true, warehouse });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.unmapSellerFromWarehouse = async (req, res) => {
  try {
    const warehouse = await Warehouse.findByIdAndUpdate(req.params.id, { $pull: { mappedSellers: req.params.sellerId } }, { new: true });
    res.json({ success: true, warehouse });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════
// DELIVERY PARTNER ADMIN MANAGEMENT
// ════════════════════════════════════════════════

exports.getDeliveryPartners = async (req, res) => {
  try {
    const { status, kycStatus, city, online } = req.query;
    const filter = {};
    if (kycStatus) filter.kycStatus = kycStatus;
    if (city) filter.city = { $regex: city, $options: 'i' };
    if (online === 'true') filter.isOnline = true;
    if (online === 'false') filter.isOnline = false;
    if (status === 'active') filter.kycStatus = 'verified';
    if (status === 'pending') filter.kycStatus = { $in: ['pending', 'submitted'] };
    const partners = await DeliveryPartner.find(filter)
      .populate('assignedWarehouseId', 'name code')
      .populate('activeOrderId', 'status total')
      .sort({ createdAt: -1 });
    res.json({ success: true, partners });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getDeliveryPartnerById = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findById(req.params.id)
      .populate('assignedWarehouseId', 'name code address')
      .populate('activeOrderId');
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    res.json({ success: true, partner });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.approveDeliveryPartner = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findByIdAndUpdate(req.params.id, { kycStatus: 'verified' }, { new: true });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    await Notification.create({ userId: partner.userId, type: 'kyc', title: 'KYC Approved', message: 'Your delivery partner account has been verified. You can now start accepting orders.' });
    await logAction(req, 'delivery_partner_approved', 'DeliveryPartner', partner._id, { name: partner.name });
    res.json({ success: true, partner });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.rejectDeliveryPartner = async (req, res) => {
  try {
    const { reason } = req.body;
    const partner = await DeliveryPartner.findByIdAndUpdate(req.params.id, { kycStatus: 'rejected' }, { new: true });
    if (!partner) return res.status(404).json({ message: 'Partner not found' });
    await Notification.create({ userId: partner.userId, type: 'kyc', title: 'KYC Rejected', message: reason || 'Your KYC documents were rejected. Please re-upload correct documents.' });
    await logAction(req, 'delivery_partner_rejected', 'DeliveryPartner', partner._id);
    res.json({ success: true, partner });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.assignPartnerToWarehouse = async (req, res) => {
  try {
    const { warehouseId } = req.body;
    const partner = await DeliveryPartner.findByIdAndUpdate(req.params.id, { assignedWarehouseId: warehouseId }, { new: true });
    await Warehouse.findByIdAndUpdate(warehouseId, { $addToSet: { assignedPartners: partner._id } });
    res.json({ success: true, partner });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════
// DELIVERY PAY CONFIG
// ════════════════════════════════════════════════

exports.getDeliveryPayConfig = async (req, res) => {
  try {
    let config = await DeliveryPayConfig.findOne();
    if (!config) config = await DeliveryPayConfig.create({});
    res.json({ success: true, ...config.toObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateDeliveryPayConfig = async (req, res) => {
  try {
    const config = await DeliveryPayConfig.findOneAndUpdate({}, { ...req.body, updatedBy: req.user._id }, { new: true, upsert: true });
    await logAction(req, 'delivery_pay_config_updated', 'DeliveryPayConfig', config._id, req.body);
    res.json({ success: true, ...config.toObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════
// DELIVERY SETTLEMENTS
// ════════════════════════════════════════════════

exports.getDeliverySettlements = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const settlements = await DeliverySettlement.find(filter)
      .populate('partnerId', 'name phone bankDetails')
      .sort({ createdAt: -1 });
    res.json({ success: true, settlements });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.processDeliverySettlement = async (req, res) => {
  try {
    const settlement = await DeliverySettlement.findByIdAndUpdate(
      req.params.id,
      { status: 'completed', processedAt: new Date(), transactionId: 'DTXN-' + Date.now() },
      { new: true }
    );
    await logAction(req, 'delivery_settlement_processed', 'DeliverySettlement', settlement._id, { amount: settlement.netAmount });
    res.json({ success: true, settlement });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ════════════════════════════════════════════════
// DELIVERY DASHBOARD STATS (for admin)
// ════════════════════════════════════════════════

exports.getDeliveryDashboard = async (req, res) => {
  try {
    const [totalPartners, onlinePartners, verifiedPartners, pendingKYC, totalWarehouses, activeWarehouses] = await Promise.all([
      DeliveryPartner.countDocuments(),
      DeliveryPartner.countDocuments({ isOnline: true }),
      DeliveryPartner.countDocuments({ kycStatus: 'verified' }),
      DeliveryPartner.countDocuments({ kycStatus: { $in: ['pending', 'submitted'] } }),
      Warehouse.countDocuments(),
      Warehouse.countDocuments({ isActive: true }),
    ]);
    const earningsAgg = await DeliveryPartner.aggregate([
      { $group: { _id: null, totalEarnings: { $sum: '$earnings' }, totalDeliveries: { $sum: '$totalDeliveries' } } }
    ]);
    const stats = earningsAgg[0] || {};
    res.json({
      success: true,
      totalPartners, onlinePartners, verifiedPartners, pendingKYC,
      totalWarehouses, activeWarehouses,
      totalEarnings: stats.totalEarnings || 0,
      totalDeliveries: stats.totalDeliveries || 0,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
