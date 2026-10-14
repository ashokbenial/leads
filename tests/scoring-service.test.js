/**
 * LeadForge 360 — scoring service integration + security tests.
 * Runs the real service against an in-memory repository: no Supabase, no network.
 */
const test = require('node:test');
const assert = require('node:assert');
const engine = require('../scoring-engine.js');
const makeService = require('../scoring-service.js');

const NOW = Date.parse('2026-09-08T12:00:00Z');
const DAY = 86400000;
const T1 = 'ab7-solutions', T2 = 'other-tenant';
const ADMIN = { id: 'u1', role: 'Admin' }, MANAGER = { id: 'u2', role: 'Manager' },
      AE = { id: 'u3', role: 'AE' }, VIEWER = { id: 'u4', role: 'Viewer' };

// ------------------------------------------------------------- in-memory repo
function makeRepo() {
  const db = { leads: [], models: [], scores: [], components: [], events: [],
               history: [], qualEvents: [], audits: [], overrides: [] };
  const T = (t, r) => r.tenantId === t;
  return { db,
    async getLead(t, id) { return db.leads.find(l => l.id === id && T(t, l)) || db.leads.find(l => l.id === id) || null; },
    async listLeads(t, f) { const r = db.leads.filter(l => T(t, l)); return r.slice(f.offset || 0, (f.offset || 0) + (f.limit || 1000)); },
    async getActiveModel(t) { return db.models.find(m => T(t, m) && m.status === 'active') || null; },
    async getModel(t, id) { return db.models.find(m => m.id === id) || null; },
    async saveModel(t, m) { const i = db.models.findIndex(x => x.id === m.id); i >= 0 ? db.models[i] = m : db.models.push(m); },
    async setModelStatus(t, id, s) { const m = db.models.find(x => x.id === id && T(t, x)); if (m) m.status = s; },
    async getLeadScore(t, leadId, modelId) { return db.scores.find(s => s.leadId === leadId && s.scoringModelId === modelId && T(t, s)) || null; },
    async saveLeadScore(t, row) { const i = db.scores.findIndex(s => s.leadId === row.leadId && s.scoringModelId === row.scoringModelId);
                                  i >= 0 ? db.scores[i] = row : db.scores.push(row); },
    async replaceComponents(t, leadId, modelId, rows) {
      for (let i = db.components.length - 1; i >= 0; i--)
        if (db.components[i].leadId === leadId && db.components[i].scoringModelId === modelId) db.components.splice(i, 1);
      rows.forEach(r => db.components.push(r));
    },
    async hasScoreEvent(t, eventId) { return db.events.some(e => e.eventId === eventId && T(t, e)); },
    async appendScoreEvent(t, row) { db.events.push(row); },
    async appendHistory(t, row) { db.history.push(row); },
    async listHistory(t, leadId, n) { return db.history.filter(h => h.leadId === leadId && T(t, h)).slice(-n).reverse(); },
    async appendQualificationEvent(t, row) { db.qualEvents.push(row); },
    async appendAudit(t, row) { db.audits.push(row); },
    async listPriorEvents(t, leadId) { return db.components.filter(c => c.leadId === leadId)
                                          .map(c => ({ ruleId: c.ruleId, points: c.pointsAwarded, occurredAt: c.calculatedAt })); },
    async getActiveOverride(t, leadId) { return db.overrides.filter(o => o.leadId === leadId && o.active && T(t, o)).slice(-1)[0] || null; },
    async saveOverride(t, rec) { db.overrides.forEach(o => { if (o.leadId === rec.leadId) o.active = false; }); db.overrides.push(rec); }
  };
}

function model(tenantId = T1, over = {}) {
  return Object.assign(engine.defaultModel(), {
    id: 'm1', tenantId, name: 'V1', version: '1.0.0', status: 'active',
    weights: { fit: 1, engagement: 0, intent: 0, behavior: 0, source: 0, qualification: 0 },
    rules: [
      { id: 'r-icp', name: 'Target industry', description: 'Industry matches ICP', category: 'fit',
        action: 'add', points: 75, status: 'active', priority: 1, frequency: { mode: 'once' },
        conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } }
    ]
  }, over);
}
function lead(over = {}) {
  return Object.assign({ id: 'l1', tenantId: T1, name: 'Rahul', email: 'r@nexora.com', phone: '+91 900',
    industry: 'SaaS', country: 'IN', source: 'Referral', stage: 'New', score: 0, amount: 50000,
    tags: [], activities: [], createdAt: NOW - 5 * DAY, updatedAt: NOW - 2 * DAY }, over);
}
function setup(over = {}, leadOver = {}) {
  const repo = makeRepo();
  repo.db.models.push(model(T1, over));
  repo.db.leads.push(lead(leadOver));
  return { repo, svc: makeService(repo, { now: () => NOW }) };
}
const ctx = (actor = ADMIN, tenantId = T1) => ({ tenantId, actor });

/* ---------------------------------------------------------------- persistence */
test('lead create → score, components, history and event all persist', async () => {
  const { repo, svc } = setup();
  const r = await svc.calculateLeadScore(ctx(), 'l1', { triggeringEvent: 'lead_created' });
  assert.strictEqual(r.score.totalScore, 75);
  assert.strictEqual(repo.db.scores.length, 1);
  assert.strictEqual(repo.db.components.length, 1);
  assert.strictEqual(repo.db.history.length, 1);
  assert.strictEqual(repo.db.events.length, 1);
  assert.strictEqual(repo.db.events[0].eventType, 'lead_created');
});

test('persisted score carries model id, version and engine version', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  const s = repo.db.scores[0];
  assert.strictEqual(s.scoringModelId, 'm1');
  assert.strictEqual(s.modelVersion, '1.0.0');
  assert.strictEqual(s.engineVersion, engine.ENGINE_VERSION);
  assert.ok(s.calculatedAt);
});

test('component rows carry full rule attribution', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  const c = repo.db.components[0];
  assert.strictEqual(c.ruleId, 'r-icp');
  assert.strictEqual(c.ruleName, 'Target industry');
  assert.strictEqual(c.category, 'fit');
  assert.strictEqual(c.pointsAwarded, 75);
  assert.strictEqual(c.direction, 'positive');
});

test('score history accumulates and is never overwritten', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  repo.db.leads[0].industry = 'Retail';
  await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(repo.db.history.length, 2);
  assert.strictEqual(repo.db.history[0].totalScore, 75);
  assert.strictEqual(repo.db.history[1].totalScore, 0);
  const hist = await svc.getLeadScoreHistory(ctx(), 'l1');
  assert.strictEqual(hist.length, 2);
});

test('score event records previous, delta and new score', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  repo.db.leads[0].industry = 'Retail';
  await svc.calculateLeadScore(ctx(), 'l1');
  const e = repo.db.events[1];
  assert.strictEqual(e.previousScore, 75);
  assert.strictEqual(e.scoreDelta, -75);
  assert.strictEqual(e.newScore, 0);
});

/* ------------------------------------------------------------------ integrity */
test('lead update only recalculates when a scoring-relevant field changed', async () => {
  const { svc } = setup();
  const before = lead();
  assert.strictEqual(svc.shouldRecalculate(before, Object.assign({}, before, { name: 'Renamed' })), false);
  assert.strictEqual(svc.shouldRecalculate(before, Object.assign({}, before, { visibility: { mode: 'all' } })), false);
  assert.strictEqual(svc.shouldRecalculate(before, Object.assign({}, before, { stage: 'Demo' })), true);
  assert.strictEqual(svc.shouldRecalculate(before, Object.assign({}, before, { amount: 1 })), true);
});

test('duplicate activity event is idempotent — scored once', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1', { eventId: 'evt-1', triggeringEvent: 'email_opened' });
  const second = await svc.calculateLeadScore(ctx(), 'l1', { eventId: 'evt-1', triggeringEvent: 'email_opened' });
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(second.reason, 'duplicate_event');
  assert.strictEqual(repo.db.events.filter(e => e.eventId === 'evt-1').length, 1);
});

test('repeated recalculation does not duplicate automation or qualification events', async () => {
  const { repo, svc } = setup();
  const first = await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(first.transitioned, true);
  assert.ok(first.automation.length > 0);
  for (let i = 0; i < 20; i++) {
    const again = await svc.calculateLeadScore(ctx(), 'l1');
    assert.strictEqual(again.transitioned, false, 'no transition on identical recalculation');
    assert.deepStrictEqual(again.automation, [], 'no repeat automation');
  }
  assert.strictEqual(repo.db.qualEvents.length, 1);
});

test('REGRESSION: scoring never modifies lead.updatedAt', async () => {
  const { repo, svc } = setup();
  const before = repo.db.leads[0].updatedAt;
  const beforeSnapshot = JSON.stringify(repo.db.leads[0]);
  await svc.calculateLeadScore(ctx(), 'l1', { triggeringEvent: 'lead_created' });
  await svc.calculateLeadScore(ctx(), 'l1', { eventId: 'e2', triggeringEvent: 'email_clicked' });
  await svc.recalculateLeadScores(ctx(), {}, {});
  assert.strictEqual(repo.db.leads[0].updatedAt, before, 'updatedAt unchanged');
  assert.strictEqual(JSON.stringify(repo.db.leads[0]), beforeSnapshot, 'lead row untouched entirely');
});

test('scoring does not write the score back onto the lead row', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(repo.db.leads[0].score, 0, 'lead.score is not the authority — lead_scores is');
  assert.strictEqual(repo.db.scores[0].totalScore, 75);
});

test('no randomness: identical inputs produce identical persisted scores', async () => {
  const a = setup(), b = setup();
  await a.svc.calculateLeadScore(ctx(), 'l1');
  await b.svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(JSON.stringify(a.repo.db.scores[0]), JSON.stringify(b.repo.db.scores[0]));
});

test('no fabricated conversion probability or confidence is persisted', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(repo.db.scores[0].conversionProbability, null);
  assert.strictEqual(repo.db.scores[0].confidence, null);
});

/* -------------------------------------------------------------- qualification */
test('qualification gate blocks a qualifying score through the service', async () => {
  const { svc } = setup({ gates: [{ id: 'g1', name: 'Valid phone', message: 'No phone on record',
    condition: { field: 'hasPhone', operator: 'isTrue', value: true } }] }, { phone: '' });
  const r = await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(r.score.totalScore, 75);
  assert.strictEqual(r.score.qualificationStatus, 'nurture');
  assert.ok(r.score.qualificationReasons.some(x => x.type === 'gate'));
});

test('hard disqualifier overrides a high score through the service', async () => {
  const { repo, svc } = setup({ disqualifiers: [{ id: 'dq', name: 'Competitor', reason: 'Marked competitor',
    condition: { field: 'tags', operator: 'contains', value: 'competitor' } }] }, { tags: ['competitor'] });
  const r = await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(r.score.totalScore, 75);
  assert.strictEqual(r.score.qualificationStatus, 'disqualified');
  assert.strictEqual(repo.db.qualEvents[0].toStatus, 'disqualified');
});

test('qualification transition is recorded with from/to and score', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  const q = repo.db.qualEvents[0];
  assert.strictEqual(q.fromStatus, null);
  assert.strictEqual(q.toStatus, 'qualified');
  assert.strictEqual(q.scoreAtEvent, 75);
  assert.strictEqual(q.modelVersion, '1.0.0');
});

test('getQualificationDecision is independent of the stored score', async () => {
  const { svc } = setup();
  const d2 = await svc.getQualificationDecision(ctx(), 'l1');
  assert.strictEqual(d2.status, 'qualified');
  assert.strictEqual(d2.qualified, true);
});

/* ------------------------------------------------------------------ versioning */
test('updating a model bumps the version and preserves prior history', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  const updated = await svc.updateScoreModel(ctx(), 'm1', { rules: [] });
  assert.strictEqual(updated.version, '1.0.1');
  await svc.calculateLeadScore(ctx(), 'l1');
  assert.strictEqual(repo.db.history.length, 2);
  assert.strictEqual(repo.db.history[0].modelVersion, '1.0.0');
  assert.strictEqual(repo.db.history[1].modelVersion, '1.0.1');
});

test('model changes are written to the audit log', async () => {
  const { repo, svc } = setup();
  await svc.updateScoreModel(ctx(), 'm1', { name: 'V2' });
  await svc.activateScoreModel(ctx(), 'm1');
  assert.strictEqual(repo.db.audits.length, 2);
  assert.strictEqual(repo.db.audits[0].action, 'update_model');
  assert.strictEqual(repo.db.audits[0].actor, 'u1');
});

test('invalid rules are rejected before a model is saved', async () => {
  const { svc } = setup();
  await assert.rejects(
    () => svc.createScoreModel(ctx(), { id: 'bad', name: 'Bad', rules: [
      { id: 'x', name: 'X', category: 'fit', action: 'add', points: 5,
        conditions: { field: 'jobTitle', operator: 'nope', value: 1 } }] }),
    e => e.code === 'INVALID_RULE');
});

/* -------------------------------------------------------------- manual override */
test('manual override persists, preserves the system score, and is audited', async () => {
  const { repo, svc } = setup();
  await svc.calculateLeadScore(ctx(), 'l1');
  const r = await svc.setManualOverride(ctx(MANAGER), 'l1', 95, 'Verified enterprise need on call');
  assert.strictEqual(r.score.systemScore, 75);
  assert.strictEqual(r.score.overrideScore, 95);
  assert.strictEqual(r.score.totalScore, 95);
  assert.strictEqual(repo.db.overrides[0].reason, 'Verified enterprise need on call');
  assert.ok(repo.db.audits.some(a => a.action === 'manual_override'));
});

test('manual override without a reason is rejected', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.setManualOverride(ctx(MANAGER), 'l1', 95, ''), e => e.code === 'REASON_REQUIRED');
});

/* ----------------------------------------------------------------- dry run */
test('dry run reports impact and commits nothing', async () => {
  const { repo, svc } = setup();
  const d = await svc.runScoringDryRun(ctx(MANAGER));
  assert.strictEqual(d.committed, false);
  assert.strictEqual(d.totalLeads, 1);
  assert.strictEqual(d.newlyQualified, 1);
  assert.strictEqual(d.modelVersion, '1.0.0');
  assert.strictEqual(repo.db.scores.length, 0, 'nothing persisted');
  assert.strictEqual(repo.db.history.length, 0);
});

/* -------------------------------------------------------------------- security */
test('SECURITY: cross-tenant lead scoring is denied', async () => {
  const { repo, svc } = setup();
  repo.db.leads.push(lead({ id: 'l-other', tenantId: T2 }));
  await assert.rejects(() => svc.calculateLeadScore(ctx(ADMIN, T1), 'l-other'), e => e.code === 'CROSS_TENANT');
});

test('SECURITY: another tenant cannot read a lead score', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.getLeadScore(ctx(ADMIN, T2), 'l1'), e => e.code === 'CROSS_TENANT' || e.code === 'NO_MODEL');
});

test('SECURITY: another tenant cannot read this tenant\'s scoring model', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.getScoreModel(ctx(ADMIN, T2), 'm1'), e => e.code === 'CROSS_TENANT');
});

test('SECURITY: a call without a tenant is refused', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.calculateLeadScore({ actor: ADMIN }, 'l1'), e => e.code === 'FORBIDDEN');
});

test('RBAC: Viewer cannot create or update a scoring model', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.createScoreModel(ctx(VIEWER), { id: 'x', name: 'X' }), e => e.code === 'FORBIDDEN');
  await assert.rejects(() => svc.updateScoreModel(ctx(VIEWER), 'm1', { name: 'X' }), e => e.code === 'FORBIDDEN');
});

test('RBAC: AE cannot activate a model or override a score', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.activateScoreModel(ctx(AE), 'm1'), e => e.code === 'FORBIDDEN');
  await assert.rejects(() => svc.setManualOverride(ctx(AE), 'l1', 90, 'because'), e => e.code === 'FORBIDDEN');
});

test('RBAC: only Admin may run a bulk recalculation', async () => {
  const { svc } = setup();
  await assert.rejects(() => svc.recalculateLeadScores(ctx(MANAGER), {}, {}), e => e.code === 'FORBIDDEN');
  const ok = await svc.recalculateLeadScores(ctx(ADMIN), {}, {});
  assert.strictEqual(ok.processed, 1);
});

test('RBAC: Viewer may still read a score breakdown', async () => {
  const { svc } = setup();
  const b = await svc.getLeadScoreBreakdown(ctx(VIEWER), 'l1');
  assert.strictEqual(b.total, 75);
  assert.strictEqual(b.positive.length, 1);
});

/* ------------------------------------------------------------------- misc */
test('missing active model fails loudly rather than scoring silently', async () => {
  const { repo, svc } = setup();
  repo.db.models[0].status = 'paused';
  await assert.rejects(() => svc.calculateLeadScore(ctx(), 'l1'), e => e.code === 'NO_MODEL');
});

test('bulk recalculation reports progress and terminates', async () => {
  const { repo, svc } = setup();
  for (let i = 2; i <= 12; i++) repo.db.leads.push(lead({ id: 'l' + i }));
  const r = await svc.recalculateLeadScores(ctx(ADMIN), {}, { limit: 500 });
  assert.strictEqual(r.processed, 12);
  assert.strictEqual(r.done, true);
  assert.strictEqual(repo.db.scores.length, 12);
});
