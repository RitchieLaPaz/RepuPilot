/**
 * Google Business Profile API client.
 * Wraps the v4 reviews API and account management API.
 * All calls go through getAccessToken() which decrypts lazily.
 */

const axios   = require('axios');
const { OAuth2Client } = require('google-auth-library');
const config  = require('../config');
const { decrypt, encrypt } = require('./encryption');
const db      = require('../db');
const logger  = require('./logger');

const GBP_BASE      = 'https://mybusiness.googleapis.com/v4';
const ACCOUNT_BASE  = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BIZINFO_BASE  = 'https://mybusinessbusinessinformation.googleapis.com/v1';

// ── OAuth client ──────────────────────────────────────────────────────────
const oauthClient = new OAuth2Client(
  config.google.clientId,
  config.google.clientSecret,
  config.google.redirectUri
);

/**
 * Generate the Google OAuth authorization URL.
 * User is redirected here to grant RepuPilot access to their GBP account.
 */
const getAuthUrl = (state) => {
  return oauthClient.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',  // force refresh token on every auth
    scope:       config.google.scopes,
    state,
  });
};

/**
 * Exchange an authorization code for access + refresh tokens.
 */
const exchangeCode = async (code) => {
  const { tokens } = await oauthClient.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, scope, token_type }
};

/**
 * Get a live access token for the stored platform connection.
 * Decrypts lazily — does NOT decrypt at startup.
 * Refreshes automatically if expired.
 */
const getAccessToken = async (tokenRow) => {
  const now = Date.now();
  const expiry = tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : 0;

  // Still valid
  if (expiry > now + 60_000) {
    return decrypt(tokenRow.access_token_enc);
  }

  // Refresh needed
  logger.info('Refreshing GBP access token', { tokenId: tokenRow.id });
  const refreshToken = decrypt(tokenRow.refresh_token_enc);
  oauthClient.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauthClient.refreshAccessToken();

  // Persist updated token
  await db.query(
    `UPDATE platform_tokens SET
       access_token_enc   = $1,
       token_expiry       = $2,
       last_refreshed_at  = NOW(),
       refresh_attempt_count = 0,
       status             = 'active',
       last_error         = NULL,
       updated_at         = NOW()
     WHERE id = $3`,
    [
      encrypt(credentials.access_token),
      new Date(credentials.expiry_date).toISOString(),
      tokenRow.id,
    ]
  );

  return credentials.access_token;
};

// ── GBP API calls ─────────────────────────────────────────────────────────

/**
 * List all GBP accounts the authorized user has access to.
 */
const listAccounts = async (tokenRow) => {
  const token = await getAccessToken(tokenRow);
  const { data } = await axios.get(`${ACCOUNT_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.accounts || [];
};

/**
 * List all locations under a GBP account.
 */
const listLocations = async (tokenRow, accountId) => {
  const token = await getAccessToken(tokenRow);
  const locations = [];
  let pageToken;

  do {
    const params = { readMask: 'name,title,storefrontAddress,phoneNumbers,categories', pageSize: 100 };
    if (pageToken) params.pageToken = pageToken;

    const { data } = await axios.get(`${BIZINFO_BASE}/${accountId}/locations`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    });

    if (data.locations) locations.push(...data.locations);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return locations;
};

/**
 * Batch fetch reviews across multiple locations.
 * Uses batchGetReviews to minimize API calls (vs. one call per location).
 * Max ~10 locations per batch call recommended.
 */
const batchGetReviews = async (tokenRow, accountId, locationNames, pageSize = 50) => {
  const token = await getAccessToken(tokenRow);

  const { data } = await axios.post(
    `${GBP_BASE}/accounts/${accountId}/locations:batchGetReviews`,
    {
      locationNames,
      pageSize,
      orderBy: 'updateTime desc',
      ignoreRatingOnlyReviews: false,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data.locationReviews || [];
};

/**
 * Post a reply to a review.
 */
const replyToReview = async (tokenRow, reviewName, replyText) => {
  // reviewName format: accounts/{accountId}/locations/{locationId}/reviews/{reviewId}
  const token = await getAccessToken(tokenRow);

  const { data } = await axios.put(
    `${GBP_BASE}/${reviewName}/reply`,
    { comment: replyText },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
};

/**
 * Delete a review reply (not the review itself — that's not possible via API).
 */
const deleteReviewReply = async (tokenRow, reviewName) => {
  const token = await getAccessToken(tokenRow);
  await axios.delete(`${GBP_BASE}/${reviewName}/reply`, {
    headers: { Authorization: `Bearer ${token}` },
  });
};

module.exports = {
  getAuthUrl,
  exchangeCode,
  getAccessToken,
  listAccounts,
  listLocations,
  batchGetReviews,
  replyToReview,
  deleteReviewReply,
};
