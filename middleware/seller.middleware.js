const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Seller = require('../models/Seller');

// Routes that are allowed even without KYC verification
const KYC_EXEMPT_ROUTES = ['/kyc', '/profile', '/notifications', '/settings'];

const sellerAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'No token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || user.role !== 'seller') return res.status(403).json({ message: 'Not a seller' });

    let seller = await Seller.findOne({ userId: user._id });

    // Auto-create seller profile if missing (for upgraded accounts)
    if (!seller) {
      try {
        seller = await Seller.create({
          userId: user._id,
          businessName: user.businessName || user.name || 'New Seller',
          phone: user.phone || '',
          email: user.email,
        });
      } catch (err) {
        console.error('Failed to create seller profile:', err);
        return res.status(500).json({ message: 'Seller profile not found and could not be created' });
      }
    }

    req.user = user;
    req.seller = seller;
    req.user.sellerId = seller._id;

    // Check KYC status — block non-verified sellers from most routes
    const isExempt = KYC_EXEMPT_ROUTES.some(route => req.path.startsWith(route));
    if (!isExempt && seller.kycStatus !== 'verified') {
      return res.status(403).json({
        success: false,
        message: 'KYC verification required',
        kycStatus: seller.kycStatus,
        requiresKYC: true,
      });
    }

    next();
  } catch (err) {
    console.error('Seller auth error:', err);
    res.status(401).json({ message: 'Authentication failed' });
  }
};

module.exports = sellerAuth;
