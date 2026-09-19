# Website → LeadForge lead capture

How the three ab7solutions.com buttons — **Apply for a Job**, **Register as Vendor**,
**Become Partner** — turn into leads inside LeadForge 360, and how to deploy it securely.

Every submission is forwarded from the website (`ab7solutions.com`, Next.js on Vercel)
to a **secured ingest endpoint** on the CRM (`leads.ab7solutions.com`, `db-server.js`).
Each type lands in its own module, so nothing is mixed together.

| Website button | Website form / route | CRM ingest endpoint | CRM module (sidebar) | Stored in |
|---|---|---|---|---|
| Register as Vendor | `/become-a-vendor` → `POST /api/vendor` | `POST /api/subvendors/ingest` | **Sub-Vendors** | `subvendors[]` |
| Become Partner | `/become-a-partner/apply` → `POST /api/partner` | `POST /api/partners/ingest` | **Partners** | `partners[]` |
| Apply for a Job | `/job-posting` (quick-apply form) → `POST /api/job` | `POST /api/jobs/ingest` | **Job Applicants** | `jobApplicants[]` |

The forwards are **fire-and-forget**: if the CRM is briefly unreachable, the visitor's
submission still succeeds (it's already saved in Supabase + emailed). Records also
round-trip through `GET/POST /api/snapshot`, so they appear for every signed-in user.

## 1. Security — one shared secret

All three ingest endpoints are protected by a single shared secret. The CRM server
reads it from `INGEST_TOKEN`; the website sends it on every forward.

Requests must present the token as **either** header:

```
Authorization: Bearer <token>
x-ab7-token: <token>
```

- If `INGEST_TOKEN` is **set**, requests without a matching token get **401**.
- The compare is constant-time (no timing leak).
- If `INGEST_TOKEN` is **unset**, the endpoints stay open (local dev only) and the
  server prints a warning on boot. **Always set it in production.**

Generate a strong token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Environment variables

### CRM server (`leads` repo — `db-server.js`)

| Var | Value |
|-----|-------|
| `INGEST_TOKEN` | the shared secret from step 1 |

On the prod VPS this goes in the pm2 env (`/opt/leads/ecosystem.config.js` → `env`)
or the service environment, then `pm2 restart leads`. The legacy name
`SUBVENDOR_INGEST_TOKEN` is still accepted as a fallback.

### Website (`ab7solutions.com` repo — `.env.local` + Vercel env)

| Var | Value |
|-----|-------|
| `LEADFORGE_INGEST_TOKEN` | **same** value as `INGEST_TOKEN` above |
| `LEADFORGE_VENDOR_WEBHOOK_URL` | `https://leads.ab7solutions.com/api/subvendors/ingest` |
| `LEADFORGE_PARTNER_WEBHOOK_URL` | `https://leads.ab7solutions.com/api/partners/ingest` |
| `LEADFORGE_JOB_WEBHOOK_URL` | `https://leads.ab7solutions.com/api/jobs/ingest` |

If a `*_WEBHOOK_URL` is unset, that forward is simply skipped (no error) — handy for
enabling one type at a time.

## 3. Endpoint contract

`POST` JSON. Success → `{ "ok": true, "id": "<recordId>" }`.
Duplicate within 60 s (same email) → `{ "ok": true, "id": "...", "deduped": true }`.
Missing name **and** email → `400`. Bad/missing token → `401`.

Payloads are tolerant: arrays may arrive as real arrays, JSON strings, or
comma-joined strings; snake_case and camelCase keys are both accepted.

Minimal examples:

```bash
# Partner
curl -X POST https://leads.ab7solutions.com/api/partners/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -d '{"full_name":"Jane Doe","email":"jane@ref.com","phone":"+91…","services_interested":["Recruitment"]}'

# Job applicant
curl -X POST https://leads.ab7solutions.com/api/jobs/ingest \
  -H "Content-Type: application/json" \
  -H "x-ab7-token: $INGEST_TOKEN" \
  -d '{"full_name":"John Seeker","email":"john@x.com","phone":"+91…","role_applied":"Medical Scribe"}'
```

## 4. Deploy checklist

1. **Generate** the token once (step 1).
2. **CRM:** set `INGEST_TOKEN`, `pm2 restart leads`, confirm boot log has no
   "UNAUTHENTICATED" warning. `git pull` first so `db-server.js`, `js/app.js` and
   `index.html` carry the Partners / Job Applicants modules.
3. **Website:** set the four env vars (Vercel → Project → Settings → Environment
   Variables), redeploy.
4. **Smoke test:** submit each of the three forms once; confirm a record appears
   under Sub-Vendors / Partners / Job Applicants in the CRM (hit **⟳ Refresh** if needed).

No new outbound origins are added to the CRM, so the nginx CSP needs no change.
The website→CRM call is server-to-server (Vercel route handler → CRM), not from the
browser, so no CORS change is required either.

## 5. Optional: Supabase table for job applicants

Vendor and partner submissions are already stored in Supabase
(`vendor_registrations`, `partner_applications`). The new `/api/job` route writes to a
`job_applications` table **best-effort** — if the table doesn't exist the lead is still
captured in the CRM + email. To also keep a Supabase copy, create a table with columns
matching the payload (`full_name, email, phone, whatsapp, role_applied,
experience_years, current_location, country, linkedin, portfolio, resume_link,
notice_period, expected_salary, cover_note, how_heard, source, ip_address,
user_agent`).
