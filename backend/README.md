# Sprout Backend

REST API for Sprout, the non-custodial Algorand crowdfunding platform. Stores
campaign metadata and cached lifecycle status in Supabase (PostgreSQL). **All
financial operations (contributions, finalization, refunds) happen on the
Algorand blockchain** — this backend is purely the metadata, caching, and
status-reconciliation layer. It never holds funds.

## Stack

- **Runtime:** Node.js 20+
- **Framework:** Express
- **Database:** Supabase (PostgreSQL)
- **Auth:** Ed25519 verification of a signed 0-ALGO self-transaction
- **On-chain sync:** scheduled job reconciles cached flags against chain state
- **Deployment:** Render (any Node host works)

---

## Quick Start

### 1. Create a Supabase project

1. Go to https://app.supabase.com and create a new project
2. Note your **Project URL** and **service_role key** from Settings -> API
3. Apply the schema: run `node src/utils/migrate.js` (it applies the schema and
   idempotent migrations), or copy its SQL into the Supabase SQL Editor

### 2. Configure environment

Set these in the environment (a local `.env` works in development):

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_ADDRESS=your-algorand-admin-address
ALGOD_SERVER=https://mainnet-api.algonode.cloud
INDEXER_SERVER=https://mainnet-idx.algonode.cloud
ALLOWED_ORIGINS=http://localhost:5173,https://your-frontend.vercel.app
```

`ADMIN_ADDRESS` must match the frontend's admin address.

### 3. Install and run

```bash
npm install
npm run dev       # development (nodemon)
npm start         # production
```

### 4. Verify

```
GET http://localhost:3001/api/health
```

Returns DB + algod status.

---

## API Reference

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check — DB + algod status |
| GET | `/api/projects` | Public projects (Explore) |
| GET | `/api/projects/:appId` | Single project metadata |
| GET | `/api/projects/by-creator/:address` | Projects by creator (My Projects) |

### Creator (requires wallet signature)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | Register a newly deployed campaign |
| PATCH | `/api/projects/:appId/status` | Update lifecycle flags |

### Admin (requires admin wallet signature)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/admin/all` | All projects including hidden |
| PATCH | `/api/projects/:appId/visibility` | Hide/unhide from Explore |
| PATCH | `/api/projects/:appId/feature` | Feature / order on the homepage |
| DELETE | `/api/projects/:appId` | Permanently purge from DB |

---

## Authentication

Write endpoints require the caller to prove they control an Algorand address.
Rather than signing arbitrary bytes (`signBytes` isn't supported by all wallets,
e.g. Defly), the caller signs a **0-ALGO self-payment transaction** carrying a
challenge in the note field. Every wallet can sign a transaction, so this works
universally.

### How it works

The frontend builds a 0-ALGO payment from the user to themselves with:

```
note = "algolaunch-auth:<resource>:<firstValid>"
```

The user signs it (the transaction is **never submitted** — the signature is the
proof). The backend then verifies:

1. Ed25519 signature via tweetnacl over `"TX" || msgpack(txn)`
2. The public key derives from the claimed Algorand address
3. sender == receiver (a genuine self-payment)
4. amount == 0 and no rekey
5. the note matches the expected challenge for the requested resource

The signature is **resource-bound** (the note ties it to a specific action), so a
signature for one operation can't be replayed against another.

> Note: the note prefix string is `algolaunch-auth:` (a legacy name) and must
> match between frontend and backend exactly.

---

## Database Schema

Authoritative definition lives in `src/utils/migrate.js`. Current shape:

```sql
projects (
  app_id          bigint PRIMARY KEY,           -- Algorand application ID
  creator_address text   NOT NULL,

  -- Metadata
  name            text   NOT NULL,
  tagline         text   NOT NULL DEFAULT '',
  description     text   NOT NULL DEFAULT '',
  category        text   NOT NULL DEFAULT 'Other',
  website_url     text   NOT NULL DEFAULT '',
  deck_url        text   NOT NULL DEFAULT '',
  image_url       text   NOT NULL DEFAULT '',
  token_name      text   NOT NULL DEFAULT '',

  -- Economics (cached at deploy; survive contract deletion)
  goal_micro      bigint NOT NULL DEFAULT 0,     -- funding goal in microALGO
  rate_per_algo   bigint NOT NULL DEFAULT 0,     -- tokens_per_bundle (0 = donation)
  algo_per_bundle bigint NOT NULL DEFAULT 1,     -- algo_per_bundle (>= 1)

  -- Lifecycle flags
  is_funded       boolean NOT NULL DEFAULT false,
  is_distributed  boolean NOT NULL DEFAULT false,
  is_refunded     boolean NOT NULL DEFAULT false,
  is_cancelled    boolean NOT NULL DEFAULT false,
  is_hidden       boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
)
```

Additional columns exist for homepage curation (`is_featured`, `feature_order`),
campaign type (`is_donation`), the milestone/series system, and cached on-chain
fields populated by the sync job (`on_chain_*`). `migrate.js` adds newer columns
idempotently (`add column if not exists`), so it is safe to re-run.

---

## On-chain sync

A scheduled job (`src/jobs/syncJob.js` -> `src/services/sync.js`) reads each
campaign's global state from algod and reconciles the cached lifecycle flags in
the database. The contract is always the source of truth; the database is a
cache for fast querying and for retaining metadata after a contract is deleted.

---

## Deployment (Render)

1. Push the repo to GitHub
2. Create a new **Web Service** on https://render.com, root = `backend/`
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. Add all environment variables listed above
6. Set the Node version to 20

Set `ALLOWED_ORIGINS` to include your Vercel frontend URL, and set the frontend's
`VITE_API_URL` to the deployed Render service URL.
