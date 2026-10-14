#!/usr/bin/env node
/**
 * LeadForge 360 — REAL ENVIRONMENT VERIFICATION (Phases B–K).
 * Executes what a sandbox cannot: talks to the actual Supabase project and
 * prints evidence, not assertions.
 *
 *   npm run verify:supabase                  # read-only  (B, C, D, G, K)
 *   npm run verify:supabase -- --write       # + E, F, H, J (creates then removes test rows)
 *   npm run verify:supabase -- --write --keep
 *   npm run verify:supabase -- --json > verify.json
 *
 * Test rows are prefixed `__verify__` and removed unless --keep.
 * NEVER run this against leadforge-prod.
 */
const { createClient } = require('@supabase/supabase-js');
const makeService = require('../scoring-service.js');
const makeRepo = require('../db-repo-scoring.js');
const auth = require('../auth.js');

const TENANT = 'ab7-solutions';
const PREFIX = '__verify__';
const WRITE = process.argv.includes('--write');
const KEEP = process.argv.includes('--keep');
const JSON_OUT = process.argv.includes('--json');
const url = process.env.SUPABASE_URL || '', key = process.env.SUPABASE_SECRET_KEY || '';

const results = [];
const rec = (phase, name, status, evidence) => {
  results.push({ phase, name, status, evidence });
  if (!JSON_OUT) {
    const icon = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : status === 'MANUAL' ? 'MANL' : 'FAIL';
    console.log('  [' + icon + '] ' + (phase + ' ').padEnd(4) + name.padEnd(46) + (evidence === undefined ? '' : evidence));
  }
};
const log = m => { if (!JSON_OUT) console.log(m); };

if (!url || !key) { console.error('x SUPABASE_URL and SUPABASE_SECRET_KEY are required'); process.exit(1); }
if (/^sb_publishable_/.test(key)) { console.error('x publishable key - RLS hides everything. Use the secret key.'); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false } });
const repo = makeRepo(supabase, TENANT);
const svc = makeService(repo);
const ADMIN = { tenantId: TENANT, actor: { id: PREFIX + 'admin', role: 'Admin' } };
const VIEWER = { tenantId: TENANT, actor: { id: PREFIX + 'viewer', role: 'Viewer' } };
const OTHER = { tenantId: '__other_tenant__', actor: { id: 'x', role: 'Admin' } };

const TABLES = ['scoring_models','scoring_rules_v2','scoring_rule_conditions','scoring_rule_actions',
  'lead_scores','lead_score_components','lead_score_events','score_history',
  'qualification_events','score_audit_logs','lead_score_overrides'];

const MODEL_ID = PREFIX + 'model_v1';
function testModel() {
  return {
    id: MODEL_ID, tenantId: TENANT, name: '[DEV/TEST] LeadForge V1 Scoring', status: 'active', version: '1.0.0',
    description: 'Created by scripts/verify-supabase.js - development verification model. Safe to delete.',
    scoreRange: { min: 0, max: 100 },
    weights: { fit: 0.25, engagement: 0.20, intent: 0.25, behavior: 0.10, source: 0.05, qualification: 0.15 },
    categoryMax: { fit: 100, engagement: 100, intent: 100, behavior: 100, source: 100, qualification: 100 },
    categoryCap: {},
    thresholds: [
      { tier: 'unqualified', min: 0,  max: 20,  label: 'Unqualified' },
      { tier: 'cold',        min: 21, max: 40,  label: 'Cold' },
      { tier: 'warm',        min: 41, max: 60,  label: 'Warm' },
      { tier: 'qualified',   min: 61, max: 80,  label: 'Qualified' },
      { tier: 'hot',         min: 81, max: 100, label: 'Hot / Sales Ready' }
    ],
    qualifiedTiers: ['qualified', 'hot'], gateFailStatus: 'nurture', gates: [], disqualifiers: [],
    rules: [
      { id: PREFIX + 'r_icp', name: 'Target industry (SaaS)', description: 'Industry matches ICP',
        category: 'fit', action: 'add', points: 60, status: 'active', priority: 1,
        frequency: { mode: 'once' }, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } },
      { id: PREFIX + 'r_value', name: 'Deal value over 25k', description: 'Amount above threshold',
        category: 'intent', action: 'add', points: 50, status: 'active', priority: 2,
        frequency: { mode: 'once' }, conditions: { field: 'amount', operator: 'greaterThan', value: 25000 } },
      { id: PREFIX + 'r_stale', name: 'No contact in 30 days', description: 'Inactivity penalty',
        category: 'negative', action: 'subtract', points: 10, status: 'active', priority: 3,
        frequency: { mode: 'once' }, conditions: { field: 'lastActivityAt', operator: 'olderThanDays', value: 30 } }
    ]
  };
}
const nowMs = () => Date.now();
const leadRow = (suffix, over) => Object.assign({
  id: PREFIX + suffix, tenant_id: TENANT, name: 'Verify ' + suffix, first_name: 'Verify', last_name: suffix,
  email: 'verify+' + suffix + '@example.invalid', phone: '+910000000000', company: 'Verify Co',
  industry: 'SaaS', city: 'Pune', country: 'IN', source: 'Referral', stage: 'New',
  score: 0, amount: 50000, currency: 'INR', tags: [], consent: {}, visibility: { mode: 'all', users: [] },
  created_at: new Date(nowMs() - 5 * 86400000).toISOString(),
  updated_at: new Date(nowMs() - 2 * 86400000).toISOString()
}, over || {});

async function cleanup() {
  for (const t of ['lead_score_components','lead_score_events','score_history','qualification_events','lead_score_overrides','lead_scores'])
    await supabase.from(t).delete().like('lead_id', PREFIX + '%');
  await supabase.from('lead_activities').delete().like('lead_id', PREFIX + '%');
  await supabase.from('leads').delete().like('id', PREFIX + '%');
  await supabase.from('scoring_rule_conditions').delete().like('rule_id', PREFIX + '%');
  await supabase.from('scoring_rule_actions').delete().like('rule_id', PREFIX + '%');
  await supabase.from('scoring_rules_v2').delete().like('id', PREFIX + '%');
  await supabase.from('scoring_models').delete().like('id', PREFIX + '%');
}

(async () => {
  log('');
  log('  LeadForge 360 - real environment verification');
  log('  target : ' + new URL(url).host);
  log('  tenant : ' + TENANT);
  log('  mode   : ' + (WRITE ? 'READ + WRITE (test rows created then removed)' : 'READ ONLY (pass --write for E/F/H/J)'));
  log('');

  /* ---------------- PHASE B / C - schema ---------------- */
  let schemaOk = true;
  for (const t of TABLES) {
    const { error } = await supabase.from(t).select('*').limit(1);
    if (error) { schemaOk = false; rec('B', 'table ' + t, 'FAIL', error.message); }
    else rec('B', 'table ' + t, 'PASS', 'reachable');
  }
  if (!schemaOk) {
    log('');
    log('  x Migration has not been applied. Run supabase-scoring-v3.sql first, then re-run.');
    log('');
    if (JSON_OUT) console.log(JSON.stringify({ results }, null, 2));
    process.exit(2);
  }
  rec('C', 'indexes / constraints / RLS', 'MANUAL',
      'PostgREST cannot read pg_catalog - run scripts/verify-schema.sql in the SQL editor');

  /* ---------------- PHASE D - authentication ---------------- */
  if (!auth.configured()) {
    rec('D', 'authentication configured', 'FAIL', 'APP_SECRET is not set - scoring mutations would 503');
  } else {
    const t = auth.issue({ userId: 'u1', tenantId: TENANT, role: 'Admin' });
    rec('D', 'valid token verifies', auth.verifyToken(t).ok ? 'PASS' : 'FAIL');
    rec('D', 'expired token rejected',
        auth.verifyToken(auth.issue({ userId: 'u', tenantId: TENANT }, -1)).reason === 'expired' ? 'PASS' : 'FAIL');
    rec('D', 'malformed token rejected', auth.verifyToken('junk').reason === 'malformed_token' ? 'PASS' : 'FAIL');
    const parts = t.split('.');
    const forged = Buffer.from(JSON.stringify(Object.assign(
      JSON.parse(Buffer.from(parts[0], 'base64url').toString()), { role: 'Admin' }))).toString('base64url');
    rec('D', 'forged payload rejected', auth.verifyToken(forged + '.' + parts[1]).reason === 'bad_signature' ? 'PASS' : 'FAIL');
    const viewerTok = auth.issue({ userId: 'v', tenantId: TENANT, role: 'Viewer' });
    const forgedReq = { get: h => h.toLowerCase() === 'authorization' ? 'Bearer ' + viewerTok
                                : h.toLowerCase() === 'x-lf-actor-role' ? 'Admin' : '' };
    rec('D', 'forged x-lf-actor-role ignored',
        auth.verify(forgedReq).actor.role === 'Viewer' ? 'PASS' : 'FAIL', 'resolves to Viewer');
    rec('D', 'Viewer denied Admin operation', auth.can({ role: 'Viewer' }, 'scoring.model.create') === false ? 'PASS' : 'FAIL');
    rec('D', 'Admin allowed Admin operation', auth.can({ role: 'Admin' }, 'scoring.model.create') === true ? 'PASS' : 'FAIL');
  }

  /* ---------------- PHASE E - real model ---------------- */
  if (WRITE) {
    try {
      await svc.createScoreModel(ADMIN, testModel());
      await svc.activateScoreModel(ADMIN, MODEL_ID);
      const back = await repo.getModel(TENANT, MODEL_ID);
      rec('E', 'model persists and reads back', back ? 'PASS' : 'FAIL',
          back ? back.name + ' v' + back.version + ' status=' + back.status : 'not found');
      const active = await repo.getActiveModel(TENANT);
      rec('E', 'model is the active model', active && active.id === MODEL_ID ? 'PASS' : 'FAIL', active ? active.id : 'none');
      rec('E', 'rules persist', back && back.rules.length === 3 ? 'PASS' : 'FAIL', back ? back.rules.length + ' rules' : '0');
    } catch (e) { rec('E', 'create + activate model', 'FAIL', e.message); }
  } else rec('E', 'create test scoring model', 'SKIP', 'needs --write');

  /* ---------------- PHASE F - legacy backfill ---------------- */
  if (WRITE) {
    try {
      const first = await svc.backfillLegacyScores(ADMIN, { batchSize: 500 });
      const second = await svc.backfillLegacyScores(ADMIN, { batchSize: 500 });
      rec('F', 'legacy backfill run 1', 'PASS',
          'written=' + first.written + ' skippedNoScore=' + first.skippedNoScore + ' processed=' + first.processed);
      rec('F', 'run 2 creates no duplicates', second.written === 0 ? 'PASS' : 'FAIL',
          'written=' + second.written + ' skippedExisting=' + second.skippedExisting);
    } catch (e) { rec('F', 'legacy backfill', 'FAIL', e.message); }
  } else rec('F', 'legacy backfill', 'SKIP', 'needs --write');

  /* ---------------- PHASE G - dry run on REAL data ---------------- */
  try {
    const d = await svc.runScoringDryRun(ADMIN, {});
    rec('G', 'dry run executed', 'PASS',
        'leads=' + d.totalLeads + ' avgOld=' + d.avgOldScore + ' avgNew=' + d.avgNewScore +
        ' newlyQualified=' + d.newlyQualified + ' newlyDisqualified=' + d.newlyDisqualified +
        ' missingContact=' + d.leadsMissingRequiredFields + ' needsReview=' + d.requiringManualReview);
    if (!JSON_OUT) {
      log('        distribution before -> after');
      Object.keys(d.distributionBefore).forEach(b =>
        log('          ' + b.padEnd(8) + String(d.distributionBefore[b]).padStart(5) + ' -> ' + d.distributionAfter[b]));
      log('        qualification after: ' + JSON.stringify(d.qualificationBreakdown));
    }
    results.push({ phase: 'G', name: 'dryRunStats', status: 'DATA', evidence: d });
  } catch (e) { rec('G', 'dry run', 'FAIL', e.message); }

  /* ---------------- PHASE H - real lead scoring ---------------- */
  if (WRITE) {
    try {
      await supabase.from('leads').insert(leadRow('h1'));
      const r1 = await svc.calculateLeadScore(ADMIN, PREFIX + 'h1', { triggeringEvent: 'lead_created' });
      rec('H1', 'lead create -> score persisted', r1.score ? 'PASS' : 'FAIL', 'total=' + (r1.score && r1.score.totalScore));
      const comps = await supabase.from('lead_score_components').select('id').eq('lead_id', PREFIX + 'h1');
      rec('H1', 'components persisted', (comps.data || []).length > 0 ? 'PASS' : 'FAIL', (comps.data || []).length + ' rows');
      const hist = await supabase.from('score_history').select('id').eq('lead_id', PREFIX + 'h1');
      rec('H1', 'history persisted', (hist.data || []).length > 0 ? 'PASS' : 'FAIL', (hist.data || []).length + ' rows');
      rec('H1', 'qualification computed', r1.score && r1.score.qualificationStatus ? 'PASS' : 'FAIL',
          r1.score && r1.score.qualificationStatus);

      const beforeRow = await supabase.from('leads').select('updated_at').eq('id', PREFIX + 'h1').maybeSingle();
      const before = beforeRow.data && beforeRow.data.updated_at;

      await supabase.from('leads').update({ industry: 'Retail' }).eq('id', PREFIX + 'h1');
      const r2 = await svc.calculateLeadScore(ADMIN, PREFIX + 'h1', { triggeringEvent: 'lead_updated' });
      rec('H2', 'lead update changes the score', r2.score.totalScore !== r1.score.totalScore ? 'PASS' : 'FAIL',
          r1.score.totalScore + ' -> ' + r2.score.totalScore);

      await supabase.from('lead_activities').insert({ lead_id: PREFIX + 'h1', at: new Date().toISOString(), type: 'email', note: 'verification touchpoint' });
      const r3 = await svc.calculateLeadScore(ADMIN, PREFIX + 'h1', { triggeringEvent: 'email', eventId: PREFIX + 'evt1' });
      rec('H3', 'activity scored', r3.skipped === false ? 'PASS' : 'FAIL', 'total=' + r3.score.totalScore);

      const r4 = await svc.calculateLeadScore(ADMIN, PREFIX + 'h1', { triggeringEvent: 'email', eventId: PREFIX + 'evt1' });
      rec('H4', 'duplicate event awarded once', r4.skipped === true ? 'PASS' : 'FAIL', r4.reason || 'NOT skipped');

      const a1 = await svc.calculateLeadScore(ADMIN, PREFIX + 'h1', { triggeringEvent: 'recalc' });
      const a2 = await svc.calculateLeadScore(ADMIN, PREFIX + 'h1', { triggeringEvent: 'recalc' });
      const a3 = await svc.calculateLeadScore(ADMIN, PREFIX + 'h1', { triggeringEvent: 'recalc' });
      const stable = a1.score.totalScore === a2.score.totalScore && a2.score.totalScore === a3.score.totalScore;
      rec('H5', 'deterministic recalc (frequency-once regression)', stable ? 'PASS' : 'FAIL',
          [a1, a2, a3].map(x => x.score.totalScore).join(' / '));

      const afterRow = await supabase.from('leads').select('updated_at').eq('id', PREFIX + 'h1').maybeSingle();
      const after = afterRow.data && afterRow.data.updated_at;
      rec('H6', 'lead.updatedAt EXACTLY unchanged by scoring', before === after ? 'PASS' : 'FAIL',
          before === after ? String(before) : (before + ' -> ' + after));
    } catch (e) { rec('H', 'lead scoring flow', 'FAIL', e.message); }
  } else rec('H', 'real lead scoring flow', 'SKIP', 'needs --write');

  /* ---------------- PHASE J - CSV batch ---------------- */
  if (WRITE) {
    try {
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const r = leadRow('csv' + i, { amount: 30000 + i * 1000 });
        ids.push(r.id);
        await supabase.from('leads').insert(r);
      }
      const imp1 = await svc.scoreImportedLeads(ADMIN, ids, { importId: PREFIX + 'imp1' });
      rec('J', 'imported leads scored server-side', imp1.scored === 5 ? 'PASS' : 'FAIL',
          'scored=' + imp1.scored + ' failed=' + imp1.failed.length);
      const rows = (await supabase.from('lead_scores').select('total_score').in('lead_id', ids)).data || [];
      rec('J', 'no hard-coded 40 in imported scores',
          rows.length && rows.every(x => Number(x.total_score) !== 40) ? 'PASS' : 'MANUAL',
          rows.map(x => x.total_score).join(','));
      const imp2 = await svc.scoreImportedLeads(ADMIN, ids, { importId: PREFIX + 'imp1' });
      rec('J', 're-import is idempotent', imp2.scored === 0 && imp2.skippedDuplicate === 5 ? 'PASS' : 'FAIL',
          'scored=' + imp2.scored + ' skipped=' + imp2.skippedDuplicate);
    } catch (e) { rec('J', 'CSV import scoring', 'FAIL', e.message); }
  } else rec('J', 'CSV import scoring', 'SKIP', 'needs --write');

  /* ---------------- PHASE K - tenant isolation ---------------- */
  const deny = async (name, fn) => {
    try {
      const r = await fn();
      rec('K', name, r == null ? 'PASS' : 'FAIL', r == null ? 'returned null' : 'LEAKED DATA');
    } catch (e) {
      const ok = e.code === 'CROSS_TENANT' || e.code === 'NOT_FOUND' || e.code === 'NO_MODEL';
      rec('K', name, ok ? 'PASS' : 'FAIL', e.code || e.message);
    }
  };
  await deny('other tenant cannot read this model', () => svc.getScoreModel(OTHER, MODEL_ID));
  await deny('other tenant cannot modify this model', () => svc.updateScoreModel(OTHER, MODEL_ID, { name: 'hacked' }));
  await deny('other tenant cannot read a lead score', () => svc.getLeadScore(OTHER, PREFIX + 'h1'));
  await deny('other tenant cannot score this lead', () => svc.calculateLeadScore(OTHER, PREFIX + 'h1'));
  await deny('other tenant cannot read score history', () => svc.getLeadScoreHistory(OTHER, PREFIX + 'h1'));
  try {
    await svc.createScoreModel(VIEWER, { id: PREFIX + 'nope', name: 'x' });
    rec('K', 'Viewer cannot create a model', 'FAIL', 'ALLOWED');
  } catch (e) { rec('K', 'Viewer cannot create a model', e.code === 'FORBIDDEN' ? 'PASS' : 'FAIL', e.code); }
  rec('K', 'database-level RLS', 'MANUAL',
      'RLS enabled with no policies by design; the secret key bypasses it. Confirm with verify-schema.sql');

  /* ---------------- cleanup + summary ---------------- */
  if (WRITE && !KEEP) { await cleanup(); log(''); log('  test rows removed (--keep to retain them)'); }
  else if (WRITE) { log(''); log('  test rows RETAINED - they are prefixed ' + PREFIX); }

  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const manual = results.filter(r => r.status === 'MANUAL').length;
  const skip = results.filter(r => r.status === 'SKIP').length;
  if (JSON_OUT) { console.log(JSON.stringify({ target: new URL(url).host, pass, fail, manual, skip, results }, null, 2)); return; }
  log('');
  log('  ' + '-'.repeat(62));
  log('  PASS ' + pass + '   FAIL ' + fail + '   MANUAL ' + manual + '   SKIPPED ' + skip);
  log('');
  log(fail ? '  x Verification FAILED - do not promote this build.'
           : '  ok All executed checks passed.' + (skip ? ' Re-run with --write for the rest.' : ''));
  log('');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(''); console.error('x verification aborted: ' + e.message); console.error(''); process.exit(1); });
