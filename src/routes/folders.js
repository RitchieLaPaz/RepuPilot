/**
 * Folder routes — CRUD for the folder tree
 * Returns camelCase to match frontend L.folders structure
 */
const router = require('express').Router();
const db     = require('../db');
const authMiddleware = require('../middleware/auth');
const logger = require('../lib/logger');

router.use(authMiddleware);

// Map DB snake_case → frontend camelCase
const toFolder = (row) => ({
  id:        row.id,
  name:      row.name,
  type:      row.type || 'brand',
  parentId:  row.parent_id || null,
  createdAt: row.created_at,
});

// ── List all folders ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM folders ORDER BY created_at ASC`);
    res.json(rows.map(toFolder));
  } catch (err) {
    logger.error('List folders error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// ── Create folder ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, parentId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const { rows } = await db.query(
      `INSERT INTO folders (name, type, parent_id) VALUES ($1, 'brand', $2) RETURNING *`,
      [name.trim(), parentId || null]
    );
    res.status(201).json(toFolder(rows[0]));
  } catch (err) {
    logger.error('Create folder error', { err: err.message });
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// ── Rename folder ─────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const { rows } = await db.query(
      `UPDATE folders SET name = $1 WHERE id = $2 RETURNING *`,
      [name.trim(), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Folder not found' });
    res.json(toFolder(rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename folder' });
  }
});

// ── Delete folder (cascade to children + unassign listings) ───────────────
router.delete('/:id', async (req, res) => {
  try {
    await db.withTransaction(async (client) => {
      // Recursively get all descendant folder IDs
      const { rows: desc } = await client.query(
        `WITH RECURSIVE tree AS (
           SELECT id FROM folders WHERE id = $1
           UNION ALL
           SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
         ) SELECT id FROM tree`,
        [req.params.id]
      );
      const ids = desc.map(r => r.id);
      // Unassign listings in those folders
      await client.query(`UPDATE locations SET folder_id = NULL WHERE folder_id = ANY($1::uuid[])`, [ids]);
      // Delete all folders in the tree (children first via CASCADE or manual)
      await client.query(`DELETE FROM folders WHERE id = ANY($1::uuid[])`, [ids]);
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Delete folder error', { err: err.message });
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

module.exports = router;
