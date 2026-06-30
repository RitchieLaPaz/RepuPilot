/**
 * RSS polling scheduler — Render Cron Job version
 * Runs ONE full cycle across all feeds, then returns.
 * Scheduling is handled by Render (every 2 hours via render.yaml).
 */
const Parser  = require('rss-parser');
const feeds   = require('./feeds');
const { classify } = require('./classifier');
const db      = require('../db');
const log     = require('../logger');

const parser  = new Parser({ timeout: 15000 });
const STAGGER = 20 * 1000; // 20s between feeds

// In-memory seen cache
const seen = new Set();

async function seedSeenCache() {
  try {
    const { rows } = await db.query(`SELECT post_id FROM reddit_signals`);
    rows.forEach(r => seen.add(r.post_id));
    log('Seen cache seeded', { count: seen.size });
  } catch (err) {
    log('Could not seed seen cache', { err: err.message });
  }
}

async function processPost(post, feed) {
  const postId = post.id || post.guid || post.link;
  if (!postId || seen.has(postId)) return;
  seen.add(postId);

  const postedAt = post.isoDate || post.pubDate || null;

  const result = await classify({
    title:     post.title || '',
    body:      post.contentSnippet || post.content || '',
    url:       post.link || '',
    subreddit: feed.id,
  });

  if (!result) return;

  try {
    await db.query(
      `INSERT INTO reddit_signals
        (post_id, brand, bname, title, body, url, subreddit, sentiment, urgency_score,
         signal_type, action, ai_reason, suggested_response, status, posted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (post_id) DO NOTHING`,
      [postId, result.brand, result.bname, result.title, result.body, result.url,
       result.subreddit, result.sentiment, result.urgency_score, result.signal_type,
       result.action, result.ai_reason, result.suggested_response, result.status, postedAt]
    );

    log('Signal saved', { brand: result.brand, score: result.urgency_score, title: result.title.slice(0, 50) });

    // Webhook for high-urgency signals
    if (result.urgency_score >= 7) {
      await sendWebhook({ ...result, post_id: postId });
    }
  } catch (err) {
    log('Signal persist error', { err: err.message });
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
    log('Webhook delivery failed', { err: err.message });
  }
}

async function processFeed(feed, retrying = false) {
  try {
    const parsed = await parser.parseURL(feed.url());
    const posts  = parsed.items || [];
    let processed = 0;
    for (const post of posts.slice(0, 10)) {
      await processPost(post, feed);
      processed++;
    }
    log('Feed processed', { feed: feed.id, posts: processed });
  } catch (err) {
    const is429 = err.message?.includes('429');
    if (is429 && !retrying) {
      log('Feed rate limited — retrying in 20s', { feed: feed.id });
      await new Promise(r => setTimeout(r, 20000));
      return processFeed(feed, true);
    }
    log('Feed fetch failed', { feed: feed.id, err: err.message });
  }
}

// Run ONE full cycle — called by Render cron job
async function runOnce() {
  log('Cycle starting', { feeds: feeds.length });
  const start = Date.now();

  // Update scanner status in Railway DB
  try {
    await db.query(
      `INSERT INTO scanner_status (id, last_cycle, next_in_minutes)
       VALUES (1, NOW(), 120)
       ON CONFLICT (id) DO UPDATE SET last_cycle=NOW(), next_in_minutes=120`
    );
  } catch (err) { /* table may not exist */ }

  for (let i = 0; i < feeds.length; i++) {
    await processFeed(feeds[i]);
    if (i < feeds.length - 1) {
      await new Promise(r => setTimeout(r, STAGGER));
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  log('Cycle complete', { elapsed: `${elapsed}s` });
}

module.exports = { runOnce, seedSeenCache };
