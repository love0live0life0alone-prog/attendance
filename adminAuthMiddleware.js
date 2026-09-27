const { verifyAdminToken } = require('../auth/jwt');

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const payload = verifyAdminToken(token);
    if (payload.role !== 'admin') throw new Error('not_admin');
    req.adminUsername = payload.username;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

module.exports = { requireAdmin };
