/**
 * LeadForge 360 — scoring engine unit tests.
 * Pure JS, zero dependencies, no network:  node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const E = require('../scoring-engine.js');

// Fixed clock — every date/recency assertion is reproducible.
const NOW = Date.parse('2026-09-08T12:00:00Z');
const DAY = 86400000;

// A model where `fit` maps 1:1 to the total, so point math in tests is obvious.
function mkModel(over = {}) {
  return Object.assign(E.defaultModel(), {
    id: 'test-model', version: '1.0.0',
    weights: { fit: 1, engagement: 0, intent: 0, behavior: 0, source: 0, qualification: 0 },
    categoryMax: { fit: 100, engagement: 100, intent: 100, behavior: 100, source: 100, qualification: 100 },
    rules: []
  }, over);
}
function rule(over = {}) {
  return Object.assign({
    id: 'r1', name: 'Rule', category: 'fit', action: 'add', points: 10,
    status: 'active', priority: 1, version: '1.0.0',
    frequency: { mode: 'once' }, conditions: null
  }, over);
}
function lead(over = {}) {
  return Object.assign({
    id: 'l1', name: 'Rahul Sharma', company: 'Nexora', email: 'rahul@nexora.com',
    phone: '+91 90000 00000', industry: 'SaaS', country: 'IN', city: 'Pune',
    source: 'Organic Search', stage: 'Qualified', score: 0, amount: 50000,
    notes: '', tags: [], consent: { email: true },
    createdAt: NOW - 10 * DAY, updatedAt: NOW - 2 * DAY,
    activities: [{ type: 'create', at: NOW - 10 * DAY }, { type: 'email', at: NOW - 2 * DAY }]
  }, over);
}
const run = (l, m, ctx = {}) => E.evaluate(l, m, Object.assign({ now: NOW }, ctx));

/* 1 */ test('positive rule adds its points', () => {
  const m = mkModel({ rules: [rule({ points: 15, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } })] });
  const r = run(lead(), m);
  assert.strictEqual(r.totalScore, 15);
  assert.strictEqual(r.events[0].direction, 'positive');
});

/* 2 */ test('negative rule subtracts and is attributed as negative', () => {
  const m = mkModel({ rules: [
    rule({ id: 'p', points: 50, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } }),
    rule({ id: 'n', name: 'Free email domain', category: 'negative', action: 'subtract', points: 20,
           conditions: { field: 'email', operator: 'contains', value: 'nexora' } })
  ]});
  const r = run(lead(), m);
  assert.strictEqual(r.totalScore, 30);
  assert.strictEqual(r.negativeScore, -20);
  assert.strictEqual(r.events.find(e => e.ruleId === 'n').points, -20);
});

/* 3 */ test('multiple matching rules accumulate', () => {
  const m = mkModel({ rules: [
    rule({ id: 'a', points: 10, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } }),
    rule({ id: 'b', points: 15, conditions: { field: 'country', operator: 'equals', value: 'IN' } })
  ]});
  const r = run(lead(), m);
  assert.strictEqual(r.totalScore, 25);
  assert.deepStrictEqual(r.matchedRules, ['a', 'b']);
});

/* 4 */ test('AND group requires every condition', () => {
  const cond = { logic: 'AND', conditions: [
    { field: 'industry', operator: 'equals', value: 'SaaS' },
    { field: 'country', operator: 'equals', value: 'IN' }
  ]};
  assert.strictEqual(run(lead(), mkModel({ rules: [rule({ conditions: cond })] })).totalScore, 10);
  assert.strictEqual(run(lead({ country: 'AE' }), mkModel({ rules: [rule({ conditions: cond })] })).totalScore, 0);
});

/* 5 */ test('OR group requires only one condition', () => {
  const cond = { logic: 'OR', conditions: [
    { field: 'industry', operator: 'equals', value: 'Pharma' },
    { field: 'country', operator: 'equals', value: 'IN' }
  ]};
  assert.strictEqual(run(lead(), mkModel({ rules: [rule({ conditions: cond })] })).totalScore, 10);
});

/* 6 */ test('nested groups evaluate correctly', () => {
  // (industry = SaaS OR industry = IT) AND amount > 10000
  const cond = { logic: 'AND', conditions: [
    { logic: 'OR', conditions: [
      { field: 'industry', operator: 'equals', value: 'SaaS' },
      { field: 'industry', operator: 'equals', value: 'IT' }
    ]},
    { field: 'amount', operator: 'greaterThan', value: 10000 }
  ]};
  const m = mkModel({ rules: [rule({ points: 25, conditions: cond })] });
  assert.strictEqual(run(lead(), m).totalScore, 25);
  assert.strictEqual(run(lead({ industry: 'Retail' }), m).totalScore, 0);
  assert.strictEqual(run(lead({ amount: 5000 }), m).totalScore, 0);
});

/* 7 */ test('greaterThan', () => {
  const m = mkModel({ rules: [rule({ conditions: { field: 'amount', operator: 'greaterThan', value: 20000 } })] });
  assert.strictEqual(run(lead({ amount: 50000 }), m).totalScore, 10);
  assert.strictEqual(run(lead({ amount: 20000 }), m).totalScore, 0);
});

/* 8 */ test('lessThan', () => {
  const m = mkModel({ rules: [rule({ conditions: { field: 'amount', operator: 'lessThan', value: 20000 } })] });
  assert.strictEqual(run(lead({ amount: 5000 }), m).totalScore, 10);
  assert.strictEqual(run(lead({ amount: 50000 }), m).totalScore, 0);
});

/* 9 */ test('contains matches substrings and array members', () => {
  const m = mkModel({ rules: [rule({ conditions: { field: 'notes', operator: 'contains', value: 'need quotation' } })] });
  assert.strictEqual(run(lead({ notes: 'Customer says they NEED QUOTATION asap' }), m).totalScore, 10);
  const t = mkModel({ rules: [rule({ conditions: { field: 'tags', operator: 'contains', value: 'hot' } })] });
  assert.strictEqual(run(lead({ tags: ['warm', 'hot'] }), t).totalScore, 10);
});

/* 10 */ test('empty and null fields never crash and never score', () => {
  const m = mkModel({ rules: [
    rule({ id: 'e', conditions: { field: 'phone', operator: 'isEmpty', value: null } }),
    rule({ id: 'g', points: 5, conditions: { field: 'amount', operator: 'greaterThan', value: 1 } }),
    rule({ id: 'u', points: 99, conditions: { field: 'doesNotExist', operator: 'equals', value: 'x' } })
  ]});
  const r = run(lead({ phone: '', amount: null, notes: null, activities: null, tags: null }), m);
  assert.strictEqual(r.matchedRules.includes('e'), true);
  assert.strictEqual(r.matchedRules.includes('g'), false);
  assert.strictEqual(r.matchedRules.includes('u'), false, 'unknown field must never match');
});

/* 11 */ test('date conditions compare against ctx.now', () => {
  const m = mkModel({ rules: [rule({ conditions: { field: 'createdAt', operator: 'before', value: NOW - 5 * DAY } })] });
  assert.strictEqual(run(lead({ createdAt: NOW - 10 * DAY }), m).totalScore, 10);
  assert.strictEqual(run(lead({ createdAt: NOW - 1 * DAY }), m).totalScore, 0);
});

/* 12 */ test('recency: withinDays and olderThanDays', () => {
  const win = mkModel({ rules: [rule({ conditions: { field: 'lastActivityAt', operator: 'withinDays', value: 7 } })] });
  assert.strictEqual(run(lead(), win).totalScore, 10);
  const stale = lead({ updatedAt: NOW - 30 * DAY, activities: [{ type: 'create', at: NOW - 30 * DAY }] });
  assert.strictEqual(run(stale, win).totalScore, 0);
  const old = mkModel({ rules: [rule({ category: 'negative', action: 'subtract', points: 15,
    conditions: { field: 'lastActivityAt', operator: 'olderThanDays', value: 14 } })] });
  assert.strictEqual(run(stale, old).negativeScore, -15);
});

/* 13 */ test('score caps: category cap and per-rule lifetime cap', () => {
  const capped = mkModel({
    categoryCap: { fit: 30 },          // hard ceiling on raw fit points
    rules: [
      rule({ id: 'a', points: 25, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } }),
      rule({ id: 'b', points: 25, conditions: { field: 'country', operator: 'equals', value: 'IN' } })
    ]});
  assert.strictEqual(run(lead(), capped).totalScore, 30, 'category cap applies');

  const perRule = mkModel({ rules: [rule({ id: 'open', points: 2,
    frequency: { mode: 'always', maxPoints: 20 },
    conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } })] });
  const prior = Array.from({ length: 10 }, () => ({ ruleId: 'open', points: 2, occurredAt: NOW - DAY }));
  assert.strictEqual(run(lead(), perRule, { priorEvents: prior }).totalScore, 0, 'lifetime cap exhausted');
  assert.strictEqual(run(lead(), perRule, { priorEvents: prior.slice(0, 9) }).totalScore, 2, 'room for 2 more');
});

/* 14 */ test('hard disqualifier overrides a high score', () => {
  const m = mkModel({
    rules: [rule({ points: 95, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } })],
    disqualifiers: [{ id: 'dq1', name: 'Competitor', reason: 'Marked as competitor',
      condition: { field: 'tags', operator: 'contains', value: 'competitor' } }]
  });
  const clean = run(lead(), m);
  assert.strictEqual(clean.qualification.status, 'hot');
  const dq = run(lead({ tags: ['competitor'] }), m);
  assert.strictEqual(dq.totalScore, 95, 'score is still computed and preserved');
  assert.strictEqual(dq.qualification.status, 'disqualified');
  assert.strictEqual(dq.qualification.qualified, false);
  assert.strictEqual(dq.qualification.overriddenBy, 'hard_disqualifier');
});

/* 15 */ test('qualification gate blocks a qualifying score', () => {
  const m = mkModel({
    rules: [rule({ points: 75, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } })],
    gates: [{ id: 'g1', name: 'Valid phone', message: 'No valid phone number on record',
      condition: { field: 'hasPhone', operator: 'isTrue', value: true } }]
  });
  assert.strictEqual(run(lead(), m).qualification.qualified, true);
  const gated = run(lead({ phone: '' }), m);
  assert.strictEqual(gated.totalScore, 75);
  assert.strictEqual(gated.qualification.qualified, false);
  assert.strictEqual(gated.qualification.overriddenBy, 'qualification_gate');
  assert.ok(gated.qualification.reasons.some(r => r.type === 'gate'));
});

/* 16 */ test('manual override sets effective score but preserves the system score', () => {
  const m = mkModel({ rules: [rule({ points: 72, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } })] });
  const r = run(lead(), m, { override: { score: 85, reason: 'Verified on call', actor: 'u1' } });
  assert.strictEqual(r.systemScore, 72);
  assert.strictEqual(r.overrideScore, 85);
  assert.strictEqual(r.totalScore, 85);
  assert.strictEqual(r.qualification.tier, 'hot');
});

/* 17 */ test('same input always produces the same output', () => {
  const m = mkModel({ rules: [
    rule({ id: 'a', points: 10, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } }),
    rule({ id: 'b', points: 15, category: 'intent', conditions: { field: 'stage', operator: 'equals', value: 'Qualified' } }),
    rule({ id: 'c', category: 'negative', action: 'subtract', points: 5,
           conditions: { field: 'lastActivityAt', operator: 'olderThanDays', value: 1 } })
  ]});
  const first = JSON.stringify(run(lead(), m));
  for (let i = 0; i < 50; i++) assert.strictEqual(JSON.stringify(run(lead(), m)), first);
});

/* 18 */ test('historical recalculation is stateless and time-aware', () => {
  const m = mkModel({ rules: [rule({ conditions: { field: 'lastActivityAt', operator: 'withinDays', value: 7 } })] });
  const l = lead();
  assert.strictEqual(E.evaluate(l, m, { now: NOW }).totalScore, 10);
  assert.strictEqual(E.evaluate(l, m, { now: NOW + 30 * DAY }).totalScore, 0, 'same lead, later clock, rule no longer matches');
  // recalculating from scratch twice must not drift
  assert.strictEqual(E.evaluate(l, m, { now: NOW }).totalScore, E.evaluate(l, m, { now: NOW }).totalScore);
});

/* 19 */ test('scoring never mutates the lead or its updatedAt', () => {
  const m = mkModel({ rules: [rule({ points: 30, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } })] });
  const l = lead();
  const before = JSON.parse(JSON.stringify(l));
  const frozen = Object.freeze(Object.assign({}, l, { activities: Object.freeze(l.activities.map(Object.freeze)) }));
  const r = run(frozen, m);                       // engine is strict-mode: a write would throw
  assert.strictEqual(r.totalScore, 30);
  assert.deepStrictEqual(l, before, 'lead object is untouched');
  assert.strictEqual(l.updatedAt, before.updatedAt, 'updatedAt is untouched');
  assert.strictEqual(l.score, 0, 'engine does not write back the score');
});

/* 20 */ test('AI unavailable falls back to deterministic scoring', () => {
  const m = mkModel({ rules: [rule({ points: 40, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } })] });
  const noAi = run(lead(), m);
  assert.strictEqual(noAi.ai.available, false);
  assert.strictEqual(noAi.ai.reason, 'insufficient_historical_data');
  assert.strictEqual(noAi.totalScore, 40, 'deterministic score still produced');
  const withAi = run(lead(), m, { ai: { available: true, score: 91, confidence: 'high', factors: ['ICP match'] } });
  assert.strictEqual(withAi.ai.available, true);
  assert.strictEqual(withAi.totalScore, 40, 'AI is advisory and does not alter the deterministic total');
});

/* extra — attribution, validation, versioning, dry run */
test('every event carries full attribution and model version', () => {
  const m = mkModel({ rules: [rule({ id: 'demo', name: 'Demo requested', description: 'Lead requested a demo',
    category: 'intent', points: 20, conditions: { field: 'stage', operator: 'equals', value: 'Qualified' } })] });
  const e = run(lead(), m).events[0];
  ['ruleId', 'ruleName', 'points', 'direction', 'category', 'triggeringEvent', 'occurredAt', 'modelId', 'modelVersion']
    .forEach(k => assert.ok(e[k] !== undefined, 'missing ' + k));
  assert.strictEqual(e.modelVersion, '1.0.0');
});

test('validateRule rejects unknown fields and operators', () => {
  assert.strictEqual(E.validateRule(rule({ conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } })).valid, true);
  const bad = E.validateRule(rule({ conditions: { field: 'jobTitle', operator: 'blah', value: 1 } }));
  assert.strictEqual(bad.valid, false);
  assert.strictEqual(bad.errors.length, 2);
});

test('dryRun reports impact and commits nothing', () => {
  const m = mkModel({ rules: [rule({ points: 60, conditions: { field: 'industry', operator: 'equals', value: 'SaaS' } })] });
  const leads = [lead({ id: 'a', score: 40 }), lead({ id: 'b', score: 90, industry: 'Retail' })];
  const snapshot = JSON.stringify(leads);
  const d = E.dryRun(leads, m, { now: NOW });
  assert.strictEqual(d.committed, false);
  assert.strictEqual(d.totalLeads, 2);
  assert.strictEqual(d.avgOldScore, 65);
  assert.strictEqual(d.avgNewScore, 30);
  assert.strictEqual(d.rows.find(r => r.id === 'a').newScore, 60);
  assert.strictEqual(d.rows.find(r => r.id === 'b').newScore, 0);
  assert.strictEqual(JSON.stringify(leads), snapshot, 'dry run must not mutate leads');
});
