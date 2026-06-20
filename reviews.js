const router = require('express').Router();
const axios  = require('axios');
const db     = require('../db');
const gbp    = require('../lib/gbp');
const authMiddleware = require('../middleware/auth');
const config = require('../config');
const logger = require('../lib/logger');

router.use(authMiddleware);

// ── List reviews ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { platform, status, location_id, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params     = [];

    if (platform)    { conditions.push(`r.platform = $${params.push(platform)}`); }
    if (status)      { conditions.push(`r.status = $${params.push(status)}`); }
    if (location_id) { conditions.push(`r.location_id = $${params.push(location_id)}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT r.*, l.name AS location_name, l.city AS location_city
       FROM reviews r
       LEFT JOIN locations l ON l.id = r.location_id
       ${where}
       ORDER BY r.review_date DESC
       LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(parseInt(offset))}`,
      params
    );
    res.json(rows);
  } catch (err) {
    logger.error('List reviews error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// ── Generate AI draft response ────────────────────────────────────────────
router.post('/:id/ai-draft', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, l.name AS location_name FROM reviews r
       LEFT JOIN locations l ON l.id = r.location_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Review not found' });

    const review   = rows[0];
    const { brandVoice = '', supportEmail = '', signature = 'The Team' } = req.body;

    const systemPrompt = [
      brandVoice || 'You are a professional, empathetic customer service representative. Acknowledge the customer\'s specific concern, express genuine empathy, and offer a concrete next step. Keep responses to 2–3 sentences. Never be defensive.',
      'Personalize by addressing the reviewer by their first name.',
      supportEmail ? `Always include this support contact: ${supportEmail}` : '',
      `Close with: — ${signature}`,
    ].filter(Boolean).join('\n\n');

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-6',
        max_tokens: 1000,
        system:     systemPrompt,
        messages: [{
          role:    'user',
          content: `Platform: ${review.platform}\nLocation: ${review.location_name}\nReviewer: ${review.reviewer_name}\nRating: ${review.rating}/5\nReview: "${review.review_text}"\n\nWrite a professional response.`,
        }],
      },
      { headers: { 'Content-Type': 'application/json', 'x-api-key': config.anthropic.apiKey, 'anthropic-version': '2023-06-01' } }
    );

    const draft = response.data.content[0].text;

    // Save draft to DB
    await db.query(
      `UPDATE reviews SET ai_draft = $1, status = 'draft', updated_at = NOW() WHERE id = $2`,
      [draft, req.params.id]
    );

    res.json({ draft });
  } catch (err) {
    logger.error('AI draft error', { err: err.message });
    res.status(500).json({ error: 'Failed to generate AI draft' });
  }
});

// ── Post reply to GBP ─────────────────────────────────────────────────────
router.post('/:id/reply', async (req, res) => {
  try {
    const { replyText } = req.body;
    if (!replyText) return res.status(400).json({ error: 'replyText is required' });

    const { rows } = await db.query('SELECT * FROM reviews WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Review not found' });
    const review = rows[0];

    // Get GBP token
    const { rows: tokens } = await db.query(
      `SELECT * FROM platform_tokens WHERE platform = 'google' AND status = 'active' LIMIT 1`
    );
    if (!tokens.length) return res.status(400).json({ error: 'No active GBP connection' });

    // Post to GBP
    await gbp.replyToReview(tokens[0], review.platform_review_id, replyText);

    // Update DB
    await db.query(
      `UPDATE reviews SET
         reply_text = $1, reply_date = NOW(),
         status = 'posted', ai_draft = NULL, updated_at = NOW()
       WHERE id = $2`,
      [replyText, req.params.id]
    );

    res.json({ ok: true, reply: replyText });
  } catch (err) {
    logger.error('Post reply error', { err: err.message });
    res.status(500).json({ error: 'Failed to post reply' });
  }
});

// ── Update review status ──────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { status, ai_draft } = req.body;
    const { rows } = await db.query(
      `UPDATE reviews SET
         status   = COALESCE($1, status),
         ai_draft = COALESCE($2, ai_draft),
         updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, ai_draft, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Review not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update review' });
  }
});

// ── Reply templates ───────────────────────────────────────────────────────
router.get('/templates', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM reply_templates ORDER BY name');
  res.json(rows);
});

router.post('/templates', async (req, res) => {
  const { name, body, min_rating = 4, max_rating = 5 } = req.body;
  const { rows } = await db.query(
    'INSERT INTO reply_templates (name, body, min_rating, max_rating) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, body, min_rating, max_rating]
  );
  res.status(201).json(rows[0]);
});

router.delete('/templates/:id', async (req, res) => {
  await db.query('DELETE FROM reply_templates WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
