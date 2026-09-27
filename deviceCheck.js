const pool = require('../db');

/**
 * Looks up a device for this customer. If it has never been seen before,
 * registers it as 'pending' (requires admin approval before it can be used).
 * Returns the device row (status: pending | active | blocked).
 */
async function getOrRegisterDevice(customerId, deviceId, deviceLabel) {
  const existing = await pool.query(
    'SELECT * FROM devices WHERE customer_id = $1 AND device_id = $2',
    [customerId, deviceId]
  );
  if (existing.rows[0]) {
    await pool.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [existing.rows[0].id]);
    return existing.rows[0];
  }
  const inserted = await pool.query(
    `INSERT INTO devices (customer_id, device_id, device_label, status)
     VALUES ($1, $2, $3, 'pending') RETURNING *`,
    [customerId, deviceId, deviceLabel || null]
  );
  return inserted.rows[0];
}

async function getDeviceStatus(customerId, deviceId) {
  const r = await pool.query(
    'SELECT status FROM devices WHERE customer_id = $1 AND device_id = $2',
    [customerId, deviceId]
  );
  return r.rows[0] ? r.rows[0].status : null;
}

module.exports = { getOrRegisterDevice, getDeviceStatus };
