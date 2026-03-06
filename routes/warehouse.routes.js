const router = require('express').Router();
const adminAuth = require('../middleware/admin.middleware');
const wc = require('../controllers/warehouse.controller');

// Dashboard
router.get('/delivery-dashboard', adminAuth, wc.getDeliveryDashboard);

// Warehouses
router.get('/warehouses', adminAuth, wc.getWarehouses);
router.get('/warehouses/:id', adminAuth, wc.getWarehouseById);
router.post('/warehouses', adminAuth, wc.createWarehouse);
router.put('/warehouses/:id', adminAuth, wc.updateWarehouse);
router.delete('/warehouses/:id', adminAuth, wc.deleteWarehouse);
router.patch('/warehouses/:id/toggle', adminAuth, wc.toggleWarehouseStatus);
router.post('/warehouses/:id/map-seller', adminAuth, wc.mapSellerToWarehouse);
router.delete('/warehouses/:id/unmap-seller/:sellerId', adminAuth, wc.unmapSellerFromWarehouse);

// Delivery Partners
router.get('/partners', adminAuth, wc.getDeliveryPartners);
router.get('/partners/:id', adminAuth, wc.getDeliveryPartnerById);
router.post('/partners/:id/approve', adminAuth, wc.approveDeliveryPartner);
router.post('/partners/:id/reject', adminAuth, wc.rejectDeliveryPartner);
router.post('/partners/:id/assign-warehouse', adminAuth, wc.assignPartnerToWarehouse);

// Delivery Pay Config
router.get('/pay-config', adminAuth, wc.getDeliveryPayConfig);
router.put('/pay-config', adminAuth, wc.updateDeliveryPayConfig);

// Delivery Settlements
router.get('/settlements', adminAuth, wc.getDeliverySettlements);
router.post('/settlements/:id/process', adminAuth, wc.processDeliverySettlement);

module.exports = router;
