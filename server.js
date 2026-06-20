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

const app = express();

// ── Security middleware ────────────────────────────────────────────────────
app.use(helmet());
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

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
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
