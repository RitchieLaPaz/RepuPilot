require('dotenv').config();

const logger = require('./lib/logger');
const { scheduleTokenRefresh } = require('./lib/queue');
const { createTokenRefreshWorker } = require('./workers/tokenRefresh');
const { createReviewPollWorker }   = require('./workers/reviewPoller');

const start = async () => {
  logger.info('Starting RepuPilot workers...');

  // Start workers
  const tokenWorker  = createTokenRefreshWorker();
  const reviewWorker = createReviewPollWorker();

  // Schedule the repeating token refresh check
  await scheduleTokenRefresh();

  logger.info('Workers running', {
    workers: ['token-refresh', 'review-poll'],
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await tokenWorker.close();
    await reviewWorker.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
};

start().catch((err) => {
  console.error('Worker startup failed:', err);
  process.exit(1);
});
