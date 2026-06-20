const { Queue, QueueEvents } = require('bullmq');
const config = require('../config');

const connection = { url: config.redis.url };

// ── Queue definitions ─────────────────────────────────────────────────────
const tokenRefreshQueue = new Queue('token-refresh', { connection });
const reviewPollQueue   = new Queue('review-poll',   { connection });
const reviewReplyQueue  = new Queue('review-reply',  { connection });

// ── Schedule the repeating token refresh check ────────────────────────────
const scheduleTokenRefresh = async () => {
  await tokenRefreshQueue.add(
    'check-expiring-tokens',
    {},
    {
      repeat: { every: 60 * 60 * 1000 }, // every hour
      jobId:  'token-refresh-repeating',
    }
  );
};

// ── Add a review poll job for a location ──────────────────────────────────
const scheduleReviewPoll = async (locationId, gbpAccountId, locationName, priority = 'normal') => {
  const delay = priority === 'high' ? 0 : priority === 'normal' ? 5_000 : 30_000;
  await reviewPollQueue.add(
    'poll-location-reviews',
    { locationId, gbpAccountId, locationName },
    { delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
  );
};

module.exports = {
  tokenRefreshQueue,
  reviewPollQueue,
  reviewReplyQueue,
  scheduleTokenRefresh,
  scheduleReviewPoll,
};
