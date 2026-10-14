/**
 * LeadForge 360 — simulator, rule-impact preview, legacy backfill, CSV scoring,
 * and failure handling. In-memory repository; no network.
 */
const test = require('node:test');
const assert = require('node:assert');
const engine = require('../scoring-engine.js');
const makeService = require('../scoring-service.js');

const NOW = Date.parse('2026-09-08T12:00:00Z'), DAY = 86400000;
const T1 = 'ab7-solutions';
const ADMIN = { id: 'u1', role: 'Admin' }, MANAGER = { id: 'u2', role: 'Manager' },
      AE = { id: 'u3', role: 'AE' }, VIEWER = { id: 'u4', role: 'Viewer' };
const ctx = (actor = ADMIN, tenantId = T1) => ({ tenantId, actor });

function makeRepo(opts = {}) {
  const db = { leads: [], models: [], scores: [], components: [], events: [],
               history: [], qualEvents: [], audits: [], overrides: [] };
  const T = (t, r) => r.tenantId === t;
  const boom = name => { if (opts.failOn === name) throw new Error('simulated database failure: ' + name); };
  return { db,
    async getLead(t, id) { boom('getLead'); return db.leads.find(l => l.id === id) || null; },
    async listLeads(t, f) { boom('listLeads'); return db.leads.filter(l => T(t, l)).slice(f.offset || 0, (f.offset || 0) + (f.limit || 1000)); },
    async getActiveModel(t) { return db.models.find(m => T(t, m) && m.status === 'active') || null; },
    async getModel(t, id) { return db.models.find(m => m.id === id) || null; },
    async saveModel(t, m) { const i = db.models.findIndex(x => x.id === m.id); i >= 0 ? db.models[i] = m : db.models.push(m); },
    async setModelStatus(t, id, s) { const m = db.models.find(x => x.id === id); if (m) m.status = s; },
    async getLeadScore(t, l, m) { return db.scores.find(s => s.leadId === l && s.scoringModelId === m && T(t, s)) || null; },
    async saveLeadScore(t, r) { boom('saveLeadScore'); const i = db.scores.findIndex(s => s.leadId === r.leadId && s.scoringModelId === r.scoringModelId);
                                i >= 0 ? db.scores[i] = r : db.scores.push(r); },
    async replaceComponents(t, l, m, rows) { boom('replaceComponents');
      for (let i = db.components.length - 1; i >= 0; i--) if (db.components[i].leadId === l) db.components.splice(i, 1);
      rows.forEach(r => db.components.push(r)); },
    async hasScoreEvent(t, id) { return db.events.some(e => e.eventId === id && T(t, e)); },
    async appendScoreEvent(t, r) { db.events.push(r); },
    async appendHistory(t, r) { boom('appendHistory'); db.history.push(r); },
    async listHistory(t, l, n) { return db.history.filter(h => h.leadId === l).slice(-n).reverse(); },
    async hasLegacySnapshot(t, l) { return db.history.some(h => h.leadId === l && h.legacy && T(t, h)); },
    async appendQualificationEvent(t, r) { db.qualEvents.push(r); },
    async appendAudit(t, r) { db.audits.push(r); },
    async listPriorEvents() { return []; },
    async getActiveOverride(t, l) { return db.overrides.filter(o => o.leadId === l && o.active).slice(-1)[0] || null; },
    async saveOverride(t, r) { db.overrides.forEach(o => { if (o.leadId === r.leadId) o.active = false; }); db.overrides.push(r); }
  };
}
const RULE = { id: 'r-icp', name: 'Target industry', description: 'Industry matches ICP', category: 'fit',
  action: 'add', points: 70, status: 'active', priority: 1, frequency: { mode: 'once' },
  conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } };
function model(over = {}) {
  return Object.assign(engine.defaultModel(), { id: 'm1', tenantId: T1, name: 'V1', version: '1.0.0', status: 'active',
    weights: { fit: 1, engagement: 0, intent: 0, behavior: 0, source: 0, qualification: 0 }, rules: [RULE] }, over);
}
function lead(o = {}) {
  return Object.assign({ id: 'l1', tenantId: T1, name: 'Rahul', email: 'r@n.com', phone: '+91 900',
    industry: 'SaaS', country: 'IN', source: 'Referral', stage: 'New', score: 0, amount: 50000,
    tags: [], activities: [], createdAt: NOW - 5 * DAY, updatedAt: NOW - 2 * DAY }, o);
}
function setup(modelOver = {}, leads = [lead()], repoOpts = {}) {
  const repo = makeRepo(repoOpts);
  repo.db.models.push(model(modelOver));
  leads.forEach(l => repo.db.leads.push(l));
  return { repo, svc: makeService(repo, { now: () => NOW }) };
}

/* ------------------------------------------------------------- simulator */
test('simulator projects a score without persisting anything', async () => {
  const { repo, svc } = setup({}, [lead({ industry: 'Retail' })]);
  const s = await svc.simulateLeadScore(ctx(AE), 'l1', { overrides: { industry: 'SaaS' } });
  assert.strictEqual(s.persisted, false);
  assert.strictEqual(s.baselineScore, 0);
  assert.strictEqual(s.projectedScore, 70);
  assert.strictEqual(s.delta, 70);
  assert.strictEqual(repo.db.scores.length, 0);
  assert.strictEqual(repo.db.history.length, 0);
  assert.strictEqual(repo.db.events.length, 0);
});
test('simulator does not mutate the lead', async () => {
  const { repo, svc } = setup({}, [lead({ industry: 'Retail' })]);
  const snap = JSON.stringify(repo.db.leads[0]);
  await svc.simulateLeadScore(ctx(AE), 'l1', { overrides: { industry: 'SaaS', amount: 999999 } });
  assert.strictEqual(JSON.stringify(repo.db.leads[0]), snap);
});
test('simulator reports gained and lost rules', async () => {
  const { svc } = setup({}, [lead({ industry: 'Retail' })]);
  const up = await svc.simulateLeadScore(ctx(AE), 'l1', { overrides: { industry: 'SaaS' } });
  assert.deepStrictEqual(up.gainedRules, ['r-icp']);
  const { svc: svc2 } = setup();
  const down = await svc2.simulateLeadScore(ctx(AE), 'l1', { overrides: { industry: 'Retail' } });
  assert.deepStrictEqual(down.lostRules, ['r-icp']);
});
test('simulator projects the qualification change too', async () => {
  const { svc } = setup({}, [lead({ industry: 'Retail' })]);
  const s = await svc.simulateLeadScore(ctx(AE), 'l1', { overrides: { industry: 'SaaS' } });
  assert.strictEqual(s.baselineQualification.tier, 'unqualified');
  assert.strictEqual(s.projectedQualification.tier, 'qualified');
});
test('simulator compares against the stored score when one exists', async () => {
  const { svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  const s = await svc.simulateLeadScore(ctx(AE), 'l1', { overrides: {} });
  assert.strictEqual(s.storedScore, 70);
});
test('RBAC: Viewer may not run the simulator', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.simulateLeadScore(ctx(VIEWER), 'l1', {}), e => e.code === 'FORBIDDEN');
});

/* ------------------------------------------------------- rule impact preview */
test('rule impact preview counts affected leads from real data', async () => {
  const leads = [lead({ id: 'a', industry: 'SaaS' }), lead({ id: 'b', industry: 'SaaS' }), lead({ id: 'c', industry: 'Retail' })];
  const { svc } = setup({ rules: [] }, leads);
  const imp = await svc.previewRuleImpact(ctx(MANAGER), { rule: RULE });
  assert.strictEqual(imp.dataAvailable, true);
  assert.strictEqual(imp.sampled, 3);
  assert.strictEqual(imp.affectedLeads, 2);
  assert.strictEqual(imp.averageScoreChange, 70);
  assert.strictEqual(imp.highImpact, 2);
  assert.strictEqual(imp.committed, false);
});
test('rule impact preview reports qualification movement', async () => {
  const { svc } = setup({ rules: [] }, [lead({ id: 'a' }), lead({ id: 'b' })]);
  const imp = await svc.previewRuleImpact(ctx(MANAGER), { rule: Object.assign({}, RULE, { points: 95 }) });
  assert.strictEqual(imp.newlyHot, 2);
  assert.strictEqual(imp.qualificationBefore.unqualified, 2);
  assert.strictEqual(imp.qualificationAfter.hot, 2);
});
test('rule impact preview reports disqualification movement', async () => {
  const { svc } = setup({ rules: [], disqualifiers: [] }, [lead({ id: 'a', tags: ['competitor'] })]);
  const imp = await svc.previewRuleImpact(ctx(MANAGER), { rule: RULE });
  assert.strictEqual(imp.newlyDisqualified, 0);
});
test('rule impact preview says so truthfully when there is no data', async () => {
  const { svc } = setup({ rules: [] }, []);
  const imp = await svc.previewRuleImpact(ctx(MANAGER), { rule: RULE });
  assert.strictEqual(imp.dataAvailable, false);
  assert.strictEqual(imp.sampled, 0);
  assert.ok(/No leads available/.test(imp.message), 'must not fabricate an estimate');
});
test('rule impact preview rejects an invalid candidate rule', async () => {
  const { svc } = setup({ rules: [] });
  await assert.rejects(() => svc.previewRuleImpact(ctx(MANAGER),
    { rule: Object.assign({}, RULE, { conditions: { field: 'nope', operator: 'equals', value: 1 } }) }),
    e => e.code === 'INVALID_RULE');
});
test('rule impact preview requires a candidate rule', async () => {
  const { svc } = setup({ rules: [] });
  await assert.rejects(() => svc.previewRuleImpact(ctx(MANAGER), {}), e => e.code === 'BAD_REQUEST');
});
test('RBAC: AE may not preview rule impact', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.previewRuleImpact(ctx(AE), { rule: RULE }), e => e.code === 'FORBIDDEN');
});

/* ---------------------------------------------------------- legacy backfill */
test('legacy backfill snapshots existing scores as legacy history', async () => {
  const { repo, svc } = setup({}, [lead({ id: 'a', score: 62 }), lead({ id: 'b', score: 41 })]);
  const r = await svc.backfillLegacyScores(ctx(ADMIN), {});
  assert.strictEqual(r.written, 2);
  assert.strictEqual(repo.db.history.length, 2);
  assert.strictEqual(repo.db.history[0].legacy, true);
  assert.strictEqual(repo.db.history[0].modelVersion, 'legacy');
  assert.strictEqual(repo.db.history[0].totalScore, 62);
});
test('legacy backfill is idempotent — re-running writes nothing new', async () => {
  const { repo, svc } = setup({}, [lead({ id: 'a', score: 62 })]);
  await svc.backfillLegacyScores(ctx(ADMIN), {});
  const second = await svc.backfillLegacyScores(ctx(ADMIN), {});
  assert.strictEqual(second.written, 0);
  assert.strictEqual(second.skippedExisting, 1);
  assert.strictEqual(repo.db.history.length, 1, 'no duplicate legacy snapshot');
});
test('legacy backfill skips leads that never had a score', async () => {
  const { repo, svc } = setup({}, [lead({ id: 'a', score: 0 }), lead({ id: 'b', score: 55 })]);
  const r = await svc.backfillLegacyScores(ctx(ADMIN), {});
  assert.strictEqual(r.written, 1);
  assert.strictEqual(r.skippedNoScore, 1);
  assert.strictEqual(repo.db.history.length, 1);
});
test('legacy backfill preserves the original timestamp, not "now"', async () => {
  const { repo, svc } = setup({}, [lead({ id: 'a', score: 62, updatedAt: NOW - 30 * DAY })]);
  await svc.backfillLegacyScores(ctx(ADMIN), {});
  assert.strictEqual(repo.db.history[0].calculatedAt, NOW - 30 * DAY);
});
test('legacy backfill never touches the lead row', async () => {
  const { repo, svc } = setup({}, [lead({ id: 'a', score: 62 })]);
  const snap = JSON.stringify(repo.db.leads[0]);
  await svc.backfillLegacyScores(ctx(ADMIN), {});
  assert.strictEqual(JSON.stringify(repo.db.leads[0]), snap);
});
test('legacy backfill pages and reports completion', async () => {
  const leads = Array.from({ length: 7 }, (_, i) => lead({ id: 'l' + i, score: 50 + i }));
  const { svc } = setup({}, leads);
  const first = await svc.backfillLegacyScores(ctx(ADMIN), { batchSize: 5, offset: 0 });
  assert.strictEqual(first.processed, 5);
  assert.strictEqual(first.done, false);
  const second = await svc.backfillLegacyScores(ctx(ADMIN), { batchSize: 5, offset: first.nextOffset });
  assert.strictEqual(second.processed, 2);
  assert.strictEqual(second.done, true);
});
test('legacy backfill is audited', async () => {
  const { repo, svc } = setup({}, [lead({ id: 'a', score: 62 })]);
  await svc.backfillLegacyScores(ctx(ADMIN), {});
  assert.ok(repo.db.audits.some(a => a.action === 'legacy_backfill'));
});
test('RBAC: only Admin may run the legacy backfill', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.backfillLegacyScores(ctx(MANAGER), {}), e => e.code === 'FORBIDDEN');
});

/* ------------------------------------------------------------- CSV import */
test('imported leads are scored server-side by the real engine', async () => {
  const { repo, svc } = setup({}, [lead({ id: 'i1' }), lead({ id: 'i2' })]);
  const r = await svc.scoreImportedLeads(ctx(AE), ['i1', 'i2'], { importId: 'imp1' });
  assert.strictEqual(r.scored, 2);
  assert.strictEqual(r.failed.length, 0);
  assert.strictEqual(repo.db.scores.length, 2);
  assert.strictEqual(repo.db.scores[0].totalScore, 70, 'not a hard-coded 40');
});
test('re-running a partially failed import does not double-score', async () => {
  const { repo, svc } = setup({}, [lead({ id: 'i1' })]);
  await svc.scoreImportedLeads(ctx(AE), ['i1'], { importId: 'imp1' });
  const again = await svc.scoreImportedLeads(ctx(AE), ['i1'], { importId: 'imp1' });
  assert.strictEqual(again.skippedDuplicate, 1);
  assert.strictEqual(again.scored, 0);
  assert.strictEqual(repo.db.events.filter(e => e.eventId === 'imp1:i1').length, 1);
});
test('a different import of the same lead scores again', async () => {
  const { svc } = setup({}, [lead({ id: 'i1' })]);
  await svc.scoreImportedLeads(ctx(AE), ['i1'], { importId: 'imp1' });
  const r = await svc.scoreImportedLeads(ctx(AE), ['i1'], { importId: 'imp2' });
  assert.strictEqual(r.scored, 1);
});
test('import continues past a failing lead and reports it', async () => {
  const { svc } = setup({}, [lead({ id: 'i1' })]);
  const r = await svc.scoreImportedLeads(ctx(AE), ['i1', 'missing-lead'], { importId: 'imp1' });
  assert.strictEqual(r.scored, 1);
  assert.strictEqual(r.failed.length, 1);
  assert.strictEqual(r.failed[0].leadId, 'missing-lead');
  assert.strictEqual(r.failed[0].code, 'NOT_FOUND');
});
test('import scoring never touches lead.updatedAt', async () => {
  const { repo, svc } = setup({}, [lead({ id: 'i1' })]);
  const before = repo.db.leads[0].updatedAt;
  await svc.scoreImportedLeads(ctx(AE), ['i1'], {});
  assert.strictEqual(repo.db.leads[0].updatedAt, before);
});

/* -------------------------------------------------------- failure handling */
test('a database failure while saving the score propagates rather than silently passing', async () => {
  const { svc } = setup({}, [lead()], { failOn: 'saveLeadScore' });
  await assert.rejects(() => svc.calculateLeadScore(ctx(), 'l1'), /simulated database failure/);
});
test('a history-write failure does not leave a qualification event behind', async () => {
  const { repo, svc } = setup({}, [lead()], { failOn: 'appendHistory' });
  await assert.rejects(() => svc.calculateLeadScore(ctx(), 'l1'));
  assert.strictEqual(repo.db.qualEvents.length, 0, 'transition is recorded only after history persists');
});
test('a lead-read failure surfaces instead of scoring a phantom lead', async () => {
  const { svc } = setup({}, [lead()], { failOn: 'getLead' });
  await assert.rejects(() => svc.calculateLeadScore(ctx(), 'l1'), /simulated database failure/);
});
test('a malformed rule in an active model does not crash scoring', async () => {
  const { svc } = setup({ rules: [Object.assign({}, RULE, { conditions: { field: 'ghost', operator: 'equals', value: 1 } })] });
  const r = await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(r.score.totalScore, 0, 'unknown field never matches');
});
test('an unknown operator never matches and never throws', async () => {
  const { svc } = setup({ rules: [Object.assign({}, RULE, { conditions: { field: 'industry', operator: 'sortOf', value: 'SaaS' } })] });
  const r = await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(r.score.totalScore, 0);
});
test('a lead with missing data scores without throwing', async () => {
  const { svc } = setup({}, [lead({ id: 'l1', industry: null, amount: null, email: null,
                                    phone: null, activities: null, tags: null, createdAt: null, updatedAt: null })]);
  const r = await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(typeof r.score.totalScore, 'number');
});
