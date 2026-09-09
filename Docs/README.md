# LeadForge 360

AI-native lead management portal by AB7 Solutions. **Zero Postgres, zero `.env`.** Data lives in a single **SQLite file on disk** (`data/leadforge.sqlite`) when you run the server, or in the browser's IndexedDB when you just open `index.html`.

## How data is stored

| Mode | How you run it | Where your data lives | Who can see it |
|---|---|---|---|
| **Standalone** | Open `index.html` directly | Browser IndexedDB (sql.js WebAssembly) | Only that browser profile |
| **Server** | `node server.js` | `./data/leadforge.sqlite` — a real SQLite file on disk | Every browser pointed at the server |

Both modes use the same SQLite schema. You can download the file from either mode and open it in [DB Browser for SQLite](https://sqlitebrowser.org).

## File layout

```
Lead Management Portal/
├── index.html              ← 11 KB HTML shell
├── css/app.css             ← all styles
├── js/app.js               ← all application logic (LF.* namespaces)
├── assets/logo.png
├── server.js               ← Node + better-sqlite3 → data/leadforge.sqlite
├── package.json            ← single dependency: better-sqlite3
├── nginx.conf.example      ← production nginx config (CSP, TLS, /api/ proxy)
├── SECURITY.md             ← threat model, hardening checklist
└── data/                   ← created on first run; holds leadforge.sqlite
```

## Quick start — three modes

### 1. Just open `index.html`
Double-click. The portal runs off `file://`, uses sql.js + IndexedDB for persistence. No install, no server.

### 2. Run the server (persistent SQLite file on disk)
```bash
npm install                  # installs better-sqlite3
npm start                    # http://localhost:8080
```
The server creates `data/leadforge.sqlite` on first launch. Every save the portal makes is written straight to that file. The browser still gets the full UI at `/`.

**Backup is a single file copy:**
```bash
cp data/leadforge.sqlite backups/leadforge-$(date +%F).sqlite
```

**Different port / path:**
```bash
PORT=3000 DB_FILE=/var/lib/leadforge/prod.sqlite node server.js
```

### 3. Production behind nginx
1. Run the server on 127.0.0.1:8080 as a systemd service.
2. Copy `nginx.conf.example` to `/etc/nginx/sites-available/leadforge`, edit the hostname, enable it, get a TLS cert via certbot.
3. Nginx serves the static files directly (fast cache) and proxies `/api/*` to the Node server. Strict CSP + HSTS + X-Frame-Options are already in the config.

Full operator checklist in `SECURITY.md`.

## API (when running the server)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health`   | Status + DB size + row counts |
| GET  | `/api/snapshot` | Load entire workspace (leads, tasks, team, settings) |
| POST | `/api/snapshot` | Save entire workspace (debounced from the browser) |
| GET  | `/api/download` | Stream the raw `.sqlite` file as an attachment |

All endpoints are scoped to the one SQLite file. No auth layer ships by default — put it behind nginx + IP allowlist or add a bearer-token middleware if you expose it publicly.

## DB file lifecycle

```
data/leadforge.sqlite           ← your data
data/leadforge.sqlite-wal       ← write-ahead log (normal, don't touch)
data/leadforge.sqlite-shm       ← shared memory (normal, don't touch)
```

WAL mode is enabled so the DB stays responsive during concurrent reads. A `SIGINT`/`SIGTERM` (i.e. stopping the server normally) checkpoints the WAL back into the main file. If you `cp` the three files together you have a consistent snapshot.

## Troubleshooting

**`npm install` fails with a native-build error**
`better-sqlite3` has prebuilt binaries for Windows/macOS/Linux on Node 18/20/22. If prebuilds don't match your platform, you'll need a C++ toolchain (on Windows that's `npm install -g windows-build-tools` or Visual Studio Build Tools). Or skip the server and use Option 1 — everything still works in the browser.

**Port 8080 in use**
`PORT=3000 npm start`

**Want to reset all data**
Stop the server, delete `data/leadforge.sqlite*` (all three), start again. A fresh DB with demo data is created.

**Moving from browser mode to server mode**
Open Settings → 🗄 Local DB → **⬇ Download .sqlite file**. Then start the server, and put that file at `data/leadforge.sqlite` (rename if needed). Restart the server — it picks up your data.

## Security notes

- Never commit `data/` — add it to `.gitignore` (already done).
- Run the server as a non-root user with read/write access only to `data/`.
- The SQLite file contains lead PII — encrypt at rest (LUKS / BitLocker / EBS encryption).
- For multi-user production, add an auth layer in front of `/api/*` (e.g. nginx basic auth, mTLS, or a small JWT middleware in `server.js`).

See **SECURITY.md** for the full hardening checklist and threat model.

## License

Proprietary. © AB7 Solutions 2026.

---
**AB7 Solutions · Collaborate More · Grow More**
