# AB7 LeadForge 360 — Deployment Guide

The portal ships with two backend options. Pick the one that fits.

| Option        | Backend           | Persistence                  | When to use                    |
| ------------- | ----------------- | ---------------------------- | ------------------------------ |
| **A. Local**  | `db-server.js`    | `data/leadforge.json`        | Single user, laptop, demo      |
| **B. LAN**    | `db-server.js`    | `data/leadforge.json`        | Small office team, intranet    |
| **C. Cloud**  | `db-server.js`    | Mounted disk volume          | Public URL, < 25 users         |
| **D. Scale**  | `server.js`       | Postgres                     | Multi-tenant, > 25 users       |

---

## A. Local desktop (zero setup, < 1 minute)

Best for a single user on one laptop.

```bash
cd "Lead Management Portal"
npm install
npm start
```

Open http://localhost:4000

The DB file is created automatically at `data/leadforge.json`. **Back this file up periodically** — it contains everything.

---

## B. Office LAN server

Run the portal on one machine, share with the team over the local network.

```bash
# On the host machine (Windows / macOS / Linux)
cd "Lead Management Portal"
npm install
PORT=4000 npm start
```

Find your LAN IP, e.g. `192.168.1.50`. Teammates open http://192.168.1.50:4000

**Windows firewall:** allow Node.js inbound on port 4000 the first time it prompts.

**Auto-start on Linux** — copy `ab7-leadforge.service` to `/etc/systemd/system/`, then:

```bash
sudo systemctl enable --now ab7-leadforge
```

---

## C. Cloud deploy — Render (recommended, < 5 minutes)

1. Push this folder to a GitHub repo (private is fine).
2. Sign in at https://render.com.
3. **New → Blueprint → connect your repo.** Render reads `render.yaml` and creates the service + persistent disk automatically.
4. After the first deploy completes, open the URL it shows. The DB file lives on a 1 GB persistent disk — survives redeploys and restarts.

To back up: SSH into the Render shell and `cat data/leadforge.json`, or set up a daily cron via Render's scheduled jobs.

### Other one-click hosts that work the same way

- **Railway** — `npm start` is auto-detected. Add a 1 GB volume mounted at `/app/data`.
- **Fly.io** — `fly launch`, attach a volume to `/app/data`.
- **DigitalOcean App Platform** — Node service, attach a Spaces-mounted volume or use the bundled disk.

---

## D. Docker (portable, any host)

```bash
# build
docker build -t ab7-leadforge .

# run with a named volume so the JSON DB survives restarts
docker run -d \
  --name ab7-leadforge \
  -p 4000:4000 \
  -v ab7-data:/app/data \
  ab7-leadforge
```

Open http://localhost:4000

To pull an existing JSON DB into the container:

```bash
docker cp ./data/leadforge.json ab7-leadforge:/app/data/leadforge.json
docker restart ab7-leadforge
```

A `docker-compose.yml` for combining with Postgres (option E below):

```yaml
version: "3.9"
services:
  portal:
    build: .
    ports: ["4000:4000"]
    volumes: ["ab7-data:/app/data"]
    environment:
      NODE_ENV: production
      PORT: 4000
volumes:
  ab7-data:
```

---

## E. Scale-up — Postgres backend

When you outgrow the JSON DB (multi-tenant, > 25 concurrent users, audit-grade durability), switch to Postgres:

```bash
# Provision Postgres (Neon, Supabase, RDS, or local docker)
export DATABASE_URL=postgres://user:pass@host:5432/leadforge
npm run db:migrate          # creates schema from db/schema.sql
npm run start:postgres      # uses server.js instead of db-server.js
```

The frontend is unchanged — both backends expose the same `/api/snapshot` and `/api/leads` endpoints. To migrate existing data: `cat data/leadforge.json` and POST it to `/api/snapshot` on the new Postgres-backed deploy.

---

## Backups

For options A–D the DB is one file. Schedule a copy:

```bash
# cron — daily backup with rotation
0 2 * * * cp /opt/ab7-leadforge/data/leadforge.json /backups/leadforge-$(date +\%F).json && find /backups -name 'leadforge-*.json' -mtime +30 -delete
```

For option E use `pg_dump` to S3 or your DB provider's automated backups.

---

## Production hardening checklist

- [ ] Re-enable login (set `LF.LOGIN_BYPASS = false` in `js/app.js` and restore `<form>` in `index.html`, or build a real auth via Settings → Security).
- [ ] Replace the demo `LF.team._hash()` with bcrypt/argon2 on the backend.
- [ ] Put the portal behind HTTPS (Caddy, Nginx, Cloudflare, or Render's auto-TLS).
- [ ] Tighten `CORS_ORIGIN` to your domain only.
- [ ] Set up scheduled backups of `data/leadforge.json` (or `pg_dump` for option E).
- [ ] Configure log rotation (`pm2 logrotate` or systemd journal).
