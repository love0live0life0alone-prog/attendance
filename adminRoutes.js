const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { signAdminToken } = require('../auth/jwt');
const { requireAdmin } = require('./adminAuthMiddleware');

const router = express.Router();

// POST /api/admin/login { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const r = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
  const admin = r.rows[0];
  if (!admin || !(await bcrypt.compare(password || '', admin.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  res.json({ token: signAdminToken(admin) });
});

router.use(requireAdmin);

// GET /api/admin/customers
router.get('/customers', async (req, res) => {
  const r = await pool.query(
    `SELECT c.id, c.username, c.company_name, c.status, c.license_status, c.license_expires_at, c.created_at,
            (SELECT MAX(created_at) FROM login_history WHERE customer_id = c.id AND success = TRUE) AS last_login,
            (SELECT count(*) FROM devices WHERE customer_id = c.id AND status = 'pending') AS pending_devices
     FROM customers c ORDER BY c.id DESC`
  );
  res.json(r.rows);
});

// POST /api/admin/customers { username, password, companyName }
router.post('/customers', async (req, res) => {
  const { username, password, companyName } = req.body || {};
  if (!username || !password || !companyName) return res.status(400).json({ error: 'missing_fields' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const r = await pool.query(
      `INSERT INTO customers (username, password_hash, company_name) VALUES ($1,$2,$3)
       RETURNING id, username, company_name, status, license_status`,
      [username, hash, companyName]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
});

// PATCH /api/admin/customers/:id  { status?, licenseStatus?, licenseExpiresAt?, newPassword? }
router.patch('/customers/:id', async (req, res) => {
  const { status, licenseStatus, licenseExpiresAt, newPassword } = req.body || {};
  const sets = [], vals = []; let i = 1;
  if (status) { sets.push(`status = $${i++}`); vals.push(status); }
  if (licenseStatus) { sets.push(`license_status = $${i++}`); vals.push(licenseStatus); }
  if (licenseExpiresAt !== undefined) { sets.push(`license_expires_at = $${i++}`); vals.push(licenseExpiresAt); }
  if (newPassword) { sets.push(`password_hash = $${i++}`); vals.push(await bcrypt.hash(newPassword, 12)); }
  if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
  vals.push(req.params.id);

  await pool.query(`UPDATE customers SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  await pool.query(
    `INSERT INTO audit_log (customer_id, actor, action, new_value) VALUES ($1,$2,'admin.customer_update',$3)`,
    [req.params.id, `admin:${req.adminUsername}`, JSON.stringify(req.body)]
  );
  res.json({ ok: true });
});

// GET /api/admin/customers/:id/devices
router.get('/customers/:id/devices', async (req, res) => {
  const r = await pool.query(
    `SELECT id, device_id, device_label, status, first_seen_at, last_seen_at
     FROM devices WHERE customer_id = $1 ORDER BY first_seen_at DESC`,
    [req.params.id]
  );
  res.json(r.rows);
});

// PATCH /api/admin/devices/:id  { status: 'active' | 'blocked' | 'pending' }
router.patch('/devices/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'blocked', 'pending'].includes(status)) return res.status(400).json({ error: 'invalid_status' });

  const current = await pool.query('SELECT * FROM devices WHERE id = $1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'not_found' });

  await pool.query('UPDATE devices SET status = $1 WHERE id = $2', [status, req.params.id]);
  await pool.query(
    `INSERT INTO audit_log (customer_id, actor, action, target, old_value, new_value)
     VALUES ($1,$2,'admin.device_status',$3,$4,$5)`,
    [current.rows[0].customer_id, `admin:${req.adminUsername}`, `device:${req.params.id}`,
     JSON.stringify({ status: current.rows[0].status }), JSON.stringify({ status })]
  );
  res.json({ ok: true });
});

// DELETE /api/admin/devices/:id  (revoke entirely — also kills its sessions)
router.delete('/devices/:id', async (req, res) => {
  const current = await pool.query('SELECT * FROM devices WHERE id = $1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'not_found' });

  await pool.query('UPDATE sessions SET revoked = TRUE WHERE customer_id = $1 AND device_id = $2',
    [current.rows[0].customer_id, current.rows[0].device_id]);
  await pool.query('DELETE FROM devices WHERE id = $1', [req.params.id]);
  await pool.query(
    `INSERT INTO audit_log (customer_id, actor, action, target) VALUES ($1,$2,'admin.device_revoke',$3)`,
    [current.rows[0].customer_id, `admin:${req.adminUsername}`, `device:${req.params.id}`]
  );
  res.json({ ok: true });
});

// GET /api/admin/login-history?customerId=
router.get('/login-history', async (req, res) => {
  const { customerId } = req.query;
  const params = [];
  let query = `SELECT lh.*, c.username FROM login_history lh LEFT JOIN customers c ON c.id = lh.customer_id`;
  if (customerId) { query += ' WHERE lh.customer_id = $1'; params.push(customerId); }
  query += ' ORDER BY lh.created_at DESC LIMIT 200';
  const r = await pool.query(query, params);
  res.json(r.rows);
});

module.exports = router;
