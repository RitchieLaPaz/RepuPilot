/**
 * Auth routes
 *
 * Two separate OAuth flows:
 * 1. RepuPilot user login  → /api/auth/google/login  → issues JWT for app access
 * 2. GBP API connection    → /api/auth/gbp/connect   → stores encrypted GBP tokens
 *
 * These use the same Google OAuth client but different scopes and purposes.
 */

const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const config  = require('../config');
const db      = require('../db');
const gbp     = require('../lib/gbp');
const { encrypt } = require('../lib/encryption');
const authMiddleware = require('../middleware/auth');
const logger  = require('../lib/logger');

// In-memory CSRF state store (use Redis in production for multi-instance)
const stateStore = new Map();

// ── 1. RepuPilot user login via Google SSO ────────────────────────────────

// The frontend handles Google One Tap / popup and sends the id_token here
POST /api/auth/google/verify  (not an OAuth redirect — just token verification)
router.post('/google/verify', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    const { OAuth2Client } = require('google-auth-library');
    const client  = new OAuth2Client(config.google.clientId);
    const ticket  = await client.verifyIdToken({ idToken, audience: config.google.clientId });
    const payload = ticket.getPayload();

    // Upsert user
    const { rows } = await db.query(
      `INSERT INTO users (email, name, avatar_url, provider, provider_id)
       VALUES ($1, $2, $3, 'google', $4)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         avatar_url = EXCLUDED.avatar_url,
         last_login_at = NOW()
       RETURNING *`,
      [payload.email, payload.name, payload.picture, payload.sub]
    );

    const user  = rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    logger.error('Google verify error', { err: err.message });
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

// ── 2. GBP API connection (admin only) ────────────────────────────────────

// Step 1: Generate authorization URL → redirect admin to Google
router.get('/gbp/connect', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required to connect GBP' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { userId: req.user.userId, expires: Date.now() + 10 * 60 * 1000 });
  const url = gbp.getAuthUrl(state);
  res.json({ url });
});

// Step 2: Google redirects here with auth code
router.get('/gbp/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      logger.warn('GBP OAuth cancelled or denied', { error });
      return res.redirect(`${config.frontendUrl}?gbp_error=${error}`);
    }

    // Validate CSRF state
    const stateData = stateStore.get(state);
    if (!stateData || stateData.expires < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired OAuth state' });
    }
    stateStore.delete(state);

    // Exchange code for tokens
    const tokens = await gbp.exchangeCode(code);
    logger.info('GBP tokens received', { hasRefresh: !!tokens.refresh_token });

    // Store encrypted tokens
    const { rows } = await db.query(
      `INSERT INTO platform_tokens
         (platform, access_token_enc, refresh_token_enc, token_expiry, scope, status)
       VALUES ('google', $1, $2, $3, $4, 'active')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        encrypt(tokens.access_token),
        tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        tokens.scope,
      ]
    );

    logger.info('GBP token stored', { tokenId: rows[0]?.id });

    // Trigger location discovery (fire and forget)
    // TODO: queue a discovery job here
    res.redirect(`${config.frontendUrl}?gbp_connected=true`);
  } catch (err) {
    logger.error('GBP callback error', { err: err.message });
    res.redirect(`${config.frontendUrl}?gbp_error=callback_failed`);
  }
});

// ── Connection status ─────────────────────────────────────────────────────
router.get('/gbp/status', authMiddleware, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, platform, status, token_expiry, last_refreshed_at, last_error, circuit_open
     FROM platform_tokens WHERE platform = 'google' LIMIT 1`
  );
  res.json({ connected: rows.length > 0, token: rows[0] || null });
});

// ── Sign out ──────────────────────────────────────────────────────────────
router.post('/signout', authMiddleware, (req, res) => {
  // JWT is stateless — client just deletes the token
  // Optionally blacklist here if needed
  res.json({ ok: true });
});

module.exports = router;
