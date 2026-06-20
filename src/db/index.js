const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');
const config   = require('../config');
const logger   = require('../lib/logger');

const pool = new Pool({
  connectionString: config.db.url,
  ssl: config.env === 'production' ? { rejectUnauthorized: false } : false,
  max:             10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', { err: err.message });
});

// ── Query helper ──────────────────────────────────────────────────────────
const query = (text, params) => pool.query(text, params);

// ── Transaction helper ────────────────────────────────────────────────────
const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Run schema migration ──────────────────────────────────────────────────
const migrate = async () => {
  const schemaPath = path.join(__dirname, '../../db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  logger.info('Running database migration...');
  await pool.query(sql);
  logger.info('Migration complete');
};

module.exports = { query, withTransaction, migrate, pool };
