#!/usr/bin/env node
/**
 * Phase A dry run — score every existing lead with the new engine and report
 * what a migration WOULD do. COMMITS NOTHING.
 *
 *   npm run scoring:dry-run
 *   node --env-file-if-exists=.env.local scripts/scoring-dry-run.js --json > dry-run.json
 *
 * Reads SUPABASE_URL + SUPABASE_SECRET_KEY from the environment. Prints the
 * target host first so you can see which project you are pointed at.
 */
const { createClient } = require('@supabase/supabase-js');
const engine = require('../scoring-engine.js');
const makeService = require('../scoring-service.js');
const makeRepo = require('../db-repo-scoring.js');

const TENANT = 'ab7-solutions';
const url = process.env.SUPABASE_URL || '', key = process.env.SUPABASE_SECRET_KEY || '';
const JSON_OUT = process.argv.includes('--json');

if (!url || !key) { console.error('✗ SUPABASE_URL and SUPABASE_SECRET_KEY are required.'); process.exit(1); }
if (/^sb_publishable_/.test(key)) { console.error('✗ That is the publishable key — RLS will hide every row. Use the secret key.'); process.exit(1); }

(async () => {
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const repo = makeRepo(supabase, TENANT);
  const svc = makeService(repo);
  const ctx = { tenantId: TENANT, actor: { id: 'dry-run', role: 'Admin' } };

  if (!JSON_OUT) console.log('\n  target: ' + new URL(url).host + '  ·  tenant: ' + TENANT + '\n');

  const model = await repo.getActiveModel(TENANT);
  if (!model) {
    console.error('✗ No ACTIVE scoring model for this tenant.');
    console.error('  Run supabase-scoring-v3.sql, create a model, then activate it.');
    process.exit(2);
  }

  const report = await svc.runScoringDryRun(ctx, {});
  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return; }

  const pad = (s, n) => String(s).padEnd(n);
  console.log('  MODEL              ' + model.name + ' v' + model.version + ' (' + model.rules.length + ' rules)');
  console.log('  COMMITTED          ' + report.committed + '   ← dry run, nothing written');
  console.log('');
  console.log('  Total leads        ' + report.totalLeads);
  console.log('  With an old score  ' + report.leadsWithExistingScore);
  console.log('  Missing email+phone' + report.leadsMissingRequiredFields);
  console.log('  Avg old score      ' + report.avgOldScore);
  console.log('  Avg new score      ' + report.avgNewScore);
  console.log('  Unchanged scores   ' + report.unchangedScores);
  console.log('  Newly qualified    ' + report.newlyQualified);
  console.log('  Newly disqualified ' + report.newlyDisqualified);
  console.log('  Needs manual review' + report.requiringManualReview + '   (score moves by 30+)');
  console.log('\n  DISTRIBUTION        before → after');
  Object.keys(report.distributionBefore).forEach(b =>
    console.log('   ' + pad(b, 10) + pad(report.distributionBefore[b], 8) + '→ ' + report.distributionAfter[b]));
  console.log('\n  QUALIFICATION AFTER');
  Object.keys(report.qualificationBreakdown).forEach(k =>
    console.log('   ' + pad(k, 14) + report.qualificationBreakdown[k]));
  console.log('\n  LARGEST CHANGES');
  report.largestChanges.slice(0, 10).forEach(r =>
    console.log('   ' + pad((r.name || r.id).slice(0, 24), 26) + pad(r.oldScore, 6) + '→ ' + pad(r.newScore, 6) +
                '(' + (r.delta > 0 ? '+' : '') + r.delta + ')  ' + r.newTier));
  console.log('\n  Nothing was written. Review, then run Phase B.\n');
})().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
