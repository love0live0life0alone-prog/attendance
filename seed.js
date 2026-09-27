require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/db');

// Usage: node db/seed.js admin_username admin_password
async function run() {
  const [adminUser, adminPass] = process.argv.slice(2);
  if (!adminUser || !adminPass) {
    console.log('Usage: node db/seed.js <admin_username> <admin_password>');
    process.exit(1);
  }

  const hash = await bcrypt.hash(adminPass, 12);
  await pool.query(
    `INSERT INTO admins (username, password_hash) VALUES ($1,$2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [adminUser, hash]
  );
  console.log(`✔ Super admin ready: ${adminUser}`);
  await pool.end();
}

run().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
