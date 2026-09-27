const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../auth/authMiddleware');
const { computeMonthStatuses } = require('./compensation');

const router = express.Router();
router.use(requireAuth);

async function ownWorker(customerId, workerId) {
  const r = await pool.query('SELECT id FROM workers WHERE id = $1 AND customer_id = $2', [workerId, customerId]);
  return !!r.rows[0];
}

function hhmm(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dateStr(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// POST /api/attendance/:workerId/checkin
router.post('/:workerId/checkin', async (req, res) => {
  const { workerId } = req.params;
  if (!(await ownWorker(req.customerId, workerId))) return res.status(404).json({ error: 'not_found' });

  const now = new Date(); // server time — source of truth
  const today = dateStr(now);

  const existing = await pool.query(
    'SELECT * FROM attendance WHERE worker_id = $1 AND work_date = $2', [workerId, today]
  );
  if (existing.rows[0] && existing.rows[0].check_in) {
    return res.status(409).json({ error: 'already_checked_in' });
  }

  const r = await pool.query(
    `INSERT INTO attendance (worker_id, customer_id, work_date, check_in)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (worker_id, work_date) DO UPDATE SET check_in = EXCLUDED.check_in
     RETURNING check_in`,
    [workerId, req.customerId, today, now]
  );
  res.json({ ok: true, in: hhmm(now), date: today });
});

// POST /api/attendance/:workerId/checkout
router.post('/:workerId/checkout', async (req, res) => {
  const { workerId } = req.params;
  if (!(await ownWorker(req.customerId, workerId))) return res.status(404).json({ error: 'not_found' });

  const now = new Date();
  const today = dateStr(now);

  const existing = await pool.query(
    'SELECT * FROM attendance WHERE worker_id = $1 AND work_date = $2', [workerId, today]
  );
  if (!existing.rows[0] || !existing.rows[0].check_in) {
    return res.status(409).json({ error: 'no_checkin_yet' }); // can't check OUT without a valid IN
  }
  if (existing.rows[0].check_out) {
    return res.status(409).json({ error: 'already_checked_out' });
  }

  await pool.query('UPDATE attendance SET check_out = $1 WHERE worker_id = $2 AND work_date = $3',
    [now, workerId, today]);
  res.json({ ok: true, out: hhmm(now), date: today });
});

// GET /api/attendance/:workerId/month/:year/:month   (month = 1-12)
router.get('/:workerId/month/:year/:month', async (req, res) => {
  const { workerId, year, month } = req.params;
  if (!(await ownWorker(req.customerId, workerId))) return res.status(404).json({ error: 'not_found' });

  const y = parseInt(year, 10), m = parseInt(month, 10) - 1;
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const end = `${y}-${String(m + 1).padStart(2, '0')}-31`;

  const rows = await pool.query(
    `SELECT work_date, check_in, check_out FROM attendance
     WHERE worker_id = $1 AND work_date BETWEEN $2 AND $3`,
    [workerId, start, end]
  );

  const records = new Map();
  for (const row of rows.rows) {
    const ds = dateStr(new Date(row.work_date));
    records.set(ds, {
      in: row.check_in ? hhmm(new Date(row.check_in)) : null,
      out: row.check_out ? hhmm(new Date(row.check_out)) : null
    });
  }

  const days = computeMonthStatuses(records, y, m);
  res.json({ year: y, month: m + 1, days });
});

// GET /api/attendance/:workerId/today  (for the list view "دخول/خروج" badges)
router.get('/:workerId/today', async (req, res) => {
  const { workerId } = req.params;
  if (!(await ownWorker(req.customerId, workerId))) return res.status(404).json({ error: 'not_found' });
  const today = dateStr(new Date());
  const r = await pool.query('SELECT check_in, check_out FROM attendance WHERE worker_id=$1 AND work_date=$2',
    [workerId, today]);
  const row = r.rows[0];
  res.json({
    in: row?.check_in ? hhmm(new Date(row.check_in)) : null,
    out: row?.check_out ? hhmm(new Date(row.check_out)) : null
  });
});

module.exports = router;
