/**
 * Staggered RSS polling scheduler
 * One feed request every 15s → full cycle ~7.25 min → repeats every 2 hours
 */
const Parser  = require('rss-parser');
const feeds   = require('./feeds');
const { classify } = require('./classifier');
const db      = require('../db');
const logger  = require('../lib/logger');

const parser  = new Parser({ timeout: 10000 });
const STAGGER = 15 * 1000;        // 15s between feeds
const CYCLE   = 2 * 60 * 60 * 1000; // 2hrs between full cycles

// In-memory seen cache (seeded from DB on boot)
const seen = new Set();

async function seedSeenCache() {
  try {
    const { rows } = await db.query(`SELECT post_id FROM reddit_signals`);
    rows.forEach(r => seen.add(r.post_id));
    logger.info('Reddit seen cache seeded', { count: seen.size });
  } catch (err) {
    logger.warn('Could not seed seen cache', { err: err.message });
  }
}

async function processPost(post, feed) {
  const postId = post.id || post.guid || post.link;
  if (!postId || seen.has(postId)) return;
  seen.add(postId);

  const result = await classify({
    title:     post.title || '',
    body:      post.contentSnippet || post.content || '',
    url:       post.link || '',
    subreddit: feed.id,
  });

  if (!result) return; // Not relevant

  // Persist to DB
  try {
    await db.query(
      `INSERT INTO reddit_signals
        (post_id, brand, bname, title, body, url, subreddit, sentiment, urgency_score,
         signal_type, action, ai_reason, suggested_response, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (post_id) DO NOTHING`,
      [postId, result.brand, result.bname, result.title, result.body, result.url,
       result.subreddit, result.sentiment, result.urgency_score, result.signal_type,
       result.action, result.ai_reason, result.suggested_response, result.status]
    );

    logger.info('Signal saved', { brand: result.brand, score: result.urgency_score, title: result.title.slice(0, 50) });

    // Webhook for high-urgency signals
    if (result.urgency_score >= 7) {
      sendWebhook({ ...result, post_id: postId });
    }
  } catch (err) {
    logger.error('Signal persist error', { err: err.message });
  }
}

async function sendWebhook(signal) {
  const url = process.env.REPUPILOT_WEBHOOK_URL;
  const key = process.env.SCANNER_WEBHOOK_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/webhooks/reddit-signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scanner-Key': key },
      body: JSON.stringify({ source: 'reddit', ...signal }),
    });
  } catch (err) {
    logger.warn('Webhook delivery failed', { err: err.message });
  }
}

async function processFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url());
    const posts  = parsed.items || [];
    for (const post of posts.slice(0, 10)) {
      await processPost(post, feed);
    }
  } catch (err) {
    logger.warn('Feed fetch failed', { feed: feed.id, err: err.message });
  }
}

let cycleTimeout = null;

async function runCycle() {
  logger.info('Reddit scanner cycle starting', { feeds: feeds.length });
  const start = Date.now();

  // Update scanner status
  try {
    await db.query(
      `INSERT INTO scanner_status (id, last_cycle, next_in_minutes)
       VALUES (1, NOW(), 120)
       ON CONFLICT (id) DO UPDATE SET last_cycle=NOW(), next_in_minutes=120`
    );
  } catch (err) { /* table may not exist yet */ }

  // Staggered feed processing
  for (let i = 0; i < feeds.length; i++) {
    await processFeed(feeds[i]);
    if (i < feeds.length - 1) {
      await new Promise(r => setTimeout(r, STAGGER));
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  logger.info('Reddit scanner cycle complete', { elapsed: `${elapsed}s` });

  // Schedule next cycle
  cycleTimeout = setTimeout(runCycle, CYCLE);
}

module.exports = { runCycle, seedSeenCache };
