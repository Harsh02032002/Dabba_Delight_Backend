const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const jwt = require('jsonwebtoken');
const ic = require('../controllers/invoice.controller');

// Token-based auth for invoice download (for frontend direct access)
const tokenAuth = async (req, res, next) => {
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const User = require('../models/User');
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account blocked' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.log('❌ Token auth error:', error.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

router.post('/generate/:orderId', auth, ic.generateInvoiceForOrder);
router.get('/:invoiceId', auth, ic.getInvoice);
router.get('/download/:orderId', tokenAuth, ic.downloadInvoice); // Use tokenAuth instead of auth

module.exports = router;
