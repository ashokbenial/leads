# LeadForge 360 — Deployment Guide

This guide takes you from a fresh Postgres instance to a running LeadForge 360 portal with persistent server-side storage.

## Architecture

```
┌─────────────┐      HTTPS / JSON      ┌──────────────┐      pg wire       ┌────────────┐
│  index.html │ ─────────────────────► │  server.js   │ ─────────────────► │ Postgres   │
│  (browser)  │ ◄───────────────────── │  (Node.js)   │ ◄───────────────── │ database   │
└─────────────┘                        └──────────────┘                    └────────────┘
     │                                        │                                 ▲
     └── falls back to localStorage ──────────┘                                 │
         if server unreachable                                                  │
                                                                                │
                                                     Any Postgres 13+: Supabase,│
                                                     Neon, RDS, self-hosted…    │
```

The browser still runs fine without the server (localStorage mode). The moment `GET /api/health` returns 200, the frontend auto-upgrades to live DB reads and every save is mirrored to Postgres.

## Prerequisites

- **Node.js 18 or newer** (`node --version`)
- **Postgres 13 or newer** — any provider works: local, Supabase, Neon, AWS RDS, DigitalOcean, Railway, etc.
- A **database** created and a user that can `CREATE TABLE` on it.

## 1. Configure your `.env`

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. The bare-minimum for a working deployment:

```env
PORT=4000
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE
PGSSL=true                       # true for managed Postgres (Supabase, Neon, RDS, …)
APP_SECRET=REPLACE_WITH_48_BYTE_HEX_STRING
TENANT_ID=ab7-solutions
CORS_ORIGIN=*                    # lock this down in production
```

Generate a strong `APP_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

If your provider requires separate host/port/user/password variables (rather than a single `DATABASE_URL`), use the `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` variables instead. The server prefers `DATABASE_URL` when both are present.

### Connection-string quick references

| Provider | Format |
|---|---|
| **Supabase** | `postgres://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres` · `PGSSL=true` |
| **Neon**     | `postgres://USER:PASSWORD@ep-xyz.region.neon.tech/DB?sslmode=require` · `PGSSL=true` |
| **AWS RDS**  | `postgres://USER:PASSWORD@xxx.rds.amazonaws.com:5432/DB` · `PGSSL=true` |
| **Local**    | `postgres://localhost:5432/leadforge` · `PGSSL=false` |
| **Railway**  | Railway provides `DATABASE_URL` automatically · `PGSSL=true` |

## 2. Install dependencies

```bash
npm install
```

## 3. Create the schema

```bash
npm run db:migrate
```

You should see:

```
→ Connecting to DATABASE_URL
✓ Connected · leadforge · PostgreSQL 16.1
→ Applying schema.sql…
✓ Schema applied

Current row counts:
  leads              0
  users              0
  scheduled_tasks    0
  email_accounts     0
  tenants            1

✓ Migration complete.
```

The `tenants` row is auto-created from your `TENANT_ID` env. All other tables start empty — they'll be populated the moment the portal saves state for the first time.

To wipe and recreate tables:

```bash
npm run db:reset
```

## 4. Start the server

```bash
npm start
```

You'll see:

```
  ✓ LeadForge 360 API running on http://localhost:4000
  ✓ Tenant: ab7-solutions
  ✓ DB: postgres://user:***@host:5432/leadforge
  ✓ Open the portal at http://localhost:4000
```

Open `http://localhost:4000`. Sign in with `ashok.benial@ab7solutions.com` / `demo`. Within a second you'll see a toast: **✓ Connected to Postgres — live data loaded**. Every subsequent save is persisted in your database.

For development with auto-reload:

```bash
npm run dev
```

## 5. Verify it's working

In a separate terminal:

```bash
curl http://localhost:4000/api/health
# {"ok":true,"now":"…","db":"leadforge","version":"PostgreSQL 16.1","tenant":"ab7-solutions"}

curl http://localhost:4000/api/snapshot | head -50
```

Or query Postgres directly:

```sql
SELECT COUNT(*) FROM leads;
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM scheduled_tasks;
SELECT key FROM settings;
```

## 6. Production deployment

### Option A — PM2 (Linux/macOS VM)

```bash
npm install -g pm2
pm2 start server.js --name leadforge
pm2 startup
pm2 save
```

### Option B — systemd (Linux)

`/etc/systemd/system/leadforge.service`:

```
[Unit]
Description=LeadForge 360
After=network.target

[Service]
WorkingDirectory=/opt/leadforge
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=/opt/leadforge/.env
User=leadforge

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now leadforge
```

### Option C — Docker

`Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 4000
CMD ["node","server.js"]
```

```bash
docker build -t leadforge .
docker run -d --name leadforge -p 4000:4000 --env-file .env leadforge
```

### Option D — Railway / Render / Fly.io

Most one-click Node hosts work out of the box. Set environment variables from your `.env`, point the build command at `npm install`, start command at `npm start`.

## 7. Security checklist

- [ ] Never commit `.env` (already in `.gitignore`)
- [ ] `CORS_ORIGIN` set to your actual domain(s), not `*`
- [ ] `PGSSL=true` for any non-localhost database
- [ ] Run the Node process as a non-root user
- [ ] Put the server behind a reverse proxy with TLS (Caddy, Nginx, Cloudflare)
- [ ] Rotate the `APP_SECRET` periodically
- [ ] Enable Postgres connection limits matching `PG_POOL_MAX`
- [ ] For production login, replace the demo password hash with bcrypt/argon2 (the current hash in `LF.team._hash` is for demos only — the `password_hash` column in Postgres is ready to hold any digest)

## 8. API reference

The server exposes these endpoints (all JSON, all scoped to `TENANT_ID`):

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | Liveness + DB check |
| GET  | `/api/snapshot` | Fetch full workspace state |
| POST | `/api/snapshot` | Write full workspace state (frontend calls this automatically on save) |
| GET  | `/api/leads` | List all leads |
| GET  | `/api/leads/:id` | One lead + its activity timeline |
| POST | `/api/leads` | Create a lead |
| PUT  | `/api/leads/:id` | Update a lead |
| DELETE | `/api/leads/:id` | Delete a lead |
| POST | `/api/leads/bulk` | Transactionally replace all leads |
| GET/POST/DELETE | `/api/users` | Team members |
| POST | `/api/auth/login` | Credential-based login |
| GET/PUT | `/api/company` | Company profile |
| GET/POST/PUT/DELETE | `/api/tasks` | Scheduled tasks |
| GET/PUT | `/api/settings/:key` | Any named JSONB setting |

## 9. Troubleshooting

**"API not reachable — running in localStorage-only mode"** (console)
→ Server isn't running or `window.LF_API_URL` is wrong. Verify `curl http://localhost:4000/api/health` returns 200. If the portal is on a different origin, set `window.LF_API_URL = "https://api.your.com"` before `LF.init()` loads (e.g. via a `<script>` above the main one).

**`certificate has expired` / self-signed**
→ Set `PGSSL=true` and let the pool accept self-signed certs. Already configured via `rejectUnauthorized: false` for managed providers.

**`relation "leads" does not exist`**
→ You forgot `npm run db:migrate`.

**Port 4000 already in use**
→ Change `PORT` in `.env`.

**Data I saved locally isn't in Postgres**
→ Save happens debounced 400 ms after you stop typing. Force a flush by navigating to any other tab and back. Or inspect `/api/snapshot` to see what's persisted.

**I want to move existing localStorage data to Postgres**
→ Start the server, open the portal once — your browser's localStorage is replayed to the API on the first `LF.storage.save()` (any edit, or call `LF.storage.save()` from the console).

## 10. File map

| File | Purpose |
|---|---|
| `index.html` | The portal UI (single-file frontend) |
| `server.js` | Express + Postgres API |
| `db/schema.sql` | CREATE TABLE statements |
| `db/migrate.js` | Schema runner |
| `package.json` | Dependencies + scripts |
| `.env` | Secrets (you create; never commit) |
| `.env.example` | Template |
| `.gitignore` | Protects `.env` |
| `DEPLOYMENT.md` | This file |
