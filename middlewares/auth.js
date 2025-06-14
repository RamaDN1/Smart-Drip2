require('dotenv').config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// توليد توكن JWT
const generateToken = (userId, role) => {
  return jwt.sign(
    {    userId, role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// مقارنة كلمة المرور
const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

// التحقق من التوكن
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token, authorization denied' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// التحقق من الصلاحيات
const checkRole = (allowedRoles) => {
  return (req, res, next) => {
      if (!allowedRoles.includes(req.user.role)) {
          return res.status(403).json({ error: 'Access denied' });
      }
    next();
  };
};

module.exports = {
  generateToken,
  comparePassword,
  checkRole,
  authenticateToken
};
