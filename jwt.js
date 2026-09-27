const jwt = require('jsonwebtoken');

const ACCESS_TTL = '15m';
const ADMIN_TTL = '2h';

function signAccessToken(customer) {
  return jwt.sign(
    { customerId: customer.id, username: customer.username, type: 'access' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function signAdminToken(admin) {
  return jwt.sign(
    { adminId: admin.id, username: admin.username, role: 'admin' },
    process.env.JWT_ADMIN_SECRET,
    { expiresIn: ADMIN_TTL }
  );
}

function verifyAdminToken(token) {
  return jwt.verify(token, process.env.JWT_ADMIN_SECRET);
}

module.exports = { signAccessToken, verifyAccessToken, signAdminToken, verifyAdminToken };
