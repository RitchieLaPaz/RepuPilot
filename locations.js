const router = require('express').Router();
const db     = require('../db');
const gbp    = require('../lib/gbp');
const { scheduleReviewPoll } = require('../lib/queue');
const authMiddleware = require('../middleware/auth');
const logger = require('../lib/logger');

// All routes require auth
router.use(authMiddleware);

// ── List all locations ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.*, f.name AS folder_name, f.type AS folder_type
       FROM locations l
       LEFT JOIN folders f ON f.id = l.folder_id
       ORDER BY l.name`
    );
    res.json(rows);
  } catch (err) {
    logger.error('List locations error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// ── Create location manually ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, address, city, phone, category, folder_id, gbp_location_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const { rows } = await db.query(
      `INSERT INTO locations (name, address, city, phone, category, folder_id, gbp_location_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, address, city, phone, category, folder_id || null, gbp_location_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('Create location error', { err: err.message });
    res.status(500).json({ error: 'Failed to create location' });
  }
});

// ── Discover locations from GBP ───────────────────────────────────────────
// Calls GBP API, returns discovered locations without importing them yet
router.get('/discover', async (req, res) => {
  try {
    // Get the active GBP token
    const { rows: tokens } = await db.query(
      `SELECT * FROM platform_tokens WHERE platform = 'google' AND status = 'active' LIMIT 1`
    );
    if (!tokens.length) {
      return res.status(400).json({ error: 'No active Google Business Profile connection' });
    }

    const accounts  = await gbp.listAccounts(tokens[0]);
    const discovered = [];

    for (const account of accounts) {
      const locations = await gbp.listLocations(tokens[0], account.name);
      discovered.push(...locations.map(loc => ({
        gbp_location_id: loc.name,
        gbp_account_id:  account.name,
        name:    loc.title || loc.name,
        address: loc.storefrontAddress?.addressLines?.join(', '),
        city:    [loc.storefrontAddress?.locality, loc.storefrontAddress?.administrativeArea].filter(Boolean).join(', '),
        phone:   loc.phoneNumbers?.primaryPhone,
        category: loc.categories?.primaryCategory?.displayName,
      })));
    }

    // Flag which are already imported
    const { rows: existing } = await db.query('SELECT gbp_location_id FROM locations WHERE gbp_location_id IS NOT NULL');
    const existingIds = new Set(existing.map(r => r.gbp_location_id));

    res.json(discovered.map(loc => ({ ...loc, already_imported: existingIds.has(loc.gbp_location_id) })));
  } catch (err) {
    logger.error('Discover locations error', { err: err.message });
    res.status(500).json({ error: 'Failed to discover locations from GBP' });
  }
});

// ── Import selected locations from GBP ───────────────────────────────────
router.post('/import', async (req, res) => {
  try {
    const { locations, folder_id } = req.body; // locations: array of discovered location objects
    if (!Array.isArray(locations) || !locations.length) {
      return res.status(400).json({ error: 'locations array is required' });
    }

    const imported = [];
    for (const loc of locations) {
      const { rows } = await db.query(
        `INSERT INTO locations (name, address, city, phone, category, folder_id, gbp_location_id, gbp_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (gbp_location_id) DO UPDATE SET
           name = EXCLUDED.name, updated_at = NOW()
         RETURNING *`,
        [loc.name, loc.address, loc.city, loc.phone, loc.category,
         folder_id || null, loc.gbp_location_id, loc.gbp_account_id]
      );
      imported.push(rows[0]);

      // Kick off an initial review poll for each imported location
      await scheduleReviewPoll(rows[0].id, loc.gbp_account_id, loc.gbp_location_id, 'high');
    }

    res.status(201).json({ imported, count: imported.length });
  } catch (err) {
    logger.error('Import locations error', { err: err.message });
    res.status(500).json({ error: 'Failed to import locations' });
  }
});

// ── Update location ───────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { name, address, city, phone, category, folder_id } = req.body;
    const { rows } = await db.query(
      `UPDATE locations SET
         name      = COALESCE($1, name),
         address   = COALESCE($2, address),
         city      = COALESCE($3, city),
         phone     = COALESCE($4, phone),
         category  = COALESCE($5, category),
         folder_id = COALESCE($6, folder_id),
         updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [name, address, city, phone, category, folder_id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Location not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// ── Delete location ───────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM locations WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

module.exports = router;
