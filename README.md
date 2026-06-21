# RepuPilot — Reputation Management Platform

Multi-location reputation management SaaS for cannabis brands. Manage Google Business Profile reviews, auto-reply, AI-assisted responses, and team access across Eaze, Green Dragon, and Fluent locations.

---

## Live Production

**URL:** Set in Railway → Variables → FRONTEND_URL  
**GBP API Case:** YOUR_CASE_NUMBER (pending Google approval)

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML/JS SPA (`public/index.html`) |
| Backend | Node.js + Express |
| Database | PostgreSQL (Railway) |
| Queue | Redis + BullMQ (Railway) |
| Auth | Google SSO + local accounts + JWT |
| AI | Anthropic Claude (via backend proxy) |
| Email | Resend (invite links, optional) |
| Hosting | Railway |

---

## Project Structure

```
repupilot-backend/
├── public/
│   └── index.html          ← RepuPilot frontend (served by Express)
├── src/
│   ├── server.js           ← Express app, routes, AI proxy
│   ├── worker.js           ← BullMQ workers entry point
│   ├── config/
│   │   └── index.js        ← All env var access
│   ├── db/
│   │   ├── index.js        ← PostgreSQL pool + helpers
│   │   └── migrate.js      ← Run schema migration
│   ├── lib/
│   │   ├── encryption.js   ← AES-256-GCM token encryption
│   │   ├── gbp.js          ← Google Business Profile API client
│   │   ├── queue.js        ← BullMQ queue definitions
│   │   └── logger.js       ← Winston logger
│   ├── middleware/
│   │   └── auth.js         ← JWT verification middleware
│   ├── routes/
│   │   ├── auth.js         ← Auth: Google SSO, local login, invites, users
│   │   ├── locations.js    ← Location CRUD + GBP discovery/import
│   │   └── reviews.js      ← Review management + AI drafts + templates
│   └── workers/
│       ├── tokenRefresh.js ← Proactive OAuth token refresh
│       └── reviewPoller.js ← batchGetReviews polling per location
├── db/
│   └── schema.sql          ← PostgreSQL schema (run via migrate.js)
├── .env.example            ← Environment variables template
├── railway.toml            ← Railway deployment config
└── package.json
```

---

## Railway Services

| Service | Status | Start Command |
|---|---|---|
| RepuPilot (API + Frontend) | ✅ Live | `node src/server.js` |
| PostgreSQL | ✅ Live | — |
| Redis | ✅ Live | — |
| Worker | ⏳ Pending | `node src/worker.js` |

---

## Environment Variables

Set these in Railway → your service → **Variables** tab.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Auto-set by Railway PostgreSQL |
| `REDIS_URL` | ✅ | Auto-set by Railway Redis |
| `GOOGLE_CLIENT_ID` | ✅ | GCP OAuth client ID (for user SSO login) |
| `GOOGLE_CLIENT_SECRET` | ✅ | GCP OAuth client secret (for GBP API) |
| `GOOGLE_REDIRECT_URI` | ✅ | `https://your-railway-domain.up.railway.app/api/auth/gbp/callback` |
| `ALLOWED_DOMAINS` | ✅ | `yourdomain.com,yourdomain2.com` — Google SSO domain allowlist |
| `ENCRYPTION_KEY` | ✅ | 64-char hex — AES-256 key for token encryption |
| `JWT_SECRET` | ✅ | 128-char hex — JWT signing secret |
| `ANTHROPIC_API_KEY` | ✅ | For AI review response generation |
| `NODE_ENV` | ✅ | `production` |
| `FRONTEND_URL` | ✅ | `https://your-railway-domain.up.railway.app` |
| `RESEND_API_KEY` | Optional | Resend API key — enables email delivery for invites |
| `FROM_EMAIL` | Optional | `repupilot@eaze.com` — requires domain verification in Resend |

---

## First-Time Railway Deployment

```bash
# 1. Push to GitHub
git init && git add . && git commit -m "Initial RepuPilot"
git remote add origin https://github.com/YOUR_USERNAME/repupilot-backend.git
git push -u origin main

# 2. In Railway dashboard:
#    New Project → Deploy from GitHub → select repo
#    Add Service → PostgreSQL
#    Add Service → Redis
#    Set all environment variables above

# 3. After first deploy — run migration (Railway shell)
node src/db/migrate.js

# 4. Make yourself admin (Railway shell)
node -e "require('./src/db').query(\"UPDATE users SET role='admin' WHERE email='your-admin@yourdomain.com'\").then(r=>console.log('Done',r.rowCount)).then(()=>process.exit())"
```

---

## Re-deploying Frontend

RepuPilot's UI is a single HTML file. After any update:

```bash
cp reputation-hub.html public/index.html
git add public/index.html
git commit -m "feat: update frontend"
git push
```

Railway auto-deploys on every push.

---

## Auth System

### Google SSO (team members)
Anyone with an `@eaze.com` or `@greendragon.com` Google account can sign in. Account auto-creates on first login — no setup needed. Just share the URL.

```
repupilot-production.up.railway.app → Continue with Google → done
```

### Invite links (external users)
For consultants, clients, or anyone without an allowed Google domain:

1. Admin → **Settings** → **Invite User** → enter name + email + role
2. Copy the generated link → share via Slack or email
3. User clicks link → sets their own password → signed in
4. Link expires after 7 days

### Local email login
External users who accepted an invite sign in via **Sign in with email** on the login screen.

### Making someone admin
After they sign in for the first time, go to **Settings** → Team Members → change their role dropdown to **Admin**. No SQL needed.

One-time bootstrap only (for the very first admin):
```bash
# Railway shell
node -e "require('./src/db').query(\"UPDATE users SET role='admin' WHERE email='YOUR_EMAIL'\").then(()=>process.exit())"
```

---

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/google/verify` | Verify Google ID token → issue JWT |
| POST | `/api/auth/local/login` | Email + password login |
| POST | `/api/auth/invite` | Admin sends invite (creates link) |
| GET | `/api/auth/invite/:token` | Verify invite token |
| POST | `/api/auth/invite/:token/accept` | Accept invite + set password |
| GET | `/api/auth/invites` | List pending invites (admin) |
| DELETE | `/api/auth/invites/:id` | Revoke invite (admin) |
| GET | `/api/auth/users` | List all users (admin) |
| PATCH | `/api/auth/users/:id` | Update user role (admin) |
| GET | `/api/auth/gbp/connect` | Get GBP OAuth URL (admin) |
| GET | `/api/auth/gbp/callback` | GBP OAuth callback |
| GET | `/api/auth/gbp/status` | GBP connection status |

### Locations
| Method | Path | Description |
|---|---|---|
| GET | `/api/locations` | List all locations |
| POST | `/api/locations` | Create location manually |
| GET | `/api/locations/discover` | Discover locations from GBP |
| POST | `/api/locations/import` | Import selected GBP locations |
| PATCH | `/api/locations/:id` | Update location |
| DELETE | `/api/locations/:id` | Delete location |

### Reviews
| Method | Path | Description |
|---|---|---|
| GET | `/api/reviews` | List reviews (filterable) |
| POST | `/api/reviews/:id/ai-draft` | Generate AI response draft |
| POST | `/api/reviews/:id/reply` | Post reply to GBP |
| PATCH | `/api/reviews/:id` | Update review status |
| GET | `/api/reviews/templates` | List reply templates |
| POST | `/api/reviews/templates` | Create reply template |
| DELETE | `/api/reviews/templates/:id` | Delete reply template |

### AI
| Method | Path | Description |
|---|---|---|
| POST | `/api/ai/draft` | Proxy to Anthropic API (no auth required) |

### Health
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |

---

## GCP Setup

- **Project:** your-gcp-project
- **OAuth Client:** RepuPilot Dev — `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com`
- **APIs enabled:** mybusinessaccountmanagement, mybusinessbusinessinformation, mybusiness (v4)
- **GBP API access:** Case YOUR_CASE_NUMBER — pending approval (7–10 business days)
- **Authorized origins:** `https://your-railway-domain.up.railway.app`
- **Redirect URIs:** `https://your-railway-domain.up.railway.app/api/auth/gbp/callback`

---

## Pending (Phase 2)

1. **Worker service** — Add second Railway service with `node src/worker.js`
2. **DB migration** — Run `node src/db/migrate.js` after each schema change
3. **GBP connect flow** — Test end-to-end once API access approved
4. **Listing Management** — Update name, hours, photos via GBP Business Information API
5. **Temporarily Closed** — Toggle per location with auto-reopen scheduler
6. **Auto-reply (4–5★)** — 6–12hr delay → template → personalize → post
7. **Auto-reply (star-only)** — Same delay, separate template pool
8. **Email invites** — Verify `eaze.com` domain in Resend, set `FROM_EMAIL=repupilot@eaze.com`
9. **Docker secrets** — Fix `SecretsUsedInArgOrEnv` warning before enterprise clients

---

## Brands

| Brand | Support Email | Status |
|---|---|---|
| Eaze | support@yourbrand.com | Active |
| Green Dragon | gd-support@yourbrand.com | Active |
| Fluent | TBD | Pending |
