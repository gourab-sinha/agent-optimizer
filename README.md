# Voice AI Agent Optimizer

Optimize GoHighLevel (HighLevel) Voice AI agents by analyzing real call transcripts, scoring them against generated rubrics, detecting recurring failure patterns, generating test cases, and proposing validated configuration recommendations.

This monorepo contains:

| Folder | Stack | Role |
|--------|--------|------|
| `backend/` | Node.js (ESM), Express 5, PostgreSQL, Vitest | API, OAuth/SSO, GHL sync, analysis & recommendation engine |
| `client/` | Vue 3, Vite, TypeScript, Tailwind CSS | Marketplace iframe UI (agent sync, analysis, tests, recommendations) |

---

## Table of contents

1. [What this product does](#what-this-product-does)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Create a HighLevel Marketplace application](#create-a-highlevel-marketplace-application)
5. [Local development setup](#local-development-setup)
6. [Environment variables](#environment-variables)
7. [Database setup](#database-setup)
8. [Running the app](#running-the-app)
9. [Install & use the app in HighLevel](#install--use-the-app-in-highlevel)
10. [API overview](#api-overview)
11. [Project structure](#project-structure)
12. [Testing](#testing)
13. [Production notes](#production-notes)
14. [Troubleshooting](#troubleshooting)

---

## What this product does

End-to-end optimization loop for HighLevel Voice AI agents:

```text
Install app (OAuth)
  → Sync agents + call logs from HighLevel
  → Generate evaluation rubric from agent config (LLM)
  → Evaluate calls against rubric → findings
  → Detect recurring issue patterns
  → Generate test cases + run simulations
  → Propose recommendations (prompt / actions / settings)
  → Validate & store recommendations for review
```

---

## Architecture

### System context

```mermaid
flowchart TB
  subgraph User["HighLevel user"]
    Agency["Agency / Location admin"]
  end

  subgraph GHL["GoHighLevel"]
    Marketplace["Marketplace OAuth"]
    VoiceAI["Voice AI Agents & Call Logs API"]
    Iframe["Custom page / iframe host"]
  end

  subgraph App["Agent Optimizer"]
    Client["Vue client<br/>:5173"]
    API["Express API<br/>:3000"]
    DB[(PostgreSQL)]
    LLM["LLM provider<br/>Anthropic or OpenAI"]
  end

  Agency -->|Install app| Marketplace
  Marketplace -->|OAuth code → tokens| API
  Agency -->|Open app in GHL| Iframe
  Iframe -->|SSO postMessage / UI| Client
  Client -->|/api/* proxy| API
  API -->|encrypted tokens + data| DB
  API -->|agents, call logs| VoiceAI
  API -->|rubrics, patterns, tests, recs| LLM
```

### Backend modules

```mermaid
flowchart LR
  subgraph HTTP
    Routes["routes/*"]
    Ctrl["controllers/*"]
  end

  subgraph Domain
    LocSvc["locationService"]
    AgentSvc["agentService / agentSyncService"]
    CallSvc["callService / callSyncService"]
    Rubric["rubricEvaluationService"]
    Pattern["patternDetectionService"]
    Tests["testGeneration + testRunner"]
    Rec["recommend/*"]
  end

  subgraph Integrations
    GHL["ghl/* SDK + OAuth"]
    LLM["llmService"]
    Enc["utils/encryption + sso"]
  end

  DB[(PostgreSQL)]

  Routes --> Ctrl
  Routes --> LocSvc & AgentSvc & CallSvc
  Routes --> Rubric & Pattern & Tests & Rec
  AgentSvc & CallSvc --> GHL
  LocSvc --> Enc
  Rubric & Pattern & Tests & Rec --> LLM
  LocSvc & AgentSvc & CallSvc & Rubric & Pattern & Tests & Rec --> DB
  GHL --> DB
```

### Data / optimization pipeline

```mermaid
sequenceDiagram
  participant U as User (GHL iframe)
  participant C as Vue client
  participant A as Express API
  participant G as HighLevel API
  participant L as LLM
  participant D as PostgreSQL

  U->>C: Open app (SSO / locationId)
  C->>A: POST /api/agents/sync-location/:locationId
  A->>G: List + fetch agents
  A->>D: Upsert agents + agent_versions

  C->>A: POST /api/calls/sync-agent/:agentId
  A->>G: Call logs
  A->>D: Upsert calls

  C->>A: POST /api/analysis/rubric/generate
  A->>L: Generate rubric criteria
  A->>D: rubrics + rubric_criteria

  C->>A: POST /api/analysis/evaluate
  A->>L: LLM criteria (optional)
  A->>D: findings

  C->>A: POST /api/patterns/detect
  A->>L: Pattern titles
  A->>D: issue_patterns

  C->>A: POST /api/tests/generate + /run
  A->>L: Scenarios + sim conversations
  A->>D: test_cases, test_runs, test_results

  C->>A: POST /api/recommendations/generate/:agentId
  A->>L: Propose fixes
  A->>A: validateAndInsert (deterministic)
  A->>D: recommendations
```

### Request path (local dev)

```text
Browser → http://localhost:5173
            │
            ├─ static Vue app (Vite)
            └─ /api/*  ──proxy──►  http://localhost:3000/api/*
                                         │
                                         ├─ PostgreSQL
                                         ├─ HighLevel API
                                         └─ Anthropic / OpenAI
```

---

## Prerequisites

Install these before starting:

| Tool | Version | Notes |
|------|---------|--------|
| **Node.js** | 20.x or newer (22+ recommended) | Backend uses ESM (`"type": "module"`) |
| **npm** | 10+ | Comes with Node |
| **PostgreSQL** | 14+ | Local install, Docker, or managed (Neon, Supabase, RDS, etc.) |
| **HighLevel account** | Agency or sub-account | Needed to create a marketplace app |
| **LLM API key** | Anthropic and/or OpenAI | Required for analysis features |
| **Public HTTPS URL** (for OAuth / iframe) | ngrok, Cloudflare Tunnel, etc. | HighLevel requires HTTPS redirect URLs |

Optional but useful:

```bash
# Example: PostgreSQL via Docker
docker run --name agent-optimizer-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=agent_optimizer \
  -p 5432:5432 \
  -d postgres:16
```

Optional: [ngrok](https://ngrok.com/) for a public tunnel during local OAuth:

```bash
ngrok http 3000
# or tunnel both via a reverse proxy; simplest is tunnel backend :3000
# and point GHL app URL / redirect at the ngrok URL
```

---

## Create a HighLevel Marketplace application

You must create an app in the HighLevel **Developer Marketplace** so this codebase can OAuth-install into locations and call Voice AI APIs.

### 1. Open the Developer Portal

1. Go to **[https://marketplace.gohighlevel.com/](https://marketplace.gohighlevel.com/)** and sign in.  
2. Open the **Developer Portal** / **My Apps**.  
3. Click **Create App** (or **Create Marketplace App**).

Official guide: [Create a Marketplace App](https://marketplace.gohighlevel.com/docs/oauth/CreateMarketplaceApp/).

### 2. Basic app profile

Fill in at least:

- **App name** – e.g. `Voice AI Agent Optimizer`
- **Description** – short summary for installers
- **App type** – Marketplace / Private (Private is fine for development)
- **Company / support URLs** – as required by the form

### 3. Auth & OAuth settings

In the app’s **Auth** / **Advanced Settings**:

| Setting | What to put |
|---------|-------------|
| **Client ID** | Copy → `GHL_CLIENT_ID` in `.env` |
| **Client Secret** | Copy → `GHL_CLIENT_SECRET` in `.env` |
| **Redirect URL(s)** | Add **exactly** the URL you will put in `GHL_REDIRECT_URI` |

**Redirect URL examples:**

```text
# Local development with ngrok pointing at the backend (port 3000)
https://abc123.ngrok-free.app/api/oauth/callback

# Production
https://optimizer.yourdomain.com/api/oauth/callback
```

Rules:

- Prefer **HTTPS** (required by HighLevel for real installs).  
- The path in this project is always **`/api/oauth/callback`**.  
- The string in the Developer Portal must **match `GHL_REDIRECT_URI` character-for-character** (scheme, host, path, no trailing slash unless you registered one).

### 4. Scopes (permissions)

Request Voice AI–related scopes. The backend default (if `GHL_SCOPES` is omitted) is:

```text
voice-ai-agents.readonly
voice-ai-agents.write
voice-ai-dashboard.readonly
voice-ai-agent-goals.readonly
voice-ai-agent-goals.write
```

In `.env` as a single comma-separated line:

```env
GHL_SCOPES=voice-ai-agents.readonly,voice-ai-agents.write,voice-ai-dashboard.readonly,voice-ai-agent-goals.readonly,voice-ai-agent-goals.write
```

Enable the **same scopes** on the marketplace app. If a scope is missing in the portal, API calls for that resource will fail at runtime.

### 5. SSO key (for iframe / embedded UI)

When the app runs **inside HighLevel** as a custom page/iframe, HighLevel sends encrypted user context via `postMessage`.

1. In the Developer Portal open your app → **Manage** / **SSO**.  
2. Copy the **SSO Shared Secret / SSO Key**.  
3. Set it as:

```env
GHL_SHARED_SECRET=paste_sso_key_here
```

The client calls `POST /api/oauth/decrypt-sso` with the encrypted key; the backend decrypts it with `GHL_SHARED_SECRET` and returns `activeLocation`, `userId`, `companyId`, etc.

### 6. App URL (where the UI is hosted)

Configure the marketplace app’s **App URL** / **Module URL** to load your frontend:

| Environment | App URL example |
|-------------|-----------------|
| Local + ngrok to Vite | `https://abc123.ngrok-free.app` (if you tunnel `:5173`) |
| Local + ngrok to API only | Serve built client from Express with `FRONTEND_BUILD_PATH` and use the backend public URL |
| Production | `https://optimizer.yourdomain.com` |

For local dev, a common pattern is:

1. Run backend on `:3000` and client on `:5173` with Vite proxying `/api` → `:3000`.  
2. Tunnel **one** public host that reaches the UI (or put UI behind the same host as the API).  
3. Register OAuth redirect on the **API** path (`…/api/oauth/callback`).

### 7. Distribution / install targets

- For development, mark the app **Private** and install it only on your test agency/location.  
- Install flow: user opens **`GET /api/oauth/install`** → HighLevel consent → redirect to **`/api/oauth/callback`** → tokens stored encrypted in `locations`.

---

## Local development setup

### 1. Clone and install dependencies

```bash
git clone <your-repo-url> agent-optimizer
cd agent-optimizer

# Backend
cd backend
npm install

# Frontend
cd ../client
npm install
```

### 2. Create PostgreSQL database

```bash
# If using local Postgres without Docker:
createdb agent_optimizer

# Or use the Docker command from Prerequisites
```

Connection string shape:

```text
postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

Example:

```text
postgresql://postgres:postgres@localhost:5432/agent_optimizer
```

### 3. Configure backend environment

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` (see [Environment variables](#environment-variables)).

**Minimum required values to boot the API:**

- `DATABASE_URL`
- `ENCRYPTION_KEY` (64 hex chars)
- `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET` / `GHL_REDIRECT_URI` (needed for GHL client init + OAuth)
- `GHL_SHARED_SECRET` (needed for iframe SSO)
- LLM key for your chosen `LLM_PROVIDER`

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into:

```env
ENCRYPTION_KEY=................................  # 64 hex characters
```

### 4. Run database schema

From `backend/`:

```bash
# Apply the full schema (schema.sql)
npm run db:migrate

# Optional: numbered migrations status / apply
npm run migrate:status
npm run migrate
```

`db:migrate` loads `src/db/schema.sql` into your database.  
`migrate` runs SQL files under `src/db/migrations/` in order.

### 5. Start backend and frontend

**Terminal 1 – API**

```bash
cd backend
npm run dev
# → http://localhost:3000
# → Health: http://localhost:3000/health
```

**Terminal 2 – UI**

```bash
cd client
npm run dev
# → http://localhost:5173
# Vite proxies /api → http://localhost:3000
```

### 6. Expose HTTPS for HighLevel (OAuth / iframe)

```bash
# Point ngrok at the backend if OAuth hits the API directly:
ngrok http 3000

# Or at the Vite client if the iframe loads the UI on 5173
# and /api is proxied by Vite:
ngrok http 5173
```

Then:

1. Set `GHL_REDIRECT_URI` to `https://<ngrok-host>/api/oauth/callback`.  
2. Add the **same** redirect URL in the Marketplace app settings.  
3. Set the Marketplace **App URL** to `https://<ngrok-host>` (or your UI URL).  
4. Restart the backend after changing `.env`.

---

## Environment variables

All backend configuration lives in **`backend/.env`** (never commit real secrets).  
Template: **`backend/.env.example`**.

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | `development` \| `test` \| `production` |
| `PORT` | No | `3000` | HTTP port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `CORS_ORIGIN` | No | `*` | CORS origin |
| `LOG_FORMAT` | No | `combined` | Morgan log format |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window for `/api/*` |
| `FRONTEND_BUILD_PATH` | No | — | Absolute/relative path to `client/dist` to serve SPA from Express |

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `DB_POOL_MIN` | No | `2` | Pool min size |
| `DB_POOL_MAX` | No | `10` | Pool max size |

### Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENCRYPTION_KEY` | **Yes** | — | 64 hex chars; encrypts OAuth tokens at rest |
| `GHL_SHARED_SECRET` | **Yes** (iframe) | — | SSO decrypt key from Developer Portal |

### HighLevel

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GHL_CLIENT_ID` | **Yes** | — | Marketplace app client id |
| `GHL_CLIENT_SECRET` | **Yes** | — | Marketplace app client secret |
| `GHL_REDIRECT_URI` | **Yes** | — | Must match portal redirect URL |
| `GHL_SCOPES` | Recommended | Voice AI scopes (see above) | Comma-separated OAuth scopes |
| `GHL_BASE_URL` | No | `https://services.leadconnectorhq.com` | API base |
| `GHL_VERSION_HEADER` | No | `2021-07-28` | `Version` header for GHL REST |
| `GHL_OAUTH_BASE` | No | marketplace OAuth base | Auth page base |
| `GHL_TOKEN_URL` | No | GHL token endpoint | Token exchange URL |

### LLM

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_PROVIDER` | Recommended | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | If Anthropic | — | Anthropic API key |
| `ANTHROPIC_MODEL` | No | `claude-3-5-sonnet-20241022` | Model id |
| `OPENAI_API_KEY` | If OpenAI | — | OpenAI API key |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | Compatible base URL |
| `OPENAI_MODEL` | No | `gpt-4o` | Model id |

### Frontend env

The Vue client does **not** require a separate `.env` for local dev:

- API calls use relative paths like `/api/...`.  
- Vite proxies `/api` → `http://localhost:3000` (see `client/vite.config.ts`).

If you deploy the client on a different origin than the API, either:

- Put both behind the same host/path, or  
- Configure a reverse proxy so `/api` reaches the backend.

### Example filled `.env` (local)

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agent_optimizer
ENCRYPTION_KEY=1a08d39312d9f41435a91126a9bf9de53bd334d3404fe2394580a05120bc7aaa

GHL_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
GHL_CLIENT_SECRET=xxxxxxxxxxxxxxxx
GHL_REDIRECT_URI=https://abc123.ngrok-free.app/api/oauth/callback
GHL_SCOPES=voice-ai-agents.readonly,voice-ai-agents.write,voice-ai-dashboard.readonly,voice-ai-agent-goals.readonly,voice-ai-agent-goals.write
GHL_SHARED_SECRET=your_sso_key_from_portal

LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

> Replace the sample `ENCRYPTION_KEY` with one you generate yourself. Do not reuse sample keys in production.

---

## Database setup

### Option A – full schema (recommended first run)

```bash
cd backend
npm run db:migrate
```

Creates tables from `src/db/schema.sql`, including:

- `locations` – installed GHL locations + encrypted tokens  
- `agents` / `agent_versions` – synced agents and config snapshots  
- `calls` / `call_turns` – call logs and turns  
- `rubrics` / `rubric_criteria` – evaluation criteria  
- `findings` – per-call criterion results  
- `issue_patterns` – recurring issues  
- `test_cases` / `test_runs` / `test_results` – simulation harness  
- `recommendations` / `verify_runs` – optimization proposals  
- `llm_calls` – LLM usage tracking  

### Option B – incremental migrations

```bash
cd backend
npm run migrate:status   # list applied vs pending
npm run migrate          # apply pending files in src/db/migrations/
```

### Verify connectivity

```bash
curl http://localhost:3000/health
```

Expected (healthy DB):

```json
{
  "status": "healthy",
  "database": { "healthy": true, "...": "..." }
}
```

---

## Running the app

### Development (two processes)

```bash
# backend/
npm run dev

# client/
npm run dev
```

| Service | URL |
|---------|-----|
| UI | http://localhost:5173 |
| API | http://localhost:3000 |
| Health | http://localhost:3000/health |
| OAuth install | http://localhost:3000/api/oauth/install |

### Production-style (API serves built UI)

```bash
cd client
npm run build

cd ../backend
# in .env:
# FRONTEND_BUILD_PATH=../client/dist
npm start
```

Then open the backend public URL (e.g. `https://your-domain.com`).

### Useful scripts (backend)

| Command | Purpose |
|---------|---------|
| `npm run dev` | Nodemon API |
| `npm start` | Production API |
| `npm test` | Unit + feature tests |
| `npm run test:coverage` | Tests + coverage report |
| `npm run db:migrate` | Apply `schema.sql` |
| `npm run migrate` | Apply ordered SQL migrations |
| `npm run test:llm` | Smoke-test LLM config |

---

## Install & use the app in HighLevel

### Install (OAuth)

1. Ensure backend is reachable at a public HTTPS URL.  
2. Open:

   ```text
   https://YOUR_PUBLIC_URL/api/oauth/install
   ```

3. Complete HighLevel consent for a location.  
4. You should land on `/api/oauth/callback` and see an **Installation Successful** page.  
5. Tokens are encrypted with `ENCRYPTION_KEY` and stored in `locations`.

### Open the UI

**Inside HighLevel (recommended):**

1. Add the app module / custom page so the iframe loads your App URL.  
2. The Vue client requests SSO data via `postMessage` (`REQUEST_USER_DATA`).  
3. Backend decrypts with `GHL_SHARED_SECRET` and resolves `activeLocation`.  
4. UI loads agents for that location.

**Local without iframe:**

```text
http://localhost:5173/?locationId=YOUR_GHL_LOCATION_ID
```

`locationId` must already exist in the `locations` table (after OAuth install).

### Typical UI flow

1. **Sync agents** for the location.  
2. **Sync calls** for an agent.  
3. Open agent analysis → **Generate rubric** → **Evaluate calls**.  
4. **Detect patterns**.  
5. **Generate & run tests**.  
6. **Generate recommendations** and review them in the UI.

---

## API overview

Base path: **`/api`**

| Area | Methods / paths (summary) |
|------|---------------------------|
| **OAuth** | `GET /oauth/install`, `GET /oauth/callback`, `POST /oauth/decrypt-sso`, `GET /oauth/locations`, `DELETE /oauth/locations/:id` |
| **Locations** | `POST/GET/PUT/DELETE /locations`, tokens endpoints |
| **Agents** | CRUD `/agents`, sync `/agents/sync/:id`, `/agents/sync-location/:locationId`, config/actions/prompt |
| **Calls** | CRUD `/calls`, sync `/calls/sync-agent/:agentId`, list by agent/location/stats |
| **Analysis** | `POST /analysis/rubric/generate`, `GET /analysis/rubric/:agentVersionId`, `POST /analysis/evaluate`, `GET /analysis/findings/:callId` |
| **Patterns** | `POST /patterns/detect`, get by agent/version/id |
| **Tests** | `POST /tests/generate`, `POST /tests/run`, list/archive cases & runs |
| **Recommendations** | `GET /recommendations/agent/:agentId`, `POST /recommendations/generate/:agentId`, `DELETE /recommendations/:id` |

Health (outside `/api`):

```http
GET /health
```

---

## Project structure

```text
agent-optimizer/
├── README.md                 ← this file
├── LICENSE
├── backend/
│   ├── .env.example          ← copy to .env
│   ├── package.json
│   ├── vitest.config.js
│   ├── src/
│   │   ├── index.js          ← Express app entry
│   │   ├── controllers/      ← HTTP handlers (analysis)
│   │   ├── routes/           ← API routers
│   │   ├── services/         ← business logic
│   │   ├── recommend/        ← recommendation engine
│   │   ├── ghl/              ← HighLevel OAuth + SDK wrappers
│   │   ├── db/               ← connection, schema, migrations, queries
│   │   ├── utils/            ← encryption, SSO decrypt
│   │   └── jobs/             ← shutdown helpers
│   ├── tests/                ← unit + feature tests
│   ├── scripts/              ← manual smoke scripts
│   └── docs/
├── client/
│   ├── package.json
│   ├── vite.config.ts        ← /api proxy → :3000
│   ├── index.html
│   └── src/
│       ├── App.vue
│       ├── main.ts
│       └── components/       ← AgentSync, Analysis, Tests, Recommendations, …
└── frontend/                 ← partial/legacy assets (primary UI is client/)
```

---

## Testing

```bash
cd backend
npm test                 # 250+ unit & feature tests
npm run test:coverage    # HTML report in backend/coverage/
```

Tests mock PostgreSQL, HighLevel SDK, and LLM providers so they run without real credentials.  
Ensure `NODE_ENV=test` is set by Vitest setup (handled automatically in `tests/setup.js`).

---

## Production notes

1. **HTTPS only** for Marketplace App URL and OAuth redirect.  
2. Rotate `ENCRYPTION_KEY` carefully — existing tokens cannot be decrypted with a new key.  
3. Set `NODE_ENV=production`, tighten `CORS_ORIGIN`, and raise/adjust rate limits as needed.  
4. Use a managed Postgres with backups; set `DATABASE_URL` securely (secrets manager).  
5. Prefer serving the built client via `FRONTEND_BUILD_PATH` or a CDN + same-origin API proxy.  
6. Keep `GHL_CLIENT_SECRET`, `GHL_SHARED_SECRET`, and LLM keys out of logs and git.  
7. Watch HighLevel API rate limits; the GHL client already retries on `429` / `5xx`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `DATABASE_URL environment variable is required` | Missing `.env` or wrong cwd | Create `backend/.env`; run npm from `backend/` |
| `ENCRYPTION_KEY must be 32 bytes (64 hex…)` | Wrong key length | Regenerate with the `crypto.randomBytes(32)` command |
| `GHL_CLIENT_ID and GHL_CLIENT_SECRET must be set` | Empty marketplace credentials | Copy from Developer Portal into `.env` |
| OAuth callback error / invalid redirect | Redirect mismatch | Align portal Redirect URL and `GHL_REDIRECT_URI` exactly |
| SSO decrypt fails in iframe | Wrong `GHL_SHARED_SECRET` | Copy SSO key from portal → Manage → SSO |
| `/health` → `unhealthy` | Postgres down or bad URL | Check Postgres process, firewall, `DATABASE_URL` |
| UI loads but API 404 | Proxy / wrong host | Use Vite dev server so `/api` proxies to `:3000`, or configure reverse proxy |
| Empty agents after install | Scopes or Voice AI not available on location | Confirm scopes on app + location has Voice AI agents |
| LLM errors during rubric/tests | Missing/invalid API key | Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for `LLM_PROVIDER` |
| ngrok page blocks iframe | Free ngrok interstitial | Use authenticated ngrok, paid plan, or another tunnel |

### Quick health checklist

```bash
# 1. Postgres
psql "$DATABASE_URL" -c 'SELECT 1'

# 2. Backend
curl -s http://localhost:3000/health | jq .

# 3. Frontend proxy
curl -s http://localhost:5173/api/  # expect JSON 404 from API router, not HTML

# 4. Encryption key length
node -e "console.log(process.env.ENCRYPTION_KEY?.length)"  # should print 64 (if exported)
```

---

## License

See [LICENSE](./LICENSE).

---

## Support map

| Need help with… | Look at… |
|-----------------|----------|
| Database tables / CRUD | `backend/docs/Database.md`, `backend/src/db/schema.sql` |
| OAuth implementation | `backend/src/ghl/oauth.js`, `backend/src/routes/oauthRoutes.js` |
| Recommendation types | `backend/src/recommend/recTypes.js` |
| HighLevel marketplace docs | [Create Marketplace App](https://marketplace.gohighlevel.com/docs/oauth/CreateMarketplaceApp/), [Developer Marketplace intro](https://help.gohighlevel.com/support/solutions/articles/155000000136-how-to-get-started-with-the-developer-s-marketplace) |

If you follow **Prerequisites → Marketplace app → `.env` → migrate → `npm run dev` (backend + client) → ngrok redirect**, you should be able to install the app and run the full optimization loop on a real HighLevel location.
