/**
 * Auth routes
 *
 * POST /api/auth/google/verify     — Google SSO (auto-provisions @domain users)
 * POST /api/auth/local/login       — Email + password login (local accounts)
 * POST /api/auth/local/register    — Admin creates a local account for external users
 * GET  /api/auth/me                — Returns current user from JWT
 * POST /api/auth/signout           — Sign out (stateless — client drops JWT)
 * GET  /api/auth/gbp/connect       — Generate GBP OAuth URL (admin only)
 * GET  /api/auth/gbp/callback      — GBP OAuth callback — stores encrypted tokens
 * GET  /api/auth/gbp/status        — GBP connection status
 */

const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');
const crypto  = require('crypto');
const config  = require('../config');
const db      = require('../db');
const gbp     = require('../lib/gbp');
const { encrypt } = require('../lib/encryption');
const authMiddleware = require('../middleware/auth');
const logger  = require('../lib/logger');

const BCRYPT_ROUNDS = 12;

// ── Helpers ───────────────────────────────────────────────────────────────
const issueJWT = (user) => jwt.sign(
  { userId: user.id, email: user.email, role: user.role },
  config.jwt.secret,
  { expiresIn: config.jwt.expiresIn }
);

const safeUser = (u) => ({
  id:       u.id,
  name:     u.name,
  email:    u.email,
  role:     u.role,
  provider: u.provider,
  avatar:   u.avatar_url || null,
});

const allowedDomains = () =>
  (process.env.ALLOWED_DOMAINS || '')
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

// ── Google SSO — auto-provisions team members by domain ──────────────────
router.post('/google/verify', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    const { OAuth2Client } = require('google-auth-library');
    const client  = new OAuth2Client(config.google.clientId);
    const ticket  = await client.verifyIdToken({ idToken, audience: config.google.clientId });
    const payload = ticket.getPayload();

    // Domain restriction — empty ALLOWED_DOMAINS means any Google account is ok
    const domains = allowedDomains();
    if (domains.length > 0) {
      const emailDomain = payload.email.split('@')[1]?.toLowerCase();
      if (!domains.includes(emailDomain)) {
        return res.status(403).json({
          error: `Access restricted to: ${domains.join(', ')}. Contact your admin for access.`
        });
      }
    }

    // Upsert user — first login auto-creates the record
    const { rows } = await db.query(
      `INSERT INTO users (email, name, avatar_url, provider, provider_id)
       VALUES ($1, $2, $3, 'google', $4)
       ON CONFLICT (email) DO UPDATE SET
         name          = EXCLUDED.name,
         avatar_url    = EXCLUDED.avatar_url,
         provider      = CASE WHEN users.provider = 'local' THEN 'google' ELSE EXCLUDED.provider END,
         last_login_at = NOW()
       RETURNING *`,
      [payload.email, payload.name, payload.picture, payload.sub]
    );

    const user  = rows[0];
    const token = issueJWT(user);
    logger.info('Google SSO login', { email: user.email, role: user.role });
    res.json({ token, user: safeUser(user) });

  } catch (err) {
    logger.error('Google verify error', { err: err.message });
    res.status(401).json({ error: 'Invalid Google token — please try again' });
  }
});

// ── Local login — email + password ───────────────────────────────────────
router.post('/local/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await db.query(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];

    // Must have a local password set
    if (!user.password_hash) {
      return res.status(401).json({
        error: 'This account uses Google sign-in. Please use "Continue with Google".'
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = issueJWT(user);
    logger.info('Local login', { email: user.email });
    res.json({ token, user: safeUser(user) });

  } catch (err) {
    logger.error('Local login error', { err: err.message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Local register — admin creates an account for an external user ────────
router.post('/local/register', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { email, name, password, role = 'member' } = req.body;
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'email, name, and password are required' });
    }
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'role must be admin or member' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const { rows } = await db.query(
      `INSERT INTO users (email, name, provider, role, password_hash, invited_by)
       VALUES (LOWER($1), $2, 'local', $3, $4, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, name, role, provider, created_at`,
      [email.trim(), name.trim(), role, hash, req.user.userId]
    );

    if (!rows.length) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    logger.info('Local user created', { email: rows[0].email, by: req.user.email });
    res.status(201).json(rows[0]);

  } catch (err) {
    logger.error('Local register error', { err: err.message });
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// ── List users (admin only) ───────────────────────────────────────────────
router.get('/users', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { rows } = await db.query(
      `SELECT id, email, name, role, provider, avatar_url, created_at, last_login_at
       FROM users ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ── Update user role (admin only) ─────────────────────────────────────────
router.patch('/users/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const { rows } = await db.query(
      `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, name, role`,
      [role, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ── Reset local password (admin only) ────────────────────────────────────
router.post('/users/:id/reset-password', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'password required' });
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ── Current user ──────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, name, role, provider, avatar_url FROM users WHERE id = $1`,
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(safeUser(rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ── Sign out ──────────────────────────────────────────────────────────────
router.post('/signout', authMiddleware, (req, res) => {
  res.json({ ok: true });
});

// ── GBP OAuth — admin connects Google Business Profile ────────────────────
const stateStore = new Map();

router.get('/gbp/connect', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required to connect GBP' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { userId: req.user.userId, expires: Date.now() + 10 * 60 * 1000 });
  res.json({ url: gbp.getAuthUrl(state) });
});

router.get('/gbp/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${config.frontendUrl}?gbp_error=${error}`);

    const stateData = stateStore.get(state);
    if (!stateData || stateData.expires < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired OAuth state' });
    }
    stateStore.delete(state);

    const tokens = await gbp.exchangeCode(code);
    await db.query(
      `INSERT INTO platform_tokens
         (platform, access_token_enc, refresh_token_enc, token_expiry, scope, status)
       VALUES ('google', $1, $2, $3, $4, 'active')
       ON CONFLICT DO NOTHING`,
      [
        encrypt(tokens.access_token),
        tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        tokens.scope,
      ]
    );
    res.redirect(`${config.frontendUrl}?gbp_connected=true`);
  } catch (err) {
    logger.error('GBP callback error', { err: err.message });
    res.redirect(`${config.frontendUrl}?gbp_error=callback_failed`);
  }
});

router.get('/gbp/status', authMiddleware, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, platform, status, token_expiry, last_refreshed_at, last_error, circuit_open
     FROM platform_tokens WHERE platform = 'google' LIMIT 1`
  );
  res.json({ connected: rows.length > 0, token: rows[0] || null });
});

module.exports = router;
