const pool = require('../db');
const { verifyAccessToken } = require('./jwt');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const deviceId = req.headers['x-device-id'];

  if (!token || !deviceId) return res.status(401).json({ error: 'unauthenticated' });

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  // Live re-check on every request — this is what makes Block/Disable effective
  // immediately, instead of waiting for the 15-minute access token to expire.
  const r = await pool.query(
    `SELECT c.status as customer_status, c.license_status, c.license_expires_at,
            d.status as device_status
     FROM customers c
     LEFT JOIN devices d ON d.customer_id = c.id AND d.device_id = $2
     WHERE c.id = $1`,
    [payload.customerId, deviceId]
  );
  const row = r.rows[0];
  if (!row) return res.status(401).json({ error: 'unauthenticated' });
  if (row.customer_status !== 'active') return res.status(403).json({ error: 'account_disabled' });
  if (row.license_status !== 'active' ||
      (row.license_expires_at && new Date(row.license_expires_at) < new Date())) {
    return res.status(403).json({ error: 'license_invalid' });
  }
  if (!row.device_status || row.device_status !== 'active') {
    return res.status(403).json({ error: 'device_not_active' });
  }

  req.customerId = payload.customerId;
  req.username = payload.username;
  req.deviceId = deviceId;
  next();
}

module.exports = { requireAuth };
