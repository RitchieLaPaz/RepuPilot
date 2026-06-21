require('dotenv').config();

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

module.exports = {
  env:         process.env.NODE_ENV || 'development',
  port:        parseInt(process.env.PORT || '3000', 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5500',

  db: {
    url: required('DATABASE_URL'),
  },

  redis: {
    url: required('REDIS_URL'),
  },

  google: {
    clientId:     required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri:  required('GOOGLE_REDIRECT_URI'),
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/business.manage',
    ],
  },

  encryption: {
    key: required('ENCRYPTION_KEY'), // 64-char hex = 32 bytes
  },

  jwt: {
    secret:    required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },

  // Comma-separated list of allowed Google email domains for SSO
  // e.g. 'eaze.com,greendragon.com' — empty means any Google account is allowed
  allowedDomains: process.env.ALLOWED_DOMAINS || '',

  tokenRefreshWindowHours: 48,
};
