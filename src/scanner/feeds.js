// scanner/feeds.js
// Reddit RSS feed registry for cannabis brand monitoring
// Auth params obtained from: reddit.com/prefs/feeds

const auth = () => {
  const user = process.env.REDDIT_RSS_USER;
  const token = process.env.REDDIT_RSS_TOKEN;
  if (!user || !token) throw new Error('REDDIT_RSS_USER and REDDIT_RSS_TOKEN required');
  return `user=${user}&feed=${token}`;
};

const rss = (path, extra = '') =>
  `https://www.reddit.com${path}.rss?${auth()}&limit=25${extra ? '&' + extra : ''}`;

const search = (query) =>
  rss('/search', `q=${encodeURIComponent(query)}&sort=new&type=link`);

// ─── Cannabis subreddits ──────────────────────────────────────────────────────
// General communities where brand mentions surface organically

export const SUBREDDIT_FEEDS = [
  { id: 'r_weed',           url: rss('/r/weed/new'),           priority: 'high'   },
  { id: 'r_trees',          url: rss('/r/trees/new'),          priority: 'high'   },
  { id: 'r_cannabis',       url: rss('/r/cannabis/new'),       priority: 'high'   },
  { id: 'r_Marijuana',      url: rss('/r/Marijuana/new'),      priority: 'medium' },
  { id: 'r_CBD',            url: rss('/r/CBD/new'),            priority: 'medium' },
  { id: 'r_hempflowers',    url: rss('/r/hempflowers/new'),    priority: 'low'    },
  { id: 'r_CannabisCulture',url: rss('/r/CannabisCulture/new'),priority: 'medium' },
  { id: 'r_saplings',       url: rss('/r/saplings/new'),       priority: 'low'    },

  // Geo subreddits — markets where these brands operate
  { id: 'r_LosAngeles',          url: rss('/r/LosAngeles/new'),          priority: 'medium' },
  { id: 'r_California',          url: rss('/r/California/new'),          priority: 'medium' },
  { id: 'r_Florida',             url: rss('/r/Florida/new'),             priority: 'medium' },
  { id: 'r_floridamarijuana',    url: rss('/r/floridamarijuana/new'),    priority: 'high'   },
  { id: 'r_FLMedicalTrees',      url: rss('/r/FLMedicalTrees/new'),      priority: 'high'   },
  { id: 'r_Colorado',            url: rss('/r/Colorado/new'),            priority: 'medium' },
  { id: 'r_NYCmarijuana',        url: rss('/r/NYCmarijuana/new'),        priority: 'medium' },
  { id: 'r_nycweed',             url: rss('/r/nycweed/new'),             priority: 'medium' },
  { id: 'r_nys_cannabis',        url: rss('/r/nys_cannabis/new'),        priority: 'medium' },
  { id: 'r_TexasMedicalCannabis',url: rss('/r/TexasMedicalCannabis/new'),priority: 'medium' },

  // Brand-specific subreddit
  { id: 'r_Eaze',                url: rss('/r/Eaze/new'),                priority: 'critical'},

  // Business / consumer communities
  { id: 'r_Entrepreneur',        url: rss('/r/Entrepreneur/new'),        priority: 'low'    },
  { id: 'r_smallbusiness',       url: rss('/r/smallbusiness/new'),       priority: 'low'    },
];

// ─── Brand keyword search feeds ───────────────────────────────────────────────
// These search all of Reddit for brand name mentions

export const BRAND_FEEDS = [
  // Eaze
  { id: 'eaze_brand',       brand: 'eaze', url: search('eaze cannabis'),      priority: 'critical' },
  { id: 'eaze_delivery',    brand: 'eaze', url: search('eaze delivery'),       priority: 'critical' },
  { id: 'eaze_dispensary',  brand: 'eaze', url: search('"eaze dispensary"'),   priority: 'critical' },

  // Green Dragon
  { id: 'gd_brand',         brand: 'green_dragon', url: search('"green dragon" dispensary'), priority: 'critical' },
  { id: 'gd_colorado',      brand: 'green_dragon', url: search('"green dragon" cannabis colorado'), priority: 'high' },

  // Fluent
  { id: 'fluent_brand',     brand: 'fluent', url: search('"fluent cannabis"'), priority: 'critical' },
  { id: 'fluent_fl',        brand: 'fluent', url: search('"fluent dispensary" florida'), priority: 'critical' },
  { id: 'fluent_medical',   brand: 'fluent', url: search('fluent medical marijuana'),    priority: 'high' },
];

// ─── All feeds combined, sorted by priority ───────────────────────────────────
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export const ALL_FEEDS = [...BRAND_FEEDS, ...SUBREDDIT_FEEDS].sort(
  (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
);

export const FEED_COUNT = ALL_FEEDS.length; // 29 feeds total
