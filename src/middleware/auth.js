const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const authenticateSocket = (socket, next) => {
  const token = socket.handshake.auth?.token;
  console.log('[Socket] connect attempt, token:', token ? 'present' : 'MISSING');
  if (!token) {
    console.log('[Socket] rejected: no token');
    return next(new Error('No token'));
  }
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[Socket] authenticated:', socket.user.username);
    next();
  } catch (err) {
    console.log('[Socket] rejected: invalid token', err.message);
    next(new Error('Invalid token'));
  }
};

module.exports = { authenticate, authenticateSocket };
