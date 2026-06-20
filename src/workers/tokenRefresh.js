/**
 * Token Refresh Worker
 *
 * Runs on a schedule (every hour). Finds tokens expiring within the
 * configured window and refreshes them proactively — not reactively.
 * Circuit breaker logic stops retrying permanently failed tokens.
 */

const { Worker } = require('bullmq');
const config     = require('../config');
const db         = require('../db');
const gbp        = require('../lib/gbp');
const { encrypt } = require('../lib/encryption');
const logger     = require('../lib/logger');

const { OAuth2Client } = require('google-auth-library');

const MAX_REFRESH_ATTEMPTS = 3;

const processTokenRefresh = async (job) => {
  logger.info('Token refresh job started');

  const windowHours = config.tokenRefreshWindowHours;
  const windowMs    = windowHours * 60 * 60 * 1000;
  const cutoff      = new Date(Date.now() + windowMs).toISOString();

  // Find tokens expiring within the window and not circuit-broken
  const { rows: expiringTokens } = await db.query(
    `SELECT * FROM platform_tokens
     WHERE status = 'active'
       AND circuit_open = false
       AND token_expiry < $1
       AND refresh_token_enc IS NOT NULL`,
    [cutoff]
  );

  logger.info(`Found ${expiringTokens.length} token(s) to refresh`);

  for (const token of expiringTokens) {
    try {
      await refreshToken(token);
    } catch (err) {
      await handleRefreshFailure(token, err);
    }
  }

  // Also flag tokens that are already expired
  await db.query(
    `UPDATE platform_tokens
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'active'
       AND token_expiry < NOW()
       AND circuit_open = false`
  );

  logger.info('Token refresh job complete');
};

const refreshToken = async (tokenRow) => {
  const { OAuth2Client } = require('google-auth-library');
  const { decrypt } = require('../lib/encryption');

  const client = new OAuth2Client(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

  const refreshToken = decrypt(tokenRow.refresh_token_enc);
  client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await client.refreshAccessToken();

  await db.query(
    `UPDATE platform_tokens SET
       access_token_enc      = $1,
       token_expiry          = $2,
       status                = 'active',
       last_refreshed_at     = NOW(),
       refresh_attempt_count = 0,
       circuit_open          = false,
       last_error            = NULL,
       updated_at            = NOW()
     WHERE id = $3`,
    [
      encrypt(credentials.access_token),
      new Date(credentials.expiry_date).toISOString(),
      tokenRow.id,
    ]
  );

  logger.info('Token refreshed successfully', { tokenId: tokenRow.id });
};

const handleRefreshFailure = async (tokenRow, err) => {
  const attempts  = (tokenRow.refresh_attempt_count || 0) + 1;
  const circuitOpen = attempts >= MAX_REFRESH_ATTEMPTS;

  const lastError = {
    code:        err.response?.data?.error || 'refresh_failed',
    message:     err.message,
    occurred_at: new Date().toISOString(),
    platform:    tokenRow.platform,
  };

  await db.query(
    `UPDATE platform_tokens SET
       refresh_attempt_count = $1,
       circuit_open          = $2,
       status                = $3,
       last_error            = $4,
       updated_at            = NOW()
     WHERE id = $5`,
    [
      attempts,
      circuitOpen,
      circuitOpen ? 'revoked' : 'expiring_soon',
      JSON.stringify(lastError),
      tokenRow.id,
    ]
  );

  if (circuitOpen) {
    logger.error('Circuit breaker opened — token requires manual re-auth', {
      tokenId: tokenRow.id,
      error:   lastError,
    });
    // TODO: send email alert to admin
  } else {
    logger.warn('Token refresh failed, will retry', {
      tokenId:  tokenRow.id,
      attempts,
      error:    lastError.code,
    });
  }
};

// ── Create and export the worker ──────────────────────────────────────────
const createTokenRefreshWorker = () => {
  const worker = new Worker(
    'token-refresh',
    processTokenRefresh,
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    }
  );

  worker.on('completed', (job) => logger.info('Token refresh job completed', { jobId: job.id }));
  worker.on('failed', (job, err) => logger.error('Token refresh job failed', { jobId: job?.id, err: err.message }));

  return worker;
};

module.exports = { createTokenRefreshWorker };
