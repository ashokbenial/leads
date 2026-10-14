#!/usr/bin/env node
/**
 * LOCAL benchmark — engine + service throughput against an in-memory repository.
 *
 * ⚠ This measures CPU cost of rule evaluation ONLY. It does NOT measure Supabase
 *   latency, network, serverless cold starts or connection limits, and must not
 *   be quoted as production performance.
 */
const engine = require('../scoring-engine.js');
const makeService = require('../scoring-service.js');
const NOW = Date.parse('2026-09-08T12:00:00Z'), DAY = 86400000, T = 'ab7-solutions';

function model(nRules) {
  const rules = [];
  for (let i = 0; i < nRules; i++) rules.push({
    id: 'r' + i, name: 'Rule ' + i, category: ['fit','engagement','intent','behavior','source','qualification'][i % 6],
    action: i % 7 === 0 ? 'subtract' : 'add', points: 5 + (i % 10),
    status: 'active', priority: i, frequency: { mode: 'once' },
    conditions: { logic: 'AND', conditions: [
      { logic: 'OR', conditions: [
        { field: 'industry', operator: 'equals', value: 'SaaS' },
        { field: 'country', operator: 'equals', value: 'IN' } ] },
      { field: 'amount', operator: 'greaterThan', value: 1000 + i } ] }
  });
  return Object.assign(engine.defaultModel(), { id: 'm1', tenantId: T, version: '1.0.0', status: 'active', rules });
}
const mkLead = i => ({ id: 'l' + i, tenantId: T, name: 'L' + i, email: 'l' + i + '@x.com', phone: '+91',
  industry: i % 3 ? 'SaaS' : 'Retail', country: i % 2 ? 'IN' : 'AE', source: 'Referral',
  stage: 'New', score: i % 100, amount: 10000 + i, tags: [], activities: [], createdAt: NOW - 5 * DAY, updatedAt: NOW - 2 * DAY });

function repoFor(leads, m) {
  const scores = {};
  let getLeadScoreCalls = 0, bulkCalls = 0;
  return { stats: () => ({ getLeadScoreCalls, bulkCalls }),
    async getLead(t, id) { return leads.find(l => l.id === id) || null; },
    async listLeads(t, f) { return leads.slice(f.offset || 0, (f.offset || 0) + (f.limit || leads.length)); },
    async getActiveModel() { return m; }, async getModel() { return m; },
    async getLeadScore(t, l, mm) { getLeadScoreCalls++; return scores[l] || null; },
    async listLeadScores(t, mm, ids) { bulkCalls++; const o = {}; ids.forEach(i => { if (scores[i]) o[i] = scores[i]; }); return o; },
    async saveLeadScore(t, r) { scores[r.leadId] = r; },
    async replaceComponents() {}, async hasScoreEvent() { return false; },
    async appendScoreEvent() {}, async appendHistory() {}, async listHistory() { return []; },
    async hasLegacySnapshot() { return false; }, async appendQualificationEvent() {},
    async appendAudit() {}, async listPriorEvents() { return []; },
    async getActiveOverride() { return null; }, async saveOverride() {}, async setModelStatus() {}, async saveModel() {}
  };
}

(async () => {
  const RULES = 25;
  const m = model(RULES);
  console.log('\n  LOCAL benchmark — ' + RULES + ' rules/model, in-memory repo (no database)\n');
  console.log('  ' + 'leads'.padEnd(9) + 'dry-run'.padEnd(12) + 'per lead'.padEnd(12) + 'getLeadScore'.padEnd(14) + 'bulk');
  console.log('  ' + '-'.repeat(54));
  for (const n of [100, 1000, 10000]) {
    const leads = Array.from({ length: n }, (_, i) => mkLead(i));
    const repo = repoFor(leads, m);
    const svc = makeService(repo, { now: () => NOW });
    const ctx = { tenantId: T, actor: { id: 'bench', role: 'Admin' } };
    const t0 = process.hrtime.bigint();
    await svc.runScoringDryRun(ctx, { limit: n });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const s = repo.stats();
    console.log('  ' + String(n).padEnd(9) + (ms.toFixed(0) + ' ms').padEnd(12) +
      ((ms / n).toFixed(3) + ' ms').padEnd(12) + String(s.getLeadScoreCalls).padEnd(14) + String(s.bulkCalls));
  }
  // single-lead authoritative path
  const leads = Array.from({ length: 1000 }, (_, i) => mkLead(i));
  const repo = repoFor(leads, m); const svc = makeService(repo, { now: () => NOW });
  const ctx = { tenantId: T, actor: { id: 'bench', role: 'Admin' } };
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) await svc.calculateLeadScore(ctx, 'l' + i, { triggeringEvent: 'bench' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('\n  calculateLeadScore ×1000 (full persist path): ' + ms.toFixed(0) + ' ms · ' + (ms / 1000).toFixed(3) + ' ms/lead');
  console.log('\n  ⚠ CPU only. Excludes Supabase latency, serverless cold start and connection limits.\n');
})();
