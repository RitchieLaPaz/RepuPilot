/**
 * Reddit Signals routes
 */
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const logger = require('../lib/logger');

router.use(auth);

// ── List signals ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { brand, status } = req.query;
    let q = `SELECT * FROM reddit_signals WHERE 1=1`;
    const params = [];
    if (brand)  { params.push(brand);  q += ` AND brand = $${params.length}`; }
    if (status) { params.push(status); q += ` AND status = $${params.length}`; }
    q += ` ORDER BY urgency_score DESC, created_at DESC LIMIT 100`;
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch (err) {
    logger.error('Reddit signals fetch error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// ── Scanner status ────────────────────────────────────────────────────────
router.get('/scanner-status', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT last_cycle, next_in_minutes FROM scanner_status WHERE id = 1`
    );
    res.json(rows[0] || { last_cycle: null, next_in_minutes: 30 });
  } catch (err) {
    res.json({ last_cycle: null, next_in_minutes: 30 });
  }
});

// ── Update signal status ──────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { status, responded_by, response_text } = req.body;
    const { rows } = await db.query(
      `UPDATE reddit_signals SET status=$1, responded_by=$2, response_text=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [status, responded_by || null, response_text || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Signal not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update signal' });
  }
});

// ── Manual scan trigger ───────────────────────────────────────────────────
router.post('/scan', async (req, res) => {
  try {
    const { runCycle } = require('../scanner');
    runCycle();
    res.json({ ok: true, message: 'Scan triggered' });
  } catch (err) {
    res.status(500).json({ error: 'Scanner not available' });
  }
});

module.exports = router;
