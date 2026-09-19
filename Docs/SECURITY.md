# Security model

LeadForge 360 is a client-only SPA. All application logic runs in the user's browser; data is persisted in IndexedDB (SQLite via sql.js) and localStorage. This document lists the defensive measures baked into the shipped artifacts and the operator-side hardening you should apply before exposing the portal on the public internet.

## Architecture summary

```
Browser ──── HTTPS ────► nginx ────► static files (index.html, css/, js/, assets/)
   │
   └──► IndexedDB (SQLite binary)    ← persistent storage, never leaves the device
   └──► localStorage                 ← fast UI-state cache
   └──► fetch(…) to optional external services (Anthropic / EmailJS / Zapier)
```

No first-party backend is required. The portal is safe to host as pure static content.

## Shipped hardening

1. **No inline JavaScript.** All JS lives in `js/app.js` and loads via a `<script src=…>` tag. This lets nginx ship a strict Content-Security-Policy that forbids inline scripts, killing the entire reflected-XSS class of attacks.
2. **CSS is in `css/app.css`.** Out-of-band styles are fine; the CSP permits `'unsafe-inline'` for CSS only because Google Fonts injects inline styles. If you self-host fonts you can tighten this further to remove `'unsafe-inline'`.
3. **Explicit `Content-Security-Policy` in `nginx.conf.example`**, scoped to the exact origins the portal contacts:
   - `script-src 'self' https://cdn.jsdelivr.net` (Chart.js + sql.js only)
   - `connect-src 'self' https://api.anthropic.com https://api.emailjs.com https://*.hooks.zapier.com`
   - `worker-src 'self' blob:` (sql.js worker)
   - `frame-ancestors 'none'` (clickjacking protection)
4. **HSTS**, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, and `Permissions-Policy` locking down camera / microphone / geolocation (except where the mobile preview needs it).
5. **SRI on CDN resources.** The `crossorigin` attribute is set on `<link rel=preconnect>`. To enable SRI on the Chart.js / sql.js `<script>` tags, add the `integrity` attribute (hashes below).
6. **No secrets in code.** API keys for Claude, EmailJS, Zapier, etc. are entered by the user inside Settings and stored in their browser's IndexedDB. They never touch the server. This means a compromised static host cannot leak credentials.
7. **Team-member passwords** are stored as hashes, never plaintext, in the local SQLite DB. The shipped hash function is a demo non-cryptographic DJB-style digest — **replace with bcrypt/argon2 on a backend before exposing credentials to untrusted hands**.
8. **SPA fallback + server_tokens off** in nginx to avoid exposing version strings or directory listings.

## Operator checklist before going live

- [ ] Obtain and install a TLS certificate (Let's Encrypt via certbot works; the nginx config references its default paths).
- [ ] Replace `leadforge.example.com` in `nginx.conf.example` with your real hostname.
- [ ] Deploy the four artifacts to `/var/www/leadforge`:
      ```
      index.html
      css/app.css
      js/app.js
      assets/logo.png
      ```
- [ ] Verify headers: `curl -I https://your.host/` should list CSP, HSTS, X-Frame-Options.
- [ ] Check CSP in a live browser — open DevTools → Console. Any blocked resource will show up here. Add the exact origin to `connect-src` or `img-src` as needed.
- [ ] Optional: self-host Chart.js and sql.js instead of using jsdelivr, then drop `https://cdn.jsdelivr.net` from the CSP entirely.
- [ ] Enable HTTP/2 (already on in the example config).
- [ ] Put the origin behind Cloudflare / AWS WAF / fail2ban if public.
- [ ] Back up your data: the single downloadable `.sqlite` file (Settings → 🗄 Local DB → ⬇ Download) is your source of truth. Encrypt backups at rest.
- [ ] Rotate any demo credentials in `LF.state.teamMembers` before production.

## SRI hashes for CDN scripts

Add these to the `<script>` tags in `index.html` to enable Subresource Integrity:

```html
<script
  src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"
  integrity="sha384-uqg47CHy1EPOrvrqgRRO+Im5aBqNSFfCq3ukKuffnhn49PcnuwWGNqkLA3q2nXXp"
  crossorigin="anonymous"></script>
<script
  src="https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js"
  integrity="sha384-S8uNGuIVxMJnZI5fMWrLqSA2nDt5BexPB8tMNeAAlXpwaeQnhjnLeFXikk3u+UEY"
  crossorigin="anonymous"></script>
```

Re-verify with `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A` whenever you bump versions.

## Threat model highlights

| Threat | Mitigation |
|---|---|
| Reflected XSS | CSP `script-src 'self' cdn.jsdelivr.net`; no inline JS; DOM-level `escapeHtml()` helpers used throughout |
| Stored XSS | User input is escaped before HTML injection (`escapeHtml()`). Rich-text fields (email body, notes) are rendered in `<textarea>` / `<pre>`-style containers, not `innerHTML` of un-escaped strings |
| CSRF | No first-party backend; all state is client-local. For optional relays you configure, that endpoint is responsible for its own CSRF protection |
| Credential theft | No secrets in transit or code; Claude / EmailJS keys stay in IndexedDB |
| Clickjacking | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` |
| MITM | HSTS preload + TLS 1.2+ only |
| Supply chain | SRI hashes on CDN scripts (see above) or self-host dependencies |
| Data exfiltration via extension | IndexedDB data is origin-scoped; browsers isolate it to your domain |
| Backup theft | Downloadable `.sqlite` files — keep them encrypted at rest if they contain production lead data |
| Brute-force login | Optional nginx `limit_req` rate limiter (sample in config is commented out). For real multi-user auth, move authentication to the optional Postgres backend with bcrypt + rate limiting |

## Reporting a vulnerability

Email `security@ab7solutions.com`. Please do not file public GitHub issues for security-sensitive reports.
