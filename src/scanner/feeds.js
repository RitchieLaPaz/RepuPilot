/**
 * RSS feed registry — 22 feeds
 * Subreddits + brand keyword searches for Eaze, Green Dragon, Fluent
 */
const BASE = 'https://www.reddit.com';
const token = () => {
  const u = process.env.REDDIT_RSS_USER;
  const f = process.env.REDDIT_RSS_TOKEN;
  return u && f ? `?user=${u}&feed=${f}` : '.json?limit=25';
};

module.exports = [
  // ── Subreddits ────────────────────────────────────────────────────────
  { id: 'r_weed',            url: () => `${BASE}/r/weed/new.rss${token()}`,            type: 'subreddit' },
  { id: 'r_trees',           url: () => `${BASE}/r/trees/new.rss${token()}`,           type: 'subreddit' },
  { id: 'r_cannabis',        url: () => `${BASE}/r/cannabis/new.rss${token()}`,        type: 'subreddit' },
  { id: 'r_marijuana',       url: () => `${BASE}/r/Marijuana/new.rss${token()}`,       type: 'subreddit' },
  { id: 'r_cbd',             url: () => `${BASE}/r/CBD/new.rss${token()}`,             type: 'subreddit' },
  { id: 'r_hempflowers',     url: () => `${BASE}/r/hempflowers/new.rss${token()}`,    type: 'subreddit' },
  { id: 'r_cannabisculture', url: () => `${BASE}/r/CannabisCulture/new.rss${token()}`,type: 'subreddit' },
  { id: 'r_saplings',        url: () => `${BASE}/r/saplings/new.rss${token()}`,        type: 'subreddit' },
  { id: 'r_losangeles',      url: () => `${BASE}/r/LosAngeles/new.rss${token()}`,      type: 'subreddit' },
  { id: 'r_california',      url: () => `${BASE}/r/California/new.rss${token()}`,      type: 'subreddit' },
  { id: 'r_florida',         url: () => `${BASE}/r/florida/new.rss${token()}`,         type: 'subreddit' },
  { id: 'r_colorado',        url: () => `${BASE}/r/Colorado/new.rss${token()}`,        type: 'subreddit' },
  { id: 'r_entrepreneur',    url: () => `${BASE}/r/Entrepreneur/new.rss${token()}`,    type: 'subreddit' },
  { id: 'r_smallbusiness',   url: () => `${BASE}/r/smallbusiness/new.rss${token()}`,  type: 'subreddit' },

  // ── Eaze keyword searches ─────────────────────────────────────────────
  { id: 'kw_eaze_cannabis',  url: () => `${BASE}/search.rss?q=eaze+cannabis&sort=new${token()}`,   type: 'keyword', brand: 'eaze' },
  { id: 'kw_eaze_delivery',  url: () => `${BASE}/search.rss?q=eaze+delivery&sort=new${token()}`,   type: 'keyword', brand: 'eaze' },
  { id: 'kw_eaze_dispensary',url: () => `${BASE}/search.rss?q=eaze+dispensary&sort=new${token()}`, type: 'keyword', brand: 'eaze' },

  // ── Green Dragon keyword searches ─────────────────────────────────────
  { id: 'kw_gd_dispensary',  url: () => `${BASE}/search.rss?q=green+dragon+dispensary&sort=new${token()}`, type: 'keyword', brand: 'green_dragon' },
  { id: 'kw_gd_colorado',    url: () => `${BASE}/search.rss?q=green+dragon+cannabis+colorado&sort=new${token()}`, type: 'keyword', brand: 'green_dragon' },

  // ── Fluent keyword searches ───────────────────────────────────────────
  { id: 'kw_fl_cannabis',    url: () => `${BASE}/search.rss?q=fluent+cannabis&sort=new${token()}`,          type: 'keyword', brand: 'fluent' },
  { id: 'kw_fl_dispensary',  url: () => `${BASE}/search.rss?q=fluent+dispensary+florida&sort=new${token()}`,type: 'keyword', brand: 'fluent' },
  { id: 'kw_fl_medical',     url: () => `${BASE}/search.rss?q=fluent+medical+marijuana&sort=new${token()}`, type: 'keyword', brand: 'fluent' },
];
