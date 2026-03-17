const jwt = require('jsonwebtoken');
const User = require('../models/User');

const adminAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      console.log('Admin auth: No token provided');
      return res.status(401).json({ message: 'No token provided' });
    }

    console.log('Admin auth: Verifying token...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key-for-development');
    console.log('Admin auth: Token decoded for user:', decoded.email);
    
    const user = await User.findById(decoded.id);
    if (!user) {
      console.log('Admin auth: User not found');
      return res.status(403).json({ message: 'User not found' });
    }
    
    if (user.role !== 'admin') {
      console.log('Admin auth: User role is not admin:', user.role);
      return res.status(403).json({ message: 'Admin access required' });
    }

    console.log('Admin auth: Successfully authenticated admin:', user.email);
    req.user = user;
    next();
  } catch (err) {
    console.error('Admin auth error:', err.message);
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    } else if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    res.status(401).json({ message: 'Authentication failed' });
  }
};

module.exports = adminAuth;
