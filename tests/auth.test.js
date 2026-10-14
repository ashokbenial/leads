/** LeadForge 360 — authentication & authorization tests. No network. */
const test = require('node:test');
const assert = require('node:assert');
const auth = require('../auth.js');

const GOOD = 'a'.repeat(64);
const withSecret = (v, fn) => { const p = process.env.APP_SECRET; process.env.APP_SECRET = v;
  try { return fn(); } finally { if (p === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = p; } };
const req = t => ({ get: h => (h.toLowerCase() === 'authorization' && t ? 'Bearer ' + t : '') });

/* -------------------------------------------------------------- passwords */
test('scrypt hash round-trips and rejects the wrong password', () => {
  const h = auth.hashPassword('S3cure!pass');
  assert.ok(h.startsWith('scrypt$'));
  assert.strictEqual(auth.verifyPassword('S3cure!pass', h).ok, true);
  assert.strictEqual(auth.verifyPassword('S3cure!pasS', h).ok, false);
});
test('scrypt hashes are salted — same password, different digests', () => {
  assert.notStrictEqual(auth.hashPassword('same'), auth.hashPassword('same'));
});
test('legacy DJB2 hash still verifies and is flagged for upgrade', () => {
  const legacy = auth.legacyHash('demo');
  const r = auth.verifyPassword('demo', legacy);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.legacy, true, 'must be flagged so the caller re-hashes');
});
test('legacy hash leaks password length — documented weakness', () => {
  assert.ok(auth.legacyHash('abcdef').endsWith('_6'));
  assert.ok(auth.legacyHash('abc').endsWith('_3'));
});
test('scrypt verification is not flagged legacy', () => {
  assert.strictEqual(auth.verifyPassword('x', auth.hashPassword('x')).legacy, false);
});
test('missing or unrecognised hash never authenticates', () => {
  assert.strictEqual(auth.verifyPassword('x', null).ok, false);
  assert.strictEqual(auth.verifyPassword('x', '').ok, false);
  assert.strictEqual(auth.verifyPassword('x', 'plaintext').ok, false);
  assert.strictEqual(auth.verifyPassword('x', 'md5$abc').ok, false);
});

/* ---------------------------------------------------------------- sessions */
test('issued token verifies and carries tenant, user and role', () => withSecret(GOOD, () => {
  const t = auth.issue({ userId: 'u1', tenantId: 'ab7-solutions', role: 'Admin', email: 'a@b.c' });
  const v = auth.verifyToken(t);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.tenantId, 'ab7-solutions');
  assert.strictEqual(v.actor.id, 'u1');
  assert.strictEqual(v.actor.role, 'Admin');
}));
test('SECURITY: a tampered payload is rejected', () => withSecret(GOOD, () => {
  const t = auth.issue({ userId: 'u1', tenantId: 'ab7-solutions', role: 'Viewer' });
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify(Object.assign(
    JSON.parse(Buffer.from(body, 'base64url').toString()), { role: 'Admin' }))).toString('base64url');
  const v = auth.verifyToken(forged + '.' + sig);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'bad_signature');
}));
test('SECURITY: a token signed with a different secret is rejected', () => {
  const t = withSecret('b'.repeat(64), () => auth.issue({ userId: 'u', tenantId: 't', role: 'Admin' }));
  withSecret(GOOD, () => assert.strictEqual(auth.verifyToken(t).ok, false));
});
test('SECURITY: an unsigned / malformed token is rejected', () => withSecret(GOOD, () => {
  assert.strictEqual(auth.verifyToken('not-a-token').reason, 'malformed_token');
  assert.strictEqual(auth.verifyToken('a.b.c').reason, 'malformed_token');
  assert.strictEqual(auth.verifyToken('').reason, 'missing_token');
}));
test('an expired token is rejected', () => withSecret(GOOD, () => {
  const t = auth.issue({ userId: 'u', tenantId: 't', role: 'Admin' }, -1);
  assert.strictEqual(auth.verifyToken(t).reason, 'expired');
}));
test('a token missing tenant or user claims is rejected', () => withSecret(GOOD, () => {
  assert.strictEqual(auth.verifyToken(auth.issue({ userId: 'u' })).reason, 'incomplete_claims');
  assert.strictEqual(auth.verifyToken(auth.issue({ tenantId: 't' })).reason, 'incomplete_claims');
}));
test('verify() reads only the Authorization header, never a role header', () => withSecret(GOOD, () => {
  const t = auth.issue({ userId: 'u', tenantId: 'ab7-solutions', role: 'Viewer' });
  const forgedReq = { get: h => h.toLowerCase() === 'authorization' ? 'Bearer ' + t
                              : h.toLowerCase() === 'x-lf-actor-role' ? 'Admin' : '' };
  assert.strictEqual(auth.verify(forgedReq).actor.role, 'Viewer', 'role comes from the signed token only');
}));

/* ------------------------------------------------------------ unconfigured */
test('without APP_SECRET the module reports unconfigured and issues nothing', () => withSecret('', () => {
  assert.strictEqual(auth.configured(), false);
  assert.strictEqual(auth.verifyToken('anything').configured, false);
  assert.throws(() => auth.issue({ userId: 'u', tenantId: 't' }), e => e.code === 'AUTH_NOT_CONFIGURED');
}));
test('a short APP_SECRET does not count as configured', () => withSecret('tooshort', () => {
  assert.strictEqual(auth.configured(), false);
}));
test('verify() on an unconfigured deployment never returns ok', () => withSecret('', () => {
  assert.strictEqual(auth.verify(req('x')).ok, false);
}));

/* ------------------------------------------------------------- permissions */
test('permission matrix: Admin may do everything defined', () => {
  Object.keys(auth.PERMISSIONS).forEach(p => assert.strictEqual(auth.can({ role: 'Admin' }, p), true, p));
});
test('permission matrix: Viewer may only read', () => {
  assert.strictEqual(auth.can({ role: 'Viewer' }, 'scoring.view'), true);
  assert.strictEqual(auth.can({ role: 'Viewer' }, 'scoring.history.view'), true);
  ['scoring.model.create', 'scoring.model.edit', 'scoring.model.activate', 'scoring.rules.edit',
   'scoring.recalculate', 'scoring.override', 'scoring.dryrun', 'scoring.audit.view']
    .forEach(p => assert.strictEqual(auth.can({ role: 'Viewer' }, p), false, p));
});
test('permission matrix: Manager may override and dry-run but not edit models', () => {
  assert.strictEqual(auth.can({ role: 'Manager' }, 'scoring.override'), true);
  assert.strictEqual(auth.can({ role: 'Manager' }, 'scoring.dryrun'), true);
  assert.strictEqual(auth.can({ role: 'Manager' }, 'scoring.model.edit'), false);
  assert.strictEqual(auth.can({ role: 'Manager' }, 'scoring.recalculate'), false);
});
test('permission matrix: AE/SDR may simulate but not recalculate', () => {
  assert.strictEqual(auth.can({ role: 'AE' }, 'scoring.simulate'), true);
  assert.strictEqual(auth.can({ role: 'SDR' }, 'scoring.simulate'), true);
  assert.strictEqual(auth.can({ role: 'AE' }, 'scoring.recalculate'), false);
});
test('an unknown permission is denied for everyone', () => {
  assert.strictEqual(auth.can({ role: 'Admin' }, 'scoring.nonexistent'), false);
});
test('an actor with no role is treated as Viewer', () => {
  assert.strictEqual(auth.can({}, 'scoring.view'), true);
  assert.strictEqual(auth.can({}, 'scoring.model.create'), false);
  assert.strictEqual(auth.can(null, 'scoring.model.create'), false);
});
test('an unknown role gets no privileges', () => {
  assert.strictEqual(auth.can({ role: 'Superuser' }, 'scoring.model.create'), false);
});

/* ------------------------------------------------- Phase M: hash migration */
test('hashScheme classifies stored credentials without leaking them', () => {
  assert.strictEqual(auth.hashScheme(auth.hashPassword('x')), 'scrypt');
  assert.strictEqual(auth.hashScheme(auth.legacyHash('x')), 'legacy');
  assert.strictEqual(auth.hashScheme(null), 'none');
  assert.strictEqual(auth.hashScheme('bcrypt$abc'), 'unknown');
});
test('needsRehash is true for everything except scrypt', () => {
  assert.strictEqual(auth.needsRehash(auth.hashPassword('x')), false);
  assert.strictEqual(auth.needsRehash(auth.legacyHash('x')), true);
  assert.strictEqual(auth.needsRehash(null), true);
});
test('migrationStatus reports counts and percentage, never hashes', () => {
  const st = auth.migrationStatus([
    { password_hash: auth.hashPassword('a') },
    { password_hash: auth.legacyHash('b') },
    { password_hash: auth.legacyHash('c') },
    { password_hash: null }
  ]);
  assert.strictEqual(st.total, 4);
  assert.strictEqual(st.scrypt, 1);
  assert.strictEqual(st.legacy, 2);
  assert.strictEqual(st.none, 1);
  assert.strictEqual(st.migrated, 25);
  assert.strictEqual(JSON.stringify(st).indexOf('scrypt$'), -1, 'no hash material in the report');
});
test('migrationStatus reads either row shape', () => {
  const st = auth.migrationStatus([{ credentials: { passwordHash: auth.hashPassword('a') } }]);
  assert.strictEqual(st.scrypt, 1);
});
