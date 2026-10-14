# Running LeadForge 360 locally (VS Code)

Two ways to run it. Pick by whether you need the database.

| Mode | Command | Data lives in | Use it for |
|---|---|---|---|
| **A · Full stack** | `npm start` → http://localhost:4000 | Supabase `leadforge-dev` | API work, real leads, anything touching `db-server.js` / `db-repo.js` |
| **B · Frontend only** | Live Server on `index.html` | Your browser's localStorage | CSS / `js/app.js` UI work, no credentials needed |

Both are already set up in this repo. `npm install` has been run.

---

## A · Full stack (Supabase dev project)

`.env.local` already points at **leadforge-dev**
(`https://gharppbbudkrouxsoiwi.supabase.co`). That project has the full v2
relational schema and real dev data (~140 leads, 6 team members).

```bash
npm start          # http://localhost:4000
npm run dev        # same, with --watch auto-restart
```

Or press **F5** in VS Code — `.vscode/launch.json` runs `db-server.js` with
`.env.local` loaded and the debugger attached.

You should see:

```
  ✓ LeadForge 360 — DB-backed portal running
  ✓ Store:  Supabase relational v2 (gharppbbudkrouxsoiwi.supabase.co)
  ✓ Tenant: ab7-solutions
  ✓ Open:   http://localhost:4000
```

Then open http://localhost:4000. The topbar pill should read **connected**, not
"⊘ Offline · localStorage".

Check the API directly:

```bash
curl http://localhost:4000/api/health
```

### ⚠ Never point .env.local at prod
`leadforge-prod` is a **different Supabase project** (`nkmudcfarrldrwxzlutz`).
A prod `SUPABASE_URL` on a dev machine replaces the live workspace on the first
write. `.env.local` is gitignored — keep it that way.

---

## B · Frontend only (no database)

Right-click `index.html` → **Open with Live Server** (extension
`ritwickdey.LiveServer`, recommended in `.vscode/extensions.json`).

`/api/health` 404s, `LF.db` falls back to localStorage + sql.js, and the portal
runs single-user out of your browser. Everything except the server API works.

⚠ Live Server serves the whole folder, including `.env.local` and `Docs/`. It
binds to localhost, but don't expose that port on a network.

---

## Troubleshooting

**`FATAL: SUPABASE_URL and SUPABASE_SECRET_KEY are required`**
`.env.local` isn't being read. Node 20.12+ / 22+ is required for
`--env-file-if-exists`. Check with `node -v`.

**401 / "Invalid API key" from Supabase**
The secret key in `.env.local` is wrong or has been rotated. Fix it:
Supabase dashboard → **leadforge-dev** → Project Settings → API Keys →
Secret keys → copy button → paste over the `SUPABASE_SECRET_KEY=` line.
It must start with `sb_secret_`.

**Green `/api/health` but zero leads**
You're on the *publishable* key. `leadforge_state` and the v2 tables have RLS on
with no policies, so a publishable key returns an empty workspace — and the
first client write then overwrites everything. `db-server.js` rejects
`sb_publishable_*` at boot for exactly this reason; don't remove that guard.

**`EADDRINUSE` on 4000**
`PORT=3000 npm start`, or change `PORT` in `.env.local`.

**Port 4000 loads but the page is blank**
Check the browser console. `js/app.js` is 662 KB — if a previous edit left
trailing NUL bytes it won't parse. `node --check js/app.js` catches it.

**After editing `js/app.js` or `css/app.css`**
Just reload the browser. There is no build step — don't add one.
