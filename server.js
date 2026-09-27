require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./auth/authRoutes');
const workersRoutes = require('./workers/workersRoutes');
const attendanceRoutes = require('./attendance/attendanceRoutes');
const adminRoutes = require('./admin/adminRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/workers', workersRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// serve the static PWA frontend + admin dashboard
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Attendance API listening on :${port}`));
