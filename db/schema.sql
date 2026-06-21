-- RepuPilot Database Schema
-- Run once: node src/db/migrate.js

-- ── Extensions ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  avatar_url    TEXT,
  provider      TEXT NOT NULL,          -- 'google' | 'microsoft' | 'demo'
  provider_id   TEXT,
  role          TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- ── Folders (Region / Brand / Location groupings) ─────────────────────────
CREATE TABLE IF NOT EXISTS folders (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,             -- 'region' | 'brand' | 'location'
  parent_id  UUID REFERENCES folders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Locations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  address          TEXT,
  city             TEXT,
  phone            TEXT,
  category         TEXT,
  folder_id        UUID REFERENCES folders(id) ON DELETE SET NULL,
  gbp_location_id  TEXT UNIQUE,         -- accounts/{accountId}/locations/{locationId}
  gbp_account_id   TEXT,
  last_synced_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Platform Tokens ───────────────────────────────────────────────────────
-- One row per platform connection. Tokens are AES-256-GCM encrypted at rest.
CREATE TABLE IF NOT EXISTS platform_tokens (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform             TEXT NOT NULL,   -- 'google' | 'yelp' | 'apple'
  gbp_account_id       TEXT,
  access_token_enc     TEXT NOT NULL,   -- encrypted
  refresh_token_enc    TEXT,            -- encrypted
  token_expiry         TIMESTAMPTZ,
  scope                TEXT,
  status               TEXT NOT NULL DEFAULT 'active',
  -- 'active' | 'expiring_soon' | 'expired' | 'revoked' | 'disconnected'
  refresh_attempt_count INTEGER NOT NULL DEFAULT 0,
  circuit_open         BOOLEAN NOT NULL DEFAULT false,
  last_error           JSONB,
  -- { code, message, occurred_at, platform }
  last_refreshed_at    TIMESTAMPTZ,
  last_used_at         TIMESTAMPTZ,
  webhook_registered   BOOLEAN NOT NULL DEFAULT false,
  disconnected_at      TIMESTAMPTZ,
  forced_disconnect    BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Reviews ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform           TEXT NOT NULL,    -- 'google' | 'yelp' | 'apple'
  platform_review_id TEXT NOT NULL,
  location_id        UUID REFERENCES locations(id) ON DELETE CASCADE,
  reviewer_name      TEXT,
  reviewer_avatar    TEXT,
  rating             INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text        TEXT,
  review_date        TIMESTAMPTZ,
  reply_text         TEXT,
  reply_date         TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'draft' | 'posted' | 'ignored'
  ai_draft           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, platform_review_id)
);

-- ── Reply Templates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reply_templates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,            -- supports {name} placeholder
  min_rating INTEGER NOT NULL DEFAULT 4,
  max_rating INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reviews_location_id ON reviews(location_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status      ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_platform    ON reviews(platform);
CREATE INDEX IF NOT EXISTS idx_tokens_status       ON platform_tokens(status);
CREATE INDEX IF NOT EXISTS idx_tokens_expiry       ON platform_tokens(token_expiry);
CREATE INDEX IF NOT EXISTS idx_locations_folder    ON locations(folder_id);

-- ── Seed: default reply templates ─────────────────────────────────────────
INSERT INTO reply_templates (name, body, min_rating, max_rating) VALUES
  ('Warm Thank-You',
   'Thank you so much for the wonderful review, {name}! We''re thrilled you had such a great experience. Your kind words mean the world to our team — we look forward to seeing you again!',
   4, 5),
  ('Professional Appreciation',
   'Hi {name}, thank you for taking the time to share your feedback! We''re delighted to hear we met your expectations. Hope to see you again!',
   4, 5),
  ('Quick Thanks',
   'Thanks for the great review, {name}! We really appreciate your support and look forward to serving you again soon.',
   4, 5)
ON CONFLICT DO NOTHING;

-- ── Auth additions ────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by    UUID REFERENCES users(id);

-- Index for local login lookups
CREATE INDEX IF NOT EXISTS idx_users_email_provider ON users(email, provider);

-- ── Invitations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invitations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  token       TEXT UNIQUE NOT NULL,
  invited_by  UUID REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
