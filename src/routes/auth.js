/**
 * Auth routes — Google SSO, local login, invite system, user management
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
const INVITE_EXPIRY_DAYS = 7;

// ── Helpers ───────────────────────────────────────────────────────────────
const issueJWT = (user) => jwt.sign(
  { userId: user.id, email: user.email, role: user.role },
  config.jwt.secret,
  { expiresIn: config.jwt.expiresIn }
);
const safeUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, provider: u.provider, avatar: u.avatar_url || null });
const allowedDomains = () => (process.env.ALLOWED_DOMAINS || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

// ── Email helper via Resend ───────────────────────────────────────────────
const sendEmail = async ({ to, subject, html }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  if (!apiKey) { logger.warn('RESEND_API_KEY not set — email not sent'); return; }
  const { Resend } = require('resend');
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({ from, to, subject, html });
  if (error) logger.error('Resend error', { message: error.message, name: error.name, to, from });
  else logger.info('Email sent', { to, subject, id: data?.id });
};

// ── Invite email template ─────────────────────────────────────────────────
const inviteEmail = ({ name, inviterName, inviteUrl, expiryDays }) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f6f4;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:0.5px solid rgba(0,0,0,.1);">
    <div style="background:#1a1a18;padding:24px 32px;display:flex;align-items:center;gap:10px;">
      <div style="width:36px;height:36px;background:#fff;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;">✈</div>
      <span style="color:#fff;font-size:18px;font-weight:500;margin-left:10px;">RepuPilot</span>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#1a1a18;">You've been invited</h2>
      <p style="margin:0 0 20px;font-size:15px;color:#6b6b66;line-height:1.6;">
        <strong>${inviterName}</strong> has invited you to join RepuPilot — the reputation management platform for multi-location businesses.
      </p>
      <p style="margin:0 0 28px;font-size:15px;color:#6b6b66;">Hi <strong>${name}</strong>, click below to set your password and activate your account.</p>
      <a href="${inviteUrl}" style="display:inline-block;background:#1a1a18;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500;">Accept invitation →</a>
      <p style="margin:24px 0 0;font-size:12px;color:#9c9c96;">This invite expires in ${expiryDays} days. If you didn't expect this, you can ignore it.</p>
      <p style="margin:8px 0 0;font-size:11px;color:#b0b0a8;word-break:break-all;">${inviteUrl}</p>
    </div>
  </div>
</body>
</html>`;

// ── Google SSO ────────────────────────────────────────────────────────────
router.post('/google/verify', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });
    const { OAuth2Client } = require('google-auth-library');
    const client  = new OAuth2Client(config.google.clientId);
    const ticket  = await client.verifyIdToken({ idToken, audience: config.google.clientId });
    const payload = ticket.getPayload();
    const domains = allowedDomains();
    if (domains.length > 0) {
      const emailDomain = payload.email.split('@')[1]?.toLowerCase();
      if (!domains.includes(emailDomain)) {
        return res.status(403).json({ error: `Access restricted to: ${domains.join(', ')}` });
      }
    }
    const { rows } = await db.query(
      `INSERT INTO users (email, name, avatar_url, provider, provider_id)
       VALUES ($1, $2, $3, 'google', $4)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url,
         provider = CASE WHEN users.provider = 'local' THEN 'google' ELSE EXCLUDED.provider END,
         last_login_at = NOW()
       RETURNING *`,
      [payload.email, payload.name, payload.picture, payload.sub]
    );
    res.json({ token: issueJWT(rows[0]), user: safeUser(rows[0]) });
  } catch (err) {
    logger.error('Google verify error', { err: err.message });
    res.status(401).json({ error: 'Invalid Google token — please try again' });
  }
});

// ── Local login ───────────────────────────────────────────────────────────
router.post('/local/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { rows } = await db.query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email.trim()]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const user = rows[0];
    if (!user.password_hash) return res.status(401).json({ error: 'This account uses Google sign-in. Use "Continue with Google".' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    res.json({ token: issueJWT(user), user: safeUser(user) });
  } catch (err) {
    logger.error('Local login error', { err: err.message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Send invite ───────────────────────────────────────────────────────────
router.post('/invite', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { email, name, role = 'member' } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'email and name required' });

    // Check not already a user
    const { rows: existing } = await db.query('SELECT id, provider FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing.length) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    // Revoke any existing pending invite for this email
    await db.query(`DELETE FROM invitations WHERE LOWER(email) = LOWER($1) AND accepted_at IS NULL`, [email]);

    // Create invite token
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO invitations (email, name, role, token, invited_by, expires_at)
       VALUES (LOWER($1), $2, $3, $4, $5, $6)`,
      [email, name, role, token, req.user.userId, expiresAt]
    );

    const inviteUrl = `${config.frontendUrl}?invite=${token}`;

    // Email optional — only send if RESEND_API_KEY is configured and domain is verified
    if (process.env.RESEND_API_KEY) {
      const { rows: inviterRows } = await db.query('SELECT name FROM users WHERE id = $1', [req.user.userId]);
      const inviterName = inviterRows[0]?.name || 'Your team';
      await sendEmail({
        to:      email,
        subject: `${inviterName} invited you to RepuPilot`,
        html:    inviteEmail({ name, inviterName, inviteUrl, expiryDays: INVITE_EXPIRY_DAYS }),
      });
    }

    logger.info('Invite created', { to: email, by: req.user.email, url: inviteUrl });
    res.status(201).json({ ok: true, inviteUrl, message: `Invite link created for ${email}` });
  } catch (err) {
    logger.error('Invite error', { err: err.message });
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// ── Verify invite token ───────────────────────────────────────────────────
router.get('/invite/:token', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, u.name AS inviter_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.token = $1 AND i.accepted_at IS NULL AND i.expires_at > NOW()`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invite link is invalid or has expired' });
    const inv = rows[0];
    res.json({ name: inv.name, email: inv.email, role: inv.role, inviterName: inv.inviter_name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify invite' });
  }
});

// ── Accept invite ─────────────────────────────────────────────────────────
router.post('/invite/:token/accept', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const { rows } = await db.query(
      `SELECT * FROM invitations
       WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invite link is invalid or has expired' });
    const inv = rows[0];

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create user
    const { rows: userRows } = await db.query(
      `INSERT INTO users (email, name, provider, role, password_hash, invited_by)
       VALUES ($1, $2, 'local', $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, last_login_at = NOW()
       RETURNING *`,
      [inv.email, inv.name, inv.role, hash, inv.invited_by]
    );

    // Mark invite accepted
    await db.query(`UPDATE invitations SET accepted_at = NOW() WHERE token = $1`, [req.params.token]);

    const user = userRows[0];
    logger.info('Invite accepted', { email: user.email });
    res.json({ token: issueJWT(user), user: safeUser(user) });
  } catch (err) {
    logger.error('Accept invite error', { err: err.message });
    res.status(500).json({ error: 'Failed to activate account' });
  }
});

// ── List pending invites (admin) ──────────────────────────────────────────
router.get('/invites', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { rows } = await db.query(
      `SELECT i.id, i.email, i.name, i.role, i.created_at, i.expires_at, i.accepted_at,
              u.name AS invited_by_name
       FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
       ORDER BY i.created_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// ── Revoke invite (admin) ─────────────────────────────────────────────────
router.delete('/invites/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    await db.query('DELETE FROM invitations WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

// ── List users (admin) ────────────────────────────────────────────────────
router.get('/users', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { rows } = await db.query(
      `SELECT id, email, name, role, provider, avatar_url, created_at, last_login_at FROM users ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ── Update user role (admin) ──────────────────────────────────────────────
router.patch('/users/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const { rows } = await db.query(`UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, name, role`, [role, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ── Current user ──────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT id, email, name, role, provider, avatar_url FROM users WHERE id = $1`, [req.user.userId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(safeUser(rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.post('/signout', authMiddleware, (req, res) => res.json({ ok: true }));

// ── GBP OAuth ─────────────────────────────────────────────────────────────
const stateStore = new Map();
router.get('/gbp/connect', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { userId: req.user.userId, expires: Date.now() + 10 * 60 * 1000 });
  res.json({ url: gbp.getAuthUrl(state) });
});

router.get('/gbp/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${config.frontendUrl}?gbp_error=${error}`);
    const stateData = stateStore.get(state);
    if (!stateData || stateData.expires < Date.now()) return res.status(400).json({ error: 'Invalid state' });
    stateStore.delete(state);
    const tokens = await gbp.exchangeCode(code);
    await db.query(
      `INSERT INTO platform_tokens (platform, access_token_enc, refresh_token_enc, token_expiry, scope, status)
       VALUES ('google', $1, $2, $3, $4, 'active') ON CONFLICT DO NOTHING`,
      [encrypt(tokens.access_token), tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
       tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null, tokens.scope]
    );
    res.redirect(`${config.frontendUrl}?gbp_connected=true`);
  } catch (err) {
    logger.error('GBP callback error', { err: err.message });
    res.redirect(`${config.frontendUrl}?gbp_error=callback_failed`);
  }
});

router.get('/gbp/status', authMiddleware, async (req, res) => {
  const { rows } = await db.query(`SELECT id, platform, status, token_expiry, last_refreshed_at, last_error FROM platform_tokens WHERE platform = 'google' LIMIT 1`);
  res.json({ connected: rows.length > 0, token: rows[0] || null });
});

module.exports = router;
