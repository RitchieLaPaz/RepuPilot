AI-driven, "agentic" marketing and online reputation management platform designed specifically for multi-location brands and local businesses

# RepuPilot Backend — Railway Deployment Guide

## What this is
Express API + BullMQ worker for RepuPilot's reputation management platform.
Handles Google Business Profile OAuth, review ingestion, and reply posting.

---

## Step 1 — Push to GitHub

```bash
cd repupilot-backend
git init
git add .
git commit -m "Initial RepuPilot backend"
git remote add origin https://github.com/YOUR_USERNAME/repupilot-backend.git
git push -u origin main
```

---

## Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo** → select `repupilot-backend`
3. Railway will auto-detect Node.js and start building

---

## Step 3 — Add PostgreSQL

1. In your Railway project → click **+ Add Service**
2. Choose **Database → PostgreSQL**
3. Railway auto-creates `DATABASE_URL` — no config needed

Run the schema migration once deployed:
```bash
# In Railway dashboard → your API service → Shell
node src/db/migrate.js
```

---

## Step 4 — Add Redis

1. In your Railway project → click **+ Add Service**
2. Choose **Database → Redis**
3. Railway auto-creates `REDIS_URL` — no config needed

---

## Step 5 — Add environment variables

In Railway dashboard → your API service → **Variables** tab, add:

```
GOOGLE_CLIENT_ID=167353309583-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_secret_from_gcp
GOOGLE_REDIRECT_URI=https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/auth/gbp/callback
ENCRYPTION_KEY=<generate below>
JWT_SECRET=<generate below>
FRONTEND_URL=https://your-frontend-domain.com
ANTHROPIC_API_KEY=sk-ant-your_key
NODE_ENV=production
```

**Generate ENCRYPTION_KEY and JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # JWT_SECRET
```

⚠️ Never commit these values to git. Only set them in Railway's Variables UI.

---

## Step 6 — Update GCP OAuth redirect URI

After Railway assigns your domain (e.g. `repupilot-backend-production.up.railway.app`):

1. Go to GCP Console → APIs & Services → Credentials → RepuPilot Dev
2. Add to **Authorized redirect URIs**:
   `https://repupilot-backend-production.up.railway.app/api/auth/gbp/callback`
3. Add to **Authorized JavaScript origins**:
   `https://repupilot-backend-production.up.railway.app`
4. Save

---

## Step 7 — Add Worker service

The worker (token refresh + review polling) runs as a separate Railway service:

1. In Railway → **+ Add Service** → **GitHub Repo** → same repo
2. Go to that service → **Settings** → **Start Command**:
   ```
   node src/worker.js
   ```
3. Add the same environment variables as the API service
4. Deploy

---

## Step 8 — Verify deployment

```bash
curl https://YOUR-RAILWAY-DOMAIN.up.railway.app/health
# → {"status":"ok","env":"production","ts":"..."}
```

---

## Project structure

```
repupilot-backend/
├── src/
│   ├── server.js          # Express API (web service)
│   ├── worker.js          # BullMQ workers (worker service)
│   ├── config/index.js    # All env var access
│   ├── db/
│   │   ├── index.js       # PostgreSQL pool
│   │   └── migrate.js     # Run schema migration
│   ├── lib/
│   │   ├── encryption.js  # AES-256-GCM token encryption
│   │   ├── gbp.js         # Google Business Profile API client
│   │   ├── queue.js       # BullMQ queue definitions
│   │   └── logger.js      # Winston logger
│   ├── middleware/
│   │   └── auth.js        # JWT verification
│   ├── routes/
│   │   ├── auth.js        # OAuth flows + JWT issuance
│   │   ├── locations.js   # Location CRUD + GBP discovery
│   │   └── reviews.js     # Review management + AI drafts
│   └── workers/
│       ├── tokenRefresh.js  # Proactive token refresh
│       └── reviewPoller.js  # batchGetReviews polling
├── db/schema.sql          # PostgreSQL schema
├── railway.toml           # Railway config (web service)
├── .env.example           # Env vars template
└── package.json
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | /health | Health check |
| POST   | /api/auth/google/verify | Verify Google id_token → issue JWT |
| GET    | /api/auth/gbp/connect | Get GBP OAuth URL (admin only) |
| GET    | /api/auth/gbp/callback | GBP OAuth callback — stores tokens |
| GET    | /api/auth/gbp/status | Check GBP connection status |
| GET    | /api/locations | List all locations |
| POST   | /api/locations | Create location manually |
| GET    | /api/locations/discover | Discover locations from GBP |
| POST   | /api/locations/import | Import selected GBP locations |
| GET    | /api/reviews | List reviews (filterable) |
| POST   | /api/reviews/:id/ai-draft | Generate AI response draft |
| POST   | /api/reviews/:id/reply | Post reply to GBP |
| GET    | /api/reviews/templates | List reply templates |
| POST   | /api/reviews/templates | Create reply template |

---

## Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | ✅ | Auto-set by Railway PostgreSQL |
| REDIS_URL | ✅ | Auto-set by Railway Redis |
| GOOGLE_CLIENT_ID | ✅ | From GCP Console |
| GOOGLE_CLIENT_SECRET | ✅ | From GCP Console — server-side only |
| GOOGLE_REDIRECT_URI | ✅ | Your Railway domain + /api/auth/gbp/callback |
| ENCRYPTION_KEY | ✅ | 64-char hex (32 bytes) — generate randomly |
| JWT_SECRET | ✅ | 128-char hex — generate randomly |
| FRONTEND_URL | ✅ | Your RepuPilot frontend URL |
| ANTHROPIC_API_KEY | ✅ | For AI review drafts |
| NODE_ENV | ✅ | Set to `production` on Railway |

