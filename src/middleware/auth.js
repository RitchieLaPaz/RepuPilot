const jwt    = require('jsonwebtoken');
const config = require('../config');

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  try {
    const token   = header.slice(7);
    req.user      = jwt.verify(token, config.jwt.secret);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
