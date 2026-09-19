# LeadForge 360 — Agent Instructions

AI-native Lead Management Portal for AB7 Solutions. Single-page app, vanilla JS, no build step.

## The Datastore — read this first

**There is exactly ONE datastore: Supabase Postgres. There is no fallback and no alternative backend.**

The entire workspace is a single JSON document in one row of `public.leadforge_state`:

```
tenant text primary key | data jsonb | updated_at timestamptz
```

`db-server.js` is the only thing that talks to it (`backendRead` / `backendWrite`). It **refuses to boot** without `SUPABASE_URL` + `SUPABASE_SECRET_KEY` — a loud crash, deliberately, because silently falling back to a store nobody reads is how this app lost six days of writes in July 2026.

Dev and prod are **separate Supabase projects** (separate databases), chosen purely by which `SUPABASE_URL` is in the environment. `TENANT` is a hardcoded constant (`ab7-solutions`), not an env var — it's this app's row key, not a Supabase concept.

**Do not add a second backend.** No JSON file, no Redis, no Blob, no SQLite, no `pg`. This repo has cycled through all four and every leftover caused an outage.

## Run Locally

```
npm install
cp .env.example .env.local   # fill in the leadforge-DEV project
npm start                    # node db-server.js → http://localhost:4000
```

`npm start` loads `.env.local` via `--env-file-if-exists`. **Never put production credentials in `.env.local`** — a prod `SUPABASE_URL` on a dev machine replaces the production workspace in one upsert.

### Environment variables (the complete list)

| Var | Required | Value |
|-----|----------|-------|
| `SUPABASE_URL` | **yes** | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | **yes** | `sb_secret_…` from Settings → API Keys → Secret keys. **Not** the publishable key — the app rejects it (see below). |
| `PORT` | no | API port, default 4000. Ignored on Vercel. |
| `INGEST_TOKEN` | prod | Shared secret for the website ingest webhooks. Unset ⇒ those endpoints are unauthenticated. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | no | First-run Admin, seeded only when the DB has no Admin with credentials. |

`.env` / `.env.local` are gitignored — never commit them.

**Why the publishable key is rejected:** `leadforge_state` has RLS enabled with no policies. The secret key bypasses RLS; the publishable key doesn't. Wiring the publishable key gives you a **green `/api/health` over an empty workspace**, and the first client write then overwrites production. `db-server.js` throws on any key matching `^sb_publishable_`.

## Stack
- **Frontend**: vanilla JS in `js/app.js` (single file, ~8.7k lines), `css/app.css`, `index.html`. No bundler, no framework.
- **Backend**: `db-server.js` (Express + `@supabase/supabase-js`). The only server. Serves the static portal and `/api/*` from the same origin.
- **Serverless entry**: `api/index.js` — a one-line `require('../db-server.js')`. `vercel.json` rewrites `/(.*)` → `/api`. **Never add other files under `api/`**: Vercel resolves real function files *before* rewrites, so `api/health.js` would silently shadow `db-server.js`'s `/api/health`. That exact mistake caused the July 2026 outage.
- **Schema**: `docs-leadforge-supabase-setup.sql` — run once per Supabase project.
- **Seeding**: `npm run seed -- backups/SEED-prod.json` (`scripts/seed-supabase.js`). Refuses to overwrite a row that already holds leads unless `--force`.
- **Deploy**: Vercel. See `DEPLOY.md`.

## Production Deployment (canonical)

The live install runs on a Linux VPS. **This is the only supported prod topology — don't suggest Docker/Render/PaaS alternatives unless explicitly asked.**

The live install runs on **Vercel**. It is *not* on a VPS — the `/opt/leads` + pm2 + nginx topology described in older docs was decommissioned around 2026-07-01. `ecosystem.config.js`, `nginx.conf.example`, `ab7-leadforge.service`, `Dockerfile` and `render.yaml` all describe topologies that do **not** serve traffic.

| Item | Value |
|------|-------|
| URL | `https://leads.ab7solutions.com/` |
| Host | Vercel — project `project-vqpw8`, org `ashok-benials-projects-c7fe416a` |
| Entry point | `api/index.js` → `require('../db-server.js')` |
| Routing | `vercel.json` rewrites `/(.*)` → `/api`. Real files under `api/` shadow this — keep `api/` to `index.js` only. |
| Database | Supabase project `leadforge-prod`, table `leadforge_state`, row `ab7-solutions` |
| Dev database | Supabase project `leadforge-dev` (wired to Preview + Development env) |
| Env vars | Vercel → Settings → Environment Variables, scoped per environment. `SUPABASE_SECRET_KEY` marked *Sensitive*. |
| Backups | **Manual.** Supabase Free has none. See below. |

**Update workflow:** push to `main`; Vercel auto-deploys. Env var changes require a redeploy to take effect.

**Operational notes for agents:**
- `curl https://leads.ab7solutions.com/api/health` reports the live backend: `{"db":"supabase:leadforge_state/ab7-solutions","host":"…"}`. This is the authoritative "which DB am I on" check.
- Cold-start logs announce the backend too: `npx vercel logs <deployment-url> --json | grep "storage backend"`. Use `--json`; plain output truncates the line.
- Vercel **sensitive** env vars cannot be read back — `vercel env pull` writes them as empty strings. Don't conclude they're unset.
- Any destructive prod task must dump the row first: `npm run seed -- --check` shows counts; back up with a `GET /api/snapshot` to `backups/`.
- ⚠ **No security headers in prod.** The CSP lived only in nginx, which no longer exists. `index.html` has no CSP meta tag and `vercel.json` sets no `headers`. Porting the policy from `nginx.conf.example` into `vercel.json` is an open task — note that `index.html` uses inline `onclick=` attributes, so the policy needs `script-src 'unsafe-inline'` or the handlers must be rewired first.
- ⚠ **Backups are manual.** Supabase Free performs none. Either upgrade prod to Pro (daily + 7-day PITR) or cron a `pg_dump` / `GET /api/snapshot`.

## Project Layout
| Path | Purpose |
|------|---------|
| `index.html` | App shell (login, sidebar, topbar, drawer, modal, toasts). |
| `js/app.js` | All app logic. Namespaces under global `LF.*`. |
| `css/app.css` | All styles. Brand tokens at top (`--ab7-blue`, `--ab7-green`). Inter + JetBrains Mono. |
| `db-server.js` | **The** API server (Express + Supabase). The only backend. |
| `api/index.js` | Vercel serverless entry — one line, `require('../db-server.js')`. Add nothing else to `api/`. |
| `vercel.json` | Rewrites `/(.*)` → `/api`. |
| `docs-leadforge-supabase-setup.sql` | The schema. Run once per Supabase project. |
| `scripts/seed-supabase.js` | Seed/inspect the `leadforge_state` row. `npm run seed -- --check`. |
| `.env.example` | Every supported env var. Copy to `.env.local` (DEV project only). |
| `assets/` | Logos, images. |
| `backups/` | Gitignored. DB dumps — contain PII + password hashes. |
| `portal/` | ⚠ Stale duplicate of the whole app (incl. an old `server.js` + SQLite files). Unreferenced, unserved. Delete when convenient. |
| `Dockerfile` · `render.yaml` · `ecosystem.config.js` · `nginx.conf.example` · `ab7-leadforge.service` | Non-Vercel deploy configs. **None serve production.** |
| `QA-REPORT.md` | Last full QA pass — read before large refactors. |
| `SECURITY.md` | Auth model. ⚠ Its CSP/headers section describes nginx and is stale. |
| `DEPLOY.md` · `DEPLOYMENT.md` | ⚠ Both predate the Vercel + Supabase move. Treat as historical. |

## Key `LF.*` Namespaces (in `js/app.js`)
- `LF.state` — single source of truth (leads, threads, scheduledTasks, teamMembers, picklists, `revRange`, `pipelineView`, `pipelineScope`, `formulaName` / `formulaExpression` / `formulaPublished`, etc.). All persisted via `LF.storage.save()`.
- `LF.storage` — localStorage persistence + snapshot push/pull to `LF.db`.
- `LF.db` — server bridge (`/api/snapshot`, `/api/health`).
- `LF.sqlite` — browser sql.js (WebAssembly) fallback when API is unreachable.
- `LF.router` / `LF.views.*` — view per route (`dashboard`, `leads`, `pipeline`, `analytics`, `cdp`, `customization`, `settings`, …).
- `LF.rev.compute(range?)` — **single source of truth** for revenue metrics. `range` is `'30'` | `'90'` | `'ytd'` | empty (= all-time). Closed-deal metrics use `updatedAt` as close-date proxy; new-leads use `createdAt`. Open pipeline + slipping deals always reflect current state (no date filter). Dashboard, Revenue Intelligence, leaderboard all read from this — don't recompute pipeline numbers anywhere else.
- `LF.formula` — spreadsheet-like formula engine for the **Customization → Formula field** card. Tokenizer + recursive-descent parser + evaluator (no `eval` / `Function`). API: `LF.formula.evaluate(lead, expr?)`, `LF.formula.validate(expr)`, `LF.formula.compile(expr)` (cached), and the view-helper `LF.formula.healthClass(lead)` which returns `'hot' | 'warm' | 'cold'`. Default expression lives at `LF.formula.defaultExpression`.
  - **Fields:** `Score`, `Amount`, `DaysSinceLastTouch`, `DaysSinceCreated`, `Stage`, `Industry`, `Country`, `Source`, `Owner` (defined in `LF.formula.fields`).
  - **Functions:** `IF(cond,a,b)`, `AND(...)`, `OR(...)`, `NOT(x)`. **Operators:** `>= <= > < = == != <>`. Leading `=` is optional.
  - When `LF.state.formulaPublished` is false (or the formula returns anything other than `Hot/Warm/Cold`), `healthClass()` falls back to the legacy `score>=75/55` thresholds — existing views never break.
- `LF.taskList.collectAll()` — aggregates tasks from 5 sources (scheduledTasks, action plans, follow-ups, qualification nurture, agent HITL).
- `LF.picklists` — editable industries, countries, currencies (Customization → top 3 cards). Lead form reads from these, not from the `INDUSTRIES`/`CITIES` constants.
- `LF.permGate(moduleId, op)` — call before any view/edit action; respects `teamMembers[].permissions`.
- `LF.claude` — Claude API wrapper. Keys configured per-user in Settings → ✦ Claude AI.
- `LF.email` / `LF.mail` — Compose + relay (EmailJS / Zapier webhook / mailto fallback).

## Conventions
- **No build step.** Edits to `js/app.js` / `css/app.css` are live on reload. Don't introduce bundlers, TypeScript, or frameworks.
- **No inline JS/CSS in `index.html`.** CSP forbids it. Wire handlers via `onclick="LF.foo.bar()"` referencing already-loaded namespaces. Buttons that only carry `data-*` attributes will not respond — every interactive element needs an explicit `onclick`.
- **CSS variables only** — never hard-code brand colors. See `--ab7-*` tokens at top of `css/app.css`.
- **Single source of truth.** If a metric appears in two places, it must come from one function (usually `LF.rev.compute()`). Do not duplicate aggregation logic.
- **Persist via `LF.storage.save()`** after any `LF.state` mutation — this also pushes to the server snapshot if connected.
- **Picklists over constants.** New dropdowns for industry/country/currency must read `LF.picklists.industries() / .countries() / .currencies()`.
- **View filters persist on state.** Segmented controls (range, scope, view-mode) must store the choice on `LF.state.<viewName>Range/Scope/View`, then call `LF.router.go(view)` so the view re-renders with the new state. See the analytics 30D/90D/YTD buttons (`LF.rev.setRange`) and pipeline filters for canonical patterns.
- **Lead health / score-pill rendering must use `LF.formula.healthClass(lead)`** — never inline `lead.score>=75?'hot':lead.score>=55?'warm':'cold'`. The helper honours the user-defined formula in Customization → Formula field and falls back to the legacy thresholds when no formula is published. Currently wired in pipeline kanban, pipeline list, leads table, and CDP — keep new score-pill renders consistent.
- **Mobile-first.** Breakpoints at 480 / 640 / 900 / 1100 px already defined. Touch targets ≥ 44 px. Inputs ≥ 16 px to avoid iOS zoom.
- **Security headers.** Any new external origin (script, fetch, font) must be added to the CSP in the deployed nginx site (`/etc/nginx/sites-available/leads` on the prod box) AND in `nginx.conf.example` so dev/prod stay in sync. `index.html` itself has no CSP meta tag — the only CSP source is nginx.

## Layout Primitives
- `.grid.g-2` … `.g-5` — only **2 through 5** columns are defined in [css/app.css](css/app.css). Using `class="grid g-N"` with `N > 5` (e.g. `STAGES.length` = 7) collapses to a **single column** because no matching CSS rule exists.
- `.kanban` — stage-based board: `display:grid; grid-auto-flow:column; grid-auto-columns:minmax(240px,1fr)` inside `.kanban-wrap` (overflow-x:auto). Used by the Pipeline kanban.
- `.pipe-strip` — horizontal stage-summary chips: `display:flex; gap:8px; overflow-x:auto`. Use this whenever you need a row of N tiles where N is data-driven (e.g. one per stage). Each `.pipe-stage` carries an accent stripe (blue / green / red via `tone-open|won|lost`).

## File-Scoped Commands
| Task | Command |
|------|---------|
| JS syntax check | `node --check js/app.js` · `node --check db-server.js` |
| Start (dev Supabase) | `npm start` |
| Inspect the live row | `npm run seed -- --check` |
| Seed a row from a dump | `npm run seed -- backups/SEED-prod.json` (add `--force` to overwrite) |
| API server health (local) | `curl -fsS http://localhost:4000/api/health` |
| API server health (prod) | `curl -fsS https://leads.ab7solutions.com/api/health` |
| **Which DB is prod on?** | `curl -fsS https://leads.ab7solutions.com/api/health \| jq .db,.host` |
| Prod runtime logs | `npx vercel logs <deployment-url> --json \| grep "storage backend"` |
| Strip stray NUL padding (after large edits) | `python3 -c "import pathlib;p=pathlib.Path('js/app.js');p.write_bytes(p.read_bytes().rstrip(b'\\x00'))"` |
| **prod** — manual DB backup | `curl -fsS https://leads.ab7solutions.com/api/snapshot > backups/manual-$(date +%F-%H%M).json` |

## Common Pitfalls
- `js/app.js` is large (~500 KB). Edits via streaming tools sometimes leave trailing NUL bytes — always re-run `node --check` after edits and strip NULs if it errors.
- Don't move modules out of `LF.*` — global scope is the agreed contract.
- Removing a sidebar route requires updates in 3 places: the `<aside>` block in `index.html`, the route map (`LF.router`), and `LF.views.*`.
- `LF.state.chatHistory`, `LF.chat`, `ai-chat` panel were intentionally **removed** — do not re-add unless explicitly requested.
- **`.g-N` only handles 2–5 columns.** For variable column counts use a horizontal flex strip (`.pipe-strip`) or grid auto-flow (`.kanban`), not `class="grid g-${arr.length}"`.
- **`data-*`-only buttons are dead.** CSP forbids inline `<script>` listeners and there is no global delegation. Always add `onclick="LF.foo.bar(...)"`.
- **Never add a file under `api/`.** Vercel resolves real function files *before* `vercel.json` rewrites, so `api/health.js` silently shadows `db-server.js`'s `/api/health`. In July 2026 an abandoned Supabase migration dropped four files there; `/api/health` and `/api/snapshot` 500'd for six days while every browser fell back to localStorage and nobody noticed. `api/` holds exactly one file: `index.js`.
- **`data/leadforge.json` is NOT the database** — it's a gitignored local artifact with no meaning in prod. The database is a Supabase row. Anyone who tells you the JSON file is authoritative is reading a stale doc.
- **`backendRead()` throws; it never returns null-on-error.** `loadState()` treats `null` as "brand-new database", seeds an Admin, and writes that empty document back — so swallowing a transient read error would erase the entire workspace. `null` means "row genuinely absent", nothing else. Don't "helpfully" add a `catch { return null }`.
- **`loadSnapshot()` overwrites localStorage on boot** ([js/app.js](js/app.js)). `leads` / `scheduledTasks` / `teamMembers` are guarded by a `.length` check, but `subvendors` / `partners` / `jobApplicants` are guarded only by `Array.isArray` — an empty `[]` from the server wipes them client-side.
- **`/api/snapshot` POST is a whole-document upsert.** Last write wins; two concurrent editors silently clobber each other. Known, unfixed.
- **The publishable key fails silently.** RLS is on with no policies, so `sb_publishable_…` yields an empty workspace behind a green health check. `db-server.js` rejects it at boot — don't remove that guard.
- **`LF.sqlite` / sql.js in the frontend is a vestigial offline fallback.** Its "✓ Connected · SQLite file" console message is a lie inherited from a backend deleted in June 2026. It masked the six-day outage. Removing it is an open decision.

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: Claude <noreply@anthropic.com>
```

## References
- `README.md` — user-facing setup
- `DEPLOY.md` — current deployment guide (local, LAN, Render, Docker, Postgres scale-up)
- `DEPLOYMENT.md` — older long-form deploy guide (nginx, systemd, Render)
- `SECURITY.md` — threat model, headers, auth
- `QA-REPORT.md` — last full QA sweep, severity log
- `AB7_LeadForge360_Plan.docx` — original product plan
