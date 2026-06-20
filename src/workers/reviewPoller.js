/**
 * Review Poll Worker
 *
 * Processes review poll jobs queued per location.
 * Uses batchGetReviews to efficiently pull reviews across locations.
 * Implements high-water mark (last_synced_at) to only fetch new/updated reviews.
 */

const { Worker } = require('bullmq');
const config = require('../config');
const db     = require('../db');
const gbp    = require('../lib/gbp');
const logger = require('../lib/logger');

const processPollJob = async (job) => {
  const { locationId, gbpAccountId, locationName } = job.data;

  logger.info('Polling reviews for location', { locationId, locationName });

  // Get active GBP token
  const { rows: tokens } = await db.query(
    `SELECT * FROM platform_tokens
     WHERE platform = 'google' AND status = 'active' AND circuit_open = false
     LIMIT 1`
  );

  if (!tokens.length) {
    throw new Error('No active GBP token available');
  }

  const token = tokens[0];

  // Extract accountId from gbpAccountId string
  const accountId = gbpAccountId.replace('accounts/', '');

  // batchGetReviews — pass the full location name (accounts/X/locations/Y)
  const locationReviews = await gbp.batchGetReviews(
    token,
    accountId,
    [locationName],
    50
  );

  let newCount     = 0;
  let updatedCount = 0;

  for (const locReview of locationReviews) {
    for (const review of (locReview.reviews || [])) {
      const result = await upsertReview(review, locationId);
      if (result === 'new')     newCount++;
      if (result === 'updated') updatedCount++;
    }
  }

  // Update last_synced_at
  await db.query(
    'UPDATE locations SET last_synced_at = NOW(), updated_at = NOW() WHERE id = $1',
    [locationId]
  );

  // Update token last_used_at
  await db.query(
    'UPDATE platform_tokens SET last_used_at = NOW() WHERE id = $1',
    [token.id]
  );

  logger.info('Poll complete', { locationId, newCount, updatedCount });
  return { newCount, updatedCount };
};

const upsertReview = async (review, locationId) => {
  // Map GBP star rating to integer
  const STAR_MAP = {
    ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
  };
  const rating = STAR_MAP[review.starRating] || 0;
  if (!rating) return 'skipped';

  const { rows: existing } = await db.query(
    'SELECT id, reply_text FROM reviews WHERE platform = $1 AND platform_review_id = $2',
    ['google', review.reviewId]
  );

  const reviewDate = review.createTime ? new Date(review.createTime) : null;
  const replyText  = review.reviewReply?.comment || null;
  const replyDate  = review.reviewReply?.updateTime ? new Date(review.reviewReply.updateTime) : null;

  if (!existing.length) {
    // New review
    await db.query(
      `INSERT INTO reviews
         (platform, platform_review_id, location_id, reviewer_name,
          rating, review_text, review_date, reply_text, reply_date, status)
       VALUES ('google', $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (platform, platform_review_id) DO NOTHING`,
      [
        review.reviewId,
        locationId,
        review.reviewer?.displayName || 'Anonymous',
        rating,
        review.comment || null,
        reviewDate,
        replyText,
        replyDate,
        replyText ? 'posted' : 'pending',
      ]
    );
    return 'new';
  }

  // Update if reply status changed
  if (replyText && !existing[0].reply_text) {
    await db.query(
      `UPDATE reviews SET
         reply_text = $1, reply_date = $2, status = 'posted', updated_at = NOW()
       WHERE id = $3`,
      [replyText, replyDate, existing[0].id]
    );
    return 'updated';
  }

  return 'unchanged';
};

// ── Create and export the worker ──────────────────────────────────────────
const createReviewPollWorker = () => {
  const worker = new Worker(
    'review-poll',
    processPollJob,
    {
      connection:  { url: config.redis.url },
      concurrency: 5, // poll up to 5 locations simultaneously
    }
  );

  worker.on('completed', (job, result) =>
    logger.info('Poll job completed', { jobId: job.id, ...result })
  );
  worker.on('failed', (job, err) =>
    logger.error('Poll job failed', { jobId: job?.id, err: err.message })
  );

  return worker;
};

module.exports = { createReviewPollWorker };
