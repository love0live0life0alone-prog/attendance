const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { signAccessToken } = require('./jwt');
const { getOrRegisterDevice } = require('../devices/deviceCheck');

const router = express.Router();
const REFRESH_TTL_DAYS = 30;

function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

async function logAttempt({ customerId, deviceId, req, success, reason }) {
  await pool.query(
    `INSERT INTO login_history (customer_id, device_id, ip, user_agent, success, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [customerId || null, deviceId || null, req.ip, req.headers['user-agent'] || null, success, reason]
  );
}

// POST /api/auth/login  { username, password, deviceId, deviceLabel }
router.post('/login', async (req, res) => {
  const { username, password, deviceId, deviceLabel } = req.body || {};
  if (!username || !password || !deviceId) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const result = await pool.query('SELECT * FROM customers WHERE username = $1', [username]);
  const customer = result.rows[0];

  if (!customer) {
    await logAttempt({ deviceId, req, success: false, reason: 'bad_password' });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const passOk = await bcrypt.compare(password, customer.password_hash);
  if (!passOk) {
    await logAttempt({ customerId: customer.id, deviceId, req, success: false, reason: 'bad_password' });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  if (customer.status !== 'active') {
    await logAttempt({ customerId: customer.id, deviceId, req, success: false, reason: 'account_disabled' });
    return res.status(403).json({ error: 'account_disabled' });
  }

  if (customer.license_status !== 'active' ||
      (customer.license_expires_at && new Date(customer.license_expires_at) < new Date())) {
    await logAttempt({ customerId: customer.id, deviceId, req, success: false, reason: 'license_invalid' });
    return res.status(403).json({ error: 'license_invalid' });
  }

  const device = await getOrRegisterDevice(customer.id, deviceId, deviceLabel);

  if (device.status === 'pending') {
    await logAttempt({ customerId: customer.id, deviceId, req, success: false, reason: 'device_pending' });
    return res.status(403).json({ error: 'device_pending', message: 'بانتظار موافقة الأدمن على هذا الجهاز' });
  }
  if (device.status === 'blocked') {
    await logAttempt({ customerId: customer.id, deviceId, req, success: false, reason: 'device_blocked' });
    return res.status(403).json({ error: 'device_blocked' });
  }

  // device.status === 'active' -> issue tokens
  const accessToken = signAccessToken(customer);
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO sessions (customer_id, device_id, refresh_token_hash, expires_at)
     VALUES ($1,$2,$3,$4)`,
    [customer.id, deviceId, hashToken(refreshToken), expiresAt]
  );

  await logAttempt({ customerId: customer.id, deviceId, req, success: true, reason: 'ok' });

  res.json({
    accessToken,
    refreshToken,
    customer: { id: customer.id, username: customer.username, companyName: customer.company_name }
  });
});

// POST /api/auth/refresh { refreshToken, deviceId }
router.post('/refresh', async (req, res) => {
  const { refreshToken, deviceId } = req.body || {};
  if (!refreshToken || !deviceId) return res.status(400).json({ error: 'missing_fields' });

  const hash = hashToken(refreshToken);
  const r = await pool.query(
    `SELECT s.*, c.username, c.status as customer_status, c.license_status
     FROM sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.refresh_token_hash = $1 AND s.device_id = $2`,
    [hash, deviceId]
  );
  const session = r.rows[0];
  if (!session || session.revoked || new Date(session.expires_at) < new Date()) {
    return res.status(401).json({ error: 'invalid_session' });
  }
  if (session.customer_status !== 'active' || session.license_status !== 'active') {
    return res.status(403).json({ error: 'account_or_license_invalid' });
  }

  const deviceStatus = await pool.query(
    'SELECT status FROM devices WHERE customer_id = $1 AND device_id = $2',
    [session.customer_id, deviceId]
  );
  if (!deviceStatus.rows[0] || deviceStatus.rows[0].status !== 'active') {
    return res.status(403).json({ error: 'device_not_active' });
  }

  const accessToken = signAccessToken({ id: session.customer_id, username: session.username });
  res.json({ accessToken });
});

// POST /api/auth/logout { refreshToken }
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await pool.query('UPDATE sessions SET revoked = TRUE WHERE refresh_token_hash = $1', [hashToken(refreshToken)]);
  }
  res.json({ ok: true });
});

module.exports = router;
