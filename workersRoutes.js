const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../auth/authMiddleware');

const router = express.Router();
router.use(requireAuth);

async function nextWorkerCode(customerId) {
  const r = await pool.query(
    `SELECT worker_code FROM workers WHERE customer_id = $1 ORDER BY id DESC LIMIT 1`,
    [customerId]
  );
  const last = r.rows[0]?.worker_code;
  const n = last ? parseInt(last.replace(/\D/g, ''), 10) + 1 : 1;
  return 'W' + String(n).padStart(3, '0');
}

// GET /api/workers?search=   (includes today's check-in/out so the list can show it in one call)
router.get('/', async (req, res) => {
  const { search } = req.query;
  let query = `
    SELECT w.id, w.worker_code, w.name, w.archived,
           to_char(a.check_in, 'HH24:MI') AS today_in,
           to_char(a.check_out, 'HH24:MI') AS today_out
    FROM workers w
    LEFT JOIN attendance a ON a.worker_id = w.id AND a.work_date = CURRENT_DATE
    WHERE w.customer_id = $1 AND w.archived = FALSE`;
  const params = [req.customerId];
  if (search) {
    query += ` AND (w.name ILIKE $2 OR w.worker_code ILIKE $2)`;
    params.push(`%${search}%`);
  }
  query += ' ORDER BY w.id ASC';
  const r = await pool.query(query, params);
  res.json(r.rows);
});

// POST /api/workers { name }
router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name_required' });
  const code = await nextWorkerCode(req.customerId);
  const r = await pool.query(
    `INSERT INTO workers (customer_id, worker_code, name) VALUES ($1,$2,$3) RETURNING id, worker_code, name`,
    [req.customerId, code, name.trim()]
  );
  res.status(201).json(r.rows[0]);
});

// PATCH /api/workers/:id { name }
router.patch('/:id', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name_required' });

  const current = await pool.query(
    'SELECT * FROM workers WHERE id = $1 AND customer_id = $2', [req.params.id, req.customerId]
  );
  if (!current.rows[0]) return res.status(404).json({ error: 'not_found' });

  await pool.query('UPDATE workers SET name = $1 WHERE id = $2 AND customer_id = $3',
    [name.trim(), req.params.id, req.customerId]);

  await pool.query(
    `INSERT INTO audit_log (customer_id, actor, action, target, old_value, new_value)
     VALUES ($1,$2,'worker.rename',$3,$4,$5)`,
    [req.customerId, `customer:${req.username}`, `worker:${req.params.id}`,
     JSON.stringify({ name: current.rows[0].name }), JSON.stringify({ name: name.trim() })]
  );
  res.json({ ok: true });
});

// PATCH /api/workers/:id/archive
router.patch('/:id/archive', async (req, res) => {
  const r = await pool.query(
    'UPDATE workers SET archived = TRUE WHERE id = $1 AND customer_id = $2 RETURNING id',
    [req.params.id, req.customerId]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  await pool.query(
    `INSERT INTO audit_log (customer_id, actor, action, target) VALUES ($1,$2,'worker.archive',$3)`,
    [req.customerId, `customer:${req.username}`, `worker:${req.params.id}`]
  );
  res.json({ ok: true });
});

module.exports = router;
