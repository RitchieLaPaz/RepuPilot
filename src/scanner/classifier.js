/**
 * Claude-powered signal classifier
 * Detects brand mentions, scores sentiment + urgency, filters false positives
 */
const logger = require('../lib/logger');

const BRANDS = {
  eaze:         ['eaze'],
  green_dragon: ['green dragon', 'greendragon'],
  fluent:       ['fluent cannabis', 'fluent dispensary', 'fluent medical', 'fluent marijuana'],
};

function detectBrand(text) {
  const lower = text.toLowerCase();
  for (const [brand, keywords] of Object.entries(BRANDS)) {
    if (keywords.some(k => lower.includes(k))) return brand;
  }
  return null;
}

function brandName(brand) {
  return { eaze: 'Eaze', green_dragon: 'Green Dragon', fluent: 'Fluent' }[brand] || brand;
}

async function classify(post) {
  const { title = '', body = '', url = '', subreddit = '' } = post;
  const brand = detectBrand(title + ' ' + body);
  if (!brand) return null; // Not about our brands

  const prompt = `You are a brand reputation classifier for cannabis companies.

Analyze this Reddit post and return ONLY a JSON object — no markdown, no explanation.

Post title: "${title}"
Post body: "${body}"
Subreddit: "${subreddit}"
Brand detected: ${brandName(brand)}

Return this exact JSON shape:
{
  "is_relevant": true,
  "sentiment": "Positive|Negative|Neutral|Mixed",
  "urgency_score": 1-10,
  "signal_type": "Complaint|Question|Praise|Comparison|Other",
  "action": "Respond now|Respond soon|Monitor|Done",
  "ai_reason": "1-2 sentence explanation of urgency",
  "suggested_response": "Draft response text or null if not needed"
}

Urgency guide: 9-10 = crisis/viral risk, 7-8 = complaint needing response, 4-6 = question or moderate concern, 1-3 = positive or low priority.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    if (!result.is_relevant) return null;

    return {
      brand,
      bname: brandName(brand),
      title,
      body: body.slice(0, 1000),
      url,
      subreddit,
      sentiment:         result.sentiment,
      urgency_score:     result.urgency_score,
      signal_type:       result.signal_type,
      action:            result.action,
      ai_reason:         result.ai_reason,
      suggested_response: result.suggested_response || null,
      status:            'new',
    };
  } catch (err) {
    logger.error('Classifier error', { err: err.message });
    // Fallback: basic classification without AI
    return {
      brand,
      bname: brandName(brand),
      title,
      body: body.slice(0, 1000),
      url,
      subreddit,
      sentiment: 'Neutral',
      urgency_score: 5,
      signal_type: 'Other',
      action: 'Monitor',
      ai_reason: 'Auto-classified (AI unavailable)',
      suggested_response: null,
      status: 'new',
    };
  }
}

module.exports = { classify, detectBrand };
