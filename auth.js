/**
 * LeadForge 360 — server-side authentication & authorization.
 * ==========================================================
 * Replaces the header-trusted actor (`x-lf-actor-role`), which was never a
 * security boundary: any caller could set it.
 *
 * DESIGN — deliberately additive and fail-closed:
 *   • Enabled only when APP_SECRET is set. Without it, `verify()` reports
 *     `configured:false` and privileged operations are REFUSED (they are not
 *     silently allowed, and header values are never trusted again).
 *   • Sessions are HMAC-SHA256 signed, carry tenant + role + expiry, and are
 *     verified in constant time. Nothing in the token is trusted unsigned.
 *   • Passwords use Node's built-in scrypt. The legacy non-cryptographic hash
 *     (`sh1_<hex>_<len>`, a DJB2 variant with the plaintext LENGTH appended) is
 *     still *verifiable* so nobody is locked out, and is transparently upgraded
 *     to scrypt on the next successful login.
 *
 * ⚠ The legacy hash is brute-forceable offline. Existing stored hashes remain
 *   weak until each user logs in once and is migrated. That is a property of the
 *   stored data, not of this module.
 */
const crypto = require('crypto');

// Read lazily, not at module load: serverless cold starts and tests both need
// the current value of the environment, not the one captured at require time.
function secret() { return (process.env.APP_SECRET || '').trim(); }
function sessionHours() { return Number(process.env.SESSION_HOURS || 12); }
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const ROLE_RANK = { Viewer: 0, SDR: 1, AE: 1, Manager: 2, Admin: 3 };

// Every privileged scoring operation and the minimum role it needs.
const PERMISSIONS = {
  'scoring.view':            'Viewer',
  'scoring.history.view':    'Viewer',
  'scoring.audit.view':      'Manager',
  'scoring.model.create':    'Admin',
  'scoring.model.edit':      'Admin',
  'scoring.model.activate':  'Admin',
  'scoring.rules.edit':      'Admin',
  'scoring.recalculate':     'Admin',
  'scoring.override':        'Manager',
  'scoring.simulate':        'SDR',
  'scoring.dryrun':          'Manager'
};

function configured() { return secret().length >= 16; }
function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function safeEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  try { return crypto.timingSafeEqual(A, B); } catch (e) { return false; }
}

// ------------------------------------------------------------- passwords
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return 'scrypt$' + b64u(salt) + '$' + b64u(dk);
}
/** Legacy DJB2 hash — verify only, never issue. */
function legacyHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return 'sh1_' + ((h >>> 0).toString(16)).padStart(8, '0') + '_' + s.length;
}
function verifyPassword(plain, stored) {
  if (!stored) return { ok: false, legacy: false };
  if (stored.indexOf('scrypt$') === 0) {
    const [, saltB64, dkB64] = stored.split('$');
    try {
      const dk = crypto.scryptSync(String(plain), Buffer.from(saltB64, 'base64url'),
        SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
      return { ok: safeEq(b64u(dk), dkB64), legacy: false };
    } catch (e) { return { ok: false, legacy: false }; }
  }
  if (stored.indexOf('sh1_') === 0) return { ok: safeEq(legacyHash(String(plain)), stored), legacy: true };
  return { ok: false, legacy: false };
}

// -------------------------------------------------------------- sessions
function issue(payload, hours) {
  if (!configured()) { const e = new Error('APP_SECRET is not configured'); e.code = 'AUTH_NOT_CONFIGURED'; throw e; }
  const body = Object.assign({}, payload, {
    iat: Date.now(),
    exp: Date.now() + (hours || sessionHours()) * 3600000
  });
  const b = b64u(JSON.stringify(body));
  const sig = b64u(crypto.createHmac('sha256', secret()).update(b).digest());
  return b + '.' + sig;
}

/** Verify a bearer token. Returns {configured, ok, actor?, reason?}. */
function verifyToken(token) {
  if (!configured()) return { configured: false, ok: false, reason: 'auth_not_configured' };
  if (!token) return { configured: true, ok: false, reason: 'missing_token' };
  const parts = String(token).split('.');
  if (parts.length !== 2) return { configured: true, ok: false, reason: 'malformed_token' };
  const expect = b64u(crypto.createHmac('sha256', secret()).update(parts[0]).digest());
  if (!safeEq(parts[1], expect)) return { configured: true, ok: false, reason: 'bad_signature' };
  let body;
  try { body = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch (e) { return { configured: true, ok: false, reason: 'malformed_payload' }; }
  if (!body.exp || Date.now() > body.exp) return { configured: true, ok: false, reason: 'expired' };
  if (!body.tenantId || !body.userId) return { configured: true, ok: false, reason: 'incomplete_claims' };
  return { configured: true, ok: true,
           actor: { id: body.userId, role: body.role || 'Viewer', email: body.email || null },
           tenantId: body.tenantId };
}

/** Extract and verify from an Express request. Headers are NEVER trusted. */
function verify(req) {
  const raw = (req.get && (req.get('authorization') || '')) || '';
  return verifyToken(raw.replace(/^Bearer\s+/i, '').trim());
}

function can(actor, permission) {
  const need = PERMISSIONS[permission];
  if (!need) return false;
  return (ROLE_RANK[(actor && actor.role) || 'Viewer'] || 0) >= ROLE_RANK[need];
}

/** Which hashing scheme a stored credential uses. No secret material returned. */
function hashScheme(stored) {
  if (!stored) return 'none';
  if (String(stored).indexOf('scrypt$') === 0) return 'scrypt';
  if (String(stored).indexOf('sh1_') === 0) return 'legacy';
  return 'unknown';
}
function needsRehash(stored) { return hashScheme(stored) !== 'scrypt'; }

/**
 * Migration status across a set of member rows. Counts only — never returns a
 * hash, an email or any other credential material.
 */
function migrationStatus(members) {
  const out = { total: 0, scrypt: 0, legacy: 0, none: 0, unknown: 0 };
  (members || []).forEach(function (m) {
    out.total++;
    out[hashScheme(m && (m.password_hash || (m.credentials || {}).passwordHash))]++;
  });
  out.migrated = out.total ? +(out.scrypt / out.total * 100).toFixed(1) : 0;
  return out;
}

module.exports = {
  hashScheme, needsRehash, migrationStatus,
  PERMISSIONS, ROLE_RANK, sessionHours,
  get SESSION_HOURS() { return sessionHours(); },
  configured, hashPassword, verifyPassword, legacyHash,
  issue, verifyToken, verify, can
};
