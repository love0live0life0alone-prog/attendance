-- ==========================================================
-- Attendance SaaS schema — PostgreSQL
-- Multi-tenant: every business-data table carries customer_id
-- and every query in the app MUST filter by it (never trust
-- the frontend for isolation).
-- ==========================================================

CREATE TABLE IF NOT EXISTS customers (
  id                  SERIAL PRIMARY KEY,
  username            TEXT UNIQUE NOT NULL,
  password_hash       TEXT NOT NULL,
  company_name        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',   -- active | disabled
  license_status      TEXT NOT NULL DEFAULT 'active',   -- active | expired | revoked
  license_expires_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id             SERIAL PRIMARY KEY,
  customer_id    INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,          -- random id generated client-side on first load
  device_label   TEXT,                   -- e.g. browser/OS guess, editable by admin
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | active | blocked
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, device_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id                  SERIAL PRIMARY KEY,
  customer_id         INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  device_id           TEXT NOT NULL,
  refresh_token_hash  TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked             BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS login_history (
  id           SERIAL PRIMARY KEY,
  customer_id  INT REFERENCES customers(id) ON DELETE CASCADE,
  device_id    TEXT,
  ip           TEXT,
  user_agent   TEXT,
  success      BOOLEAN NOT NULL,
  reason       TEXT,   -- ok | bad_password | device_pending | device_blocked | account_disabled | license_invalid
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workers (
  id            SERIAL PRIMARY KEY,
  customer_id   INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  worker_code   TEXT NOT NULL,           -- unique per customer, e.g. W001
  name          TEXT NOT NULL,
  archived      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, worker_code)
);

CREATE TABLE IF NOT EXISTS attendance (
  id            SERIAL PRIMARY KEY,
  worker_id     INT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  customer_id   INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  work_date     DATE NOT NULL,
  check_in      TIMESTAMPTZ,
  check_out     TIMESTAMPTZ,
  UNIQUE(worker_id, work_date)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  customer_id  INT REFERENCES customers(id) ON DELETE CASCADE,
  actor        TEXT NOT NULL,     -- 'admin:<username>' or 'customer:<username>' or 'system'
  action       TEXT NOT NULL,     -- e.g. 'attendance.edit', 'device.block', 'worker.rename'
  target       TEXT,
  old_value    JSONB,
  new_value    JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  id             SERIAL PRIMARY KEY,
  username       TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workers_customer ON workers(customer_id);
CREATE INDEX IF NOT EXISTS idx_attendance_customer ON attendance(customer_id);
CREATE INDEX IF NOT EXISTS idx_attendance_worker_date ON attendance(worker_id, work_date);
CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices(customer_id, device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_customer ON sessions(customer_id, device_id);
