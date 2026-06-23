require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const config     = require('./config');
const logger     = require('./lib/logger');
const { migrate } = require('./db');

// Routes
const authRoutes      = require('./routes/auth');
const locationRoutes  = require('./routes/locations');
const reviewRoutes    = require('./routes/reviews');
const folderRoutes    = require('./routes/folders');

const app = express();

// Trust Railway's proxy — required for express-rate-limit behind a load balancer
app.set('trust proxy', 1);

// ── Security middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// Explicitly remove CSP header — SPA uses inline scripts and onclick handlers
app.use((req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Content-Security-Policy');
  res.removeHeader('X-WebKit-CSP');
  next();
});
app.use(cors({
  origin:      config.frontendUrl,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      200,
  message:  { error: 'Too many requests, please try again later' },
}));

// ── Static frontend ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: config.env, ts: new Date().toISOString() });
});

// ── AI draft proxy ────────────────────────────────────────────────────────
// Proxies Anthropic API calls from the frontend — keeps API key server-side
app.post('/api/ai/draft', async (req, res) => {
  try {
    const { system, userMessage } = req.body;
    if (!system || !userMessage) return res.status(400).json({ error: 'system and userMessage required' });
    if (!config.anthropic.apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

    const axios = require('axios');
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-6', max_tokens: 800, system, messages: [{ role: 'user', content: userMessage }] },
      { headers: { 'x-api-key': config.anthropic.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );
    res.json({ draft: response.data.content[0].text });
  } catch (err) {
    logger.error('AI draft error', { err: err.message });
    res.status(500).json({ error: 'Failed to generate AI draft' });
  }
});


app.use('/api/auth',      authRoutes);
app.use('/api/folders',   folderRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/reviews',   reviewRoutes);

// ── SPA fallback — all non-API routes serve index.html ───────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── 404 for API routes only ───────────────────────────────────────────────
app.use('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    // Run DB migration on startup
    await migrate();

    app.listen(config.port, () => {
      logger.info(`RepuPilot API running`, { port: config.port, env: config.env });
    });
  } catch (err) {
    logger.error('Failed to start server', { err: err.message });
    process.exit(1);
  }
};

start();

module.exports = app;
