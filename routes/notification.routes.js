const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const nc = require('../controllers/user.controller');

router.get('/', auth, nc.getNotifications);
router.patch('/:id/read', auth, nc.markNotificationRead);
router.patch('/mark-all-read', auth, nc.markAllNotificationsRead);
router.delete('/:id', auth, nc.deleteNotification);

module.exports = router;
