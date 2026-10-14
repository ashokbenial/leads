/**
 * LeadForge 360 — scoring service (SERVER AUTHORITY).
 * ==================================================
 * The only place a stored score is ever produced. The browser may call
 * `previewLeadScore` for the simulator, but nothing it computes is persisted.
 *
 * The repository is injected, so this whole layer runs in-process against an
 * in-memory fake in tests — no Supabase, no network — and against db-repo.js
 * in production.
 *
 * Invariants enforced here:
 *   • lead.updatedAt is NEVER written. Scoring is not a lead update.
 *   • Every write is tenant-scoped and cross-tenant access throws.
 *   • Model mutations are RBAC-gated.
 *   • Events carry an idempotency key: the same touchpoint scores once.
 *   • Automation is returned as intents AFTER persistence succeeds, and only on
 *     an actual qualification transition — never on every recalculation.
 */
const engine = require('./scoring-engine.js');

// Fields that actually affect a score. A lead update that touches none of them
// does not trigger a recalculation (spec §3).
const SCORING_RELEVANT_FIELDS = [
  'stage', 'amount', 'source', 'industry', 'country', 'city', 'company',
  'email', 'phone', 'notes', 'tags', 'ownerId', 'serviceInterest',
  'consent', 'qualifications', 'custom'
];

const ROLE_RANK = { Viewer: 0, SDR: 1, AE: 1, Manager: 2, Admin: 3 };

function err(code, message) { var e = new Error(message); e.code = code; return e; }
function rank(actor) { return ROLE_RANK[(actor && actor.role) || 'Viewer'] || 0; }

function requireTenant(ctx) {
  if (!ctx || !ctx.tenantId) throw err('FORBIDDEN', 'tenantId is required');
  return ctx.tenantId;
}
function requireRole(ctx, minRole, what) {
  if (rank(ctx && ctx.actor) < ROLE_RANK[minRole]) {
    throw err('FORBIDDEN', 'role ' + ((ctx.actor && ctx.actor.role) || 'none') + ' may not ' + what);
  }
}
function assertSameTenant(ctx, row, what) {
  if (!row) throw err('NOT_FOUND', what + ' not found');
  if (row.tenantId && row.tenantId !== ctx.tenantId) throw err('CROSS_TENANT', 'cross-tenant access to ' + what + ' denied');
  return row;
}
function stable(v) { return JSON.stringify(v === undefined ? null : v); }

module.exports = function makeScoringService(repo, options) {
  options = options || {};
  var clock = options.now || function () { return Date.now(); };

  /** Does this update actually change anything the score depends on? */
  function shouldRecalculate(before, after) {
    if (!before) return true;
    return SCORING_RELEVANT_FIELDS.some(function (f) { return stable(before[f]) !== stable(after[f]); });
  }

  async function loadModel(ctx, modelId) {
    var model = modelId ? await repo.getModel(ctx.tenantId, modelId)
                        : await repo.getActiveModel(ctx.tenantId);
    if (!model) throw err('NO_MODEL', 'no active scoring model for tenant ' + ctx.tenantId);
    assertSameTenant(ctx, model, 'scoring model');
    return model;
  }

  /** Compute without persisting. Used by the simulator and by dry runs. */
  async function previewLeadScore(ctx, leadId, opts) {
    requireTenant(ctx); opts = opts || {};
    var lead = assertSameTenant(ctx, await repo.getLead(ctx.tenantId, leadId), 'lead');
    var model = await loadModel(ctx, opts.modelId);
    var override = opts.ignoreOverride ? null : await repo.getActiveOverride(ctx.tenantId, leadId);
    return engine.evaluate(lead, model, {
      now: opts.now || clock(),
      priorEvents: opts.priorEvents || [],
      override: override ? { score: override.overrideScore } : null,
      triggeringEvent: opts.triggeringEvent || 'preview'
    });
  }

  /**
   * THE authoritative calculation. Persists score + components + history +
   * event, records a qualification transition, and returns automation intents.
   * Never touches the lead row.
   */
  async function calculateLeadScore(ctx, leadId, opts) {
    requireTenant(ctx); opts = opts || {};
    var lead = assertSameTenant(ctx, await repo.getLead(ctx.tenantId, leadId), 'lead');
    var model = await loadModel(ctx, opts.modelId);
    var now = opts.now || clock();

    // Idempotency: a touchpoint carrying an eventId is scored at most once.
    if (opts.eventId) {
      var seen = await repo.hasScoreEvent(ctx.tenantId, opts.eventId);
      if (seen) {
        var existing = await repo.getLeadScore(ctx.tenantId, leadId, model.id);
        return { skipped: true, reason: 'duplicate_event', eventId: opts.eventId, score: existing, automation: [] };
      }
    }

    // Prior events are ONLY consulted for genuinely incremental awards. A normal
    // recalculation recomputes the whole score from the lead's current state, so
    // feeding it its own previous components would make every `frequency:'once'`
    // rule stop contributing on the second run and collapse the score to zero.
    // How many times something happened is read from the lead's own activity
    // data (activityCount:* fields), not from score events.
    var prior = opts.incremental ? await repo.listPriorEvents(ctx.tenantId, leadId) : [];
    var override = await repo.getActiveOverride(ctx.tenantId, leadId);
    var previous = await repo.getLeadScore(ctx.tenantId, leadId, model.id);

    var result = engine.evaluate(lead, model, {
      now: now,
      priorEvents: prior,
      override: override ? { score: override.overrideScore } : null,
      triggeringEvent: opts.triggeringEvent || 'recalculation'
    });

    var positive = result.events.filter(function (e) { return e.points > 0; })
                               .reduce(function (a, e) { return a + e.points; }, 0);
    var touchpoint = result.events.filter(function (e) { return e.category === 'engagement' || e.category === 'behavior'; })
                                  .reduce(function (a, e) { return a + e.points; }, 0);

    var row = {
      leadId: leadId, tenantId: ctx.tenantId,
      scoringModelId: model.id, modelVersion: model.version, engineVersion: result.engineVersion,
      totalScore: result.totalScore, systemScore: result.systemScore, overrideScore: result.overrideScore,
      fitScore: result.fitScore, engagementScore: result.engagementScore, intentScore: result.intentScore,
      behaviorScore: result.behaviorScore, sourceScore: result.sourceScore,
      qualificationScore: result.qualificationScore,
      positiveScore: positive, negativeScore: result.negativeScore, touchpointScore: touchpoint,
      qualificationStatus: result.qualification.status,
      qualificationReasons: result.qualification.reasons,
      // Left null on purpose: no historical conversion data exists yet, and a
      // fabricated probability is worse than an absent one (spec §7/§11).
      conversionProbability: null, confidence: null,
      calculatedAt: now
    };

    // --- persistence (order matters: score, then attribution, then history) ---
    await repo.saveLeadScore(ctx.tenantId, row);
    await repo.replaceComponents(ctx.tenantId, leadId, model.id, result.events.map(function (e) {
      return {
        leadId: leadId, tenantId: ctx.tenantId, scoringModelId: model.id, modelVersion: model.version,
        ruleId: e.ruleId, ruleName: e.ruleName, category: e.category,
        pointsAwarded: e.points, matched: true, direction: e.direction, reason: e.reason,
        calculatedAt: now
      };
    }));
    await repo.appendHistory(ctx.tenantId, {
      leadId: leadId, tenantId: ctx.tenantId, scoringModelId: model.id, modelVersion: model.version,
      totalScore: result.totalScore, components: result.scoreComponents,
      qualificationStatus: result.qualification.status, legacy: false, calculatedAt: now
    });
    await repo.appendScoreEvent(ctx.tenantId, {
      leadId: leadId, tenantId: ctx.tenantId,
      eventType: opts.triggeringEvent || 'recalculation', source: opts.source || 'system',
      eventId: opts.eventId || null,
      previousScore: previous ? previous.totalScore : null,
      scoreDelta: previous ? result.totalScore - previous.totalScore : result.totalScore,
      newScore: result.totalScore,
      scoringModelId: model.id, modelVersion: model.version, createdAt: now
    });

    // --- qualification transition (only on an actual change) ---
    var fromStatus = previous ? previous.qualificationStatus : null;
    var toStatus = result.qualification.status;
    var transitioned = fromStatus !== toStatus;
    if (transitioned) {
      await repo.appendQualificationEvent(ctx.tenantId, {
        leadId: leadId, tenantId: ctx.tenantId, fromStatus: fromStatus, toStatus: toStatus,
        reason: (result.qualification.reasons[0] || {}).message || null,
        triggeringRule: result.qualification.overriddenBy || null,
        scoreAtEvent: result.totalScore,
        scoringModelId: model.id, modelVersion: model.version,
        actor: (ctx.actor && ctx.actor.id) || 'system', createdAt: now
      });
    }

    // Automation intents are produced ONLY on a transition, so recalculating a
    // lead fifty times cannot create fifty duplicate tasks (spec §12).
    var automation = transitioned ? buildAutomation(lead, result, fromStatus, toStatus) : [];

    return { skipped: false, result: result, score: row, transitioned: transitioned,
             fromStatus: fromStatus, toStatus: toStatus, automation: automation };
  }

  function buildAutomation(lead, result, fromStatus, toStatus) {
    var out = [];
    if (toStatus === 'hot')          out.push({ type: 'notify_owner', leadId: lead.id, ownerId: lead.ownerId, reason: 'Lead became Hot / Sales Ready' });
    if (toStatus === 'hot' || toStatus === 'qualified')
                                      out.push({ type: 'create_task', leadId: lead.id, title: 'Follow up — lead is ' + toStatus });
    if (toStatus === 'disqualified') out.push({ type: 'set_status', leadId: lead.id, status: 'disqualified' });
    return out;
  }

  /** Batch recalculation. Chunked so no single call runs unbounded. */
  async function recalculateLeadScores(ctx, filters, opts) {
    requireTenant(ctx); requireRole(ctx, 'Admin', 'recalculate scores');
    opts = opts || {};
    var limit = Math.min(opts.limit || 200, 500);
    var leads = await repo.listLeads(ctx.tenantId, Object.assign({}, filters, { limit: limit, offset: opts.offset || 0 }));
    var processed = 0, changed = 0, automation = [];
    for (var i = 0; i < leads.length; i++) {
      var r = await calculateLeadScore(ctx, leads[i].id, { triggeringEvent: 'bulk_recalculation', now: opts.now });
      processed++;
      if (r.transitioned) { changed++; automation = automation.concat(r.automation); }
    }
    return { processed: processed, transitioned: changed, nextOffset: (opts.offset || 0) + leads.length,
             done: leads.length < limit, automation: automation };
  }

  /** Dry run — computes what a migration WOULD do. Commits nothing. */
  async function runScoringDryRun(ctx, opts) {
    requireTenant(ctx); requireRole(ctx, 'Manager', 'run a scoring dry run');
    opts = opts || {};
    var model = await loadModel(ctx, opts.modelId);
    var leads = await repo.listLeads(ctx.tenantId, { limit: opts.limit || 100000, offset: 0 });
    var now = opts.now || clock();
    var base = engine.dryRun(leads, model, { now: now });

    // ── N+1 removed ──────────────────────────────────────────────────────────
    // This loop used to issue one getLeadScore() per lead — 10,000 leads meant
    // 10,000 round trips. One bulk fetch keyed by lead id replaces them. The
    // engine is also evaluated ONCE per lead now (engine.dryRun already
    // evaluated each one; the second pass here doubled the CPU cost).
    var ids = leads.map(function (l) { return l.id; });
    var prevMap = repo.listLeadScores
      ? await repo.listLeadScores(ctx.tenantId, model.id, ids)
      : {};   // repositories without bulk support degrade to "no previous score"

    var missing = leads.filter(function (l) { return !l.email && !l.phone; }).length;
    var byStatus = {};
    var newlyQualified = 0, newlyDisqualified = 0, unchanged = 0, review = 0;
    var byId = {};
    base.rows.forEach(function (r) { byId[r.id] = r; });
    for (var i = 0; i < leads.length; i++) {
      var lead = leads[i];
      var row = byId[lead.id] || {};
      var st = row.newTier;
      byStatus[st] = (byStatus[st] || 0) + 1;
      var prev = prevMap[lead.id] || null;
      var prevStatus = prev ? prev.qualificationStatus : null;
      if (prevStatus !== st && (st === 'qualified' || st === 'hot')) newlyQualified++;
      if (prevStatus !== st && st === 'disqualified') newlyDisqualified++;
      if (prev && prev.totalScore === row.newScore) unchanged++;
      if (Math.abs((row.newScore || 0) - (Number(lead.score) || 0)) >= 30) review++;
    }
    return Object.assign(base, {
      committed: false,
      modelId: model.id, modelVersion: model.version,
      leadsMissingRequiredFields: missing,
      qualificationBreakdown: byStatus,
      newlyQualified: newlyQualified, newlyDisqualified: newlyDisqualified,
      unchangedScores: unchanged, requiringManualReview: review
    });
  }

  // ------------------------------------------------------------- read APIs
  async function getLeadScore(ctx, leadId, modelId) {
    requireTenant(ctx);
    assertSameTenant(ctx, await repo.getLead(ctx.tenantId, leadId), 'lead');
    var model = await loadModel(ctx, modelId);
    return repo.getLeadScore(ctx.tenantId, leadId, model.id);
  }
  async function getLeadScoreBreakdown(ctx, leadId, modelId) {
    requireTenant(ctx);
    var result = await previewLeadScore(ctx, leadId, { modelId: modelId });
    return Object.assign(engine.explain(result), { leadId: leadId, calculatedAt: result.calculatedAt });
  }
  async function getLeadScoreHistory(ctx, leadId, limit) {
    requireTenant(ctx);
    assertSameTenant(ctx, await repo.getLead(ctx.tenantId, leadId), 'lead');
    return repo.listHistory(ctx.tenantId, leadId, limit || 50);
  }
  async function getQualificationDecision(ctx, leadId, modelId) {
    requireTenant(ctx);
    return (await previewLeadScore(ctx, leadId, { modelId: modelId })).qualification;
  }

  // ------------------------------------------------------- model admin APIs
  async function getScoreModel(ctx, modelId) { requireTenant(ctx); return loadModel(ctx, modelId); }

  async function createScoreModel(ctx, model) {
    requireTenant(ctx); requireRole(ctx, 'Admin', 'create a scoring model');
    var m = Object.assign(engine.defaultModel(), model, { tenantId: ctx.tenantId, status: model.status || 'draft' });
    var invalid = (m.rules || []).map(engine.validateRule).filter(function (v) { return !v.valid; });
    if (invalid.length) throw err('INVALID_RULE', invalid[0].errors.join('; '));
    await repo.saveModel(ctx.tenantId, m);
    await audit(ctx, 'create_model', 'scoring_model', m.id, null, m);
    return m;
  }

  async function updateScoreModel(ctx, modelId, patch) {
    requireTenant(ctx); requireRole(ctx, 'Admin', 'update a scoring model');
    var before = await loadModel(ctx, modelId);
    // Any change to scoring behaviour bumps the version; history is never rewritten.
    var bumped = bumpVersion(before.version);
    var after = Object.assign({}, before, patch, { id: before.id, tenantId: ctx.tenantId, version: bumped });
    var invalid = (after.rules || []).map(engine.validateRule).filter(function (v) { return !v.valid; });
    if (invalid.length) throw err('INVALID_RULE', invalid[0].errors.join('; '));
    await repo.saveModel(ctx.tenantId, after);
    await audit(ctx, 'update_model', 'scoring_model', modelId, before, after);
    return after;
  }

  async function activateScoreModel(ctx, modelId) {
    requireTenant(ctx); requireRole(ctx, 'Admin', 'activate a scoring model');
    var m = await loadModel(ctx, modelId);
    await repo.setModelStatus(ctx.tenantId, modelId, 'active');
    await audit(ctx, 'activate_model', 'scoring_model', modelId, { status: m.status }, { status: 'active' });
    return Object.assign({}, m, { status: 'active' });
  }
  async function deactivateScoreModel(ctx, modelId) {
    requireTenant(ctx); requireRole(ctx, 'Admin', 'deactivate a scoring model');
    var m = await loadModel(ctx, modelId);
    await repo.setModelStatus(ctx.tenantId, modelId, 'paused');
    await audit(ctx, 'deactivate_model', 'scoring_model', modelId, { status: m.status }, { status: 'paused' });
    return Object.assign({}, m, { status: 'paused' });
  }

  async function setManualOverride(ctx, leadId, overrideScore, reason) {
    requireTenant(ctx); requireRole(ctx, 'Manager', 'override a lead score');
    if (!reason) throw err('REASON_REQUIRED', 'a reason is required for a manual override');
    assertSameTenant(ctx, await repo.getLead(ctx.tenantId, leadId), 'lead');
    var model = await loadModel(ctx);
    var current = await repo.getLeadScore(ctx.tenantId, leadId, model.id);
    var systemScore = current ? current.systemScore : (await previewLeadScore(ctx, leadId, { ignoreOverride: true })).systemScore;
    var rec = { leadId: leadId, tenantId: ctx.tenantId, systemScore: systemScore, overrideScore: overrideScore,
                reason: reason, actor: (ctx.actor && ctx.actor.id) || 'system', active: true, createdAt: clock() };
    await repo.saveOverride(ctx.tenantId, rec);
    await audit(ctx, 'manual_override', 'lead', leadId, { score: systemScore }, { score: overrideScore, reason: reason });
    return calculateLeadScore(ctx, leadId, { triggeringEvent: 'manual_override' });
  }


  // ------------------------------------------------- simulator (Phase 16)
  /**
   * Hypothetical scoring. Applies `overrides` to a COPY of the lead, evaluates,
   * and returns the projection with a delta against the currently stored score.
   * Touches nothing: no score, no component, no history, no event.
   */
  async function simulateLeadScore(ctx, leadId, opts) {
    requireTenant(ctx); requireRole(ctx, 'SDR', 'run a scoring simulation');
    opts = opts || {};
    var lead = assertSameTenant(ctx, await repo.getLead(ctx.tenantId, leadId), 'lead');
    var model = await loadModel(ctx, opts.modelId);
    var hypothetical = Object.assign({}, lead, opts.overrides || {});
    var now = opts.now || clock();

    var baseline = engine.evaluate(lead, model, { now: now, triggeringEvent: 'simulation_baseline' });
    var projected = engine.evaluate(hypothetical, model, { now: now, triggeringEvent: 'simulation' });
    var stored = await repo.getLeadScore(ctx.tenantId, leadId, model.id);

    return {
      simulated: true, persisted: false,
      leadId: leadId, modelId: model.id, modelVersion: model.version,
      storedScore: stored ? stored.totalScore : null,
      baselineScore: baseline.totalScore,
      projectedScore: projected.totalScore,
      delta: projected.totalScore - baseline.totalScore,
      projectedQualification: projected.qualification,
      baselineQualification: baseline.qualification,
      matchedRules: projected.matchedRules,
      gainedRules: projected.matchedRules.filter(function (r) { return baseline.matchedRules.indexOf(r) === -1; }),
      lostRules: baseline.matchedRules.filter(function (r) { return projected.matchedRules.indexOf(r) === -1; }),
      breakdown: engine.explain(projected)
    };
  }

  // --------------------------------------------- rule impact preview (§17)
  /**
   * What would activating this rule do? Evaluates the population with and
   * without the candidate rule. Every number below is computed from real
   * persisted leads — if there are none, `sampled` is 0 and the caller must show
   * an unavailable state rather than invent an estimate.
   */
  async function previewRuleImpact(ctx, opts) {
    requireTenant(ctx); requireRole(ctx, 'Manager', 'preview rule impact');
    opts = opts || {};
    if (!opts.rule) throw err('BAD_REQUEST', 'a candidate rule is required');
    var v = engine.validateRule(opts.rule);
    if (!v.valid) throw err('INVALID_RULE', v.errors.join('; '));

    var model = await loadModel(ctx, opts.modelId);
    var leads = await repo.listLeads(ctx.tenantId, { limit: opts.limit || 5000, offset: 0 });
    if (!leads.length) {
      return { sampled: 0, dataAvailable: false,
               message: 'No leads available to estimate impact against.' };
    }
    var now = opts.now || clock();
    var withRule = Object.assign({}, model, { rules: (model.rules || []).concat([opts.rule]) });

    var affected = 0, totalDelta = 0, high = 0, med = 0, low = 0;
    var qualBefore = {}, qualAfter = {}, newlyHot = 0, newlyDisqualified = 0;
    leads.forEach(function (l) {
      var a = engine.evaluate(l, model, { now: now });
      var b = engine.evaluate(l, withRule, { now: now });
      var d = b.totalScore - a.totalScore;
      qualBefore[a.qualification.tier] = (qualBefore[a.qualification.tier] || 0) + 1;
      qualAfter[b.qualification.tier] = (qualAfter[b.qualification.tier] || 0) + 1;
      if (d !== 0) {
        affected++; totalDelta += d;
        var m = Math.abs(d);
        if (m >= 20) high++; else if (m >= 8) med++; else low++;
      }
      if (a.qualification.tier !== 'hot' && b.qualification.tier === 'hot') newlyHot++;
      if (a.qualification.status !== 'disqualified' && b.qualification.status === 'disqualified') newlyDisqualified++;
    });

    return {
      sampled: leads.length, dataAvailable: true,
      affectedLeads: affected,
      highImpact: high, mediumImpact: med, lowImpact: low,
      averageScoreChange: affected ? +(totalDelta / affected).toFixed(2) : 0,
      qualificationBefore: qualBefore, qualificationAfter: qualAfter,
      newlyHot: newlyHot, newlyDisqualified: newlyDisqualified,
      committed: false
    };
  }

  // ------------------------------------------ legacy preservation (Phase 3)
  /**
   * Snapshot each lead's pre-engine score into score_history as
   * model_version='legacy', source legacy=true, BEFORE the engine becomes
   * authoritative. Idempotent: a lead that already has a legacy snapshot is
   * skipped, so re-running after a partial failure is safe.
   */
  async function backfillLegacyScores(ctx, opts) {
    requireTenant(ctx); requireRole(ctx, 'Admin', 'backfill legacy scores');
    opts = opts || {};
    var batch = Math.min(opts.batchSize || 200, 500);
    var offset = opts.offset || 0;
    var leads = await repo.listLeads(ctx.tenantId, { limit: batch, offset: offset });
    var written = 0, skippedExisting = 0, skippedNoScore = 0;

    for (var i = 0; i < leads.length; i++) {
      var l = leads[i];
      var legacyScore = Number(l.score) || 0;
      if (!legacyScore) { skippedNoScore++; continue; }
      if (await repo.hasLegacySnapshot(ctx.tenantId, l.id)) { skippedExisting++; continue; }
      await repo.appendHistory(ctx.tenantId, {
        leadId: l.id, tenantId: ctx.tenantId,
        scoringModelId: 'legacy', modelVersion: 'legacy',
        totalScore: legacyScore, components: {},
        qualificationStatus: null, legacy: true,
        calculatedAt: l.updatedAt || l.createdAt || clock()
      });
      written++;
    }
    if (written) {
      await audit(ctx, 'legacy_backfill', 'score_history', ctx.tenantId, null,
                  { written: written, offset: offset });
    }
    return { written: written, skippedExisting: skippedExisting, skippedNoScore: skippedNoScore,
             processed: leads.length, nextOffset: offset + leads.length, done: leads.length < batch };
  }

  // ------------------------------------------------- CSV import (Phase 9)
  /**
   * Score a batch of freshly imported leads server-side. Idempotent per lead
   * via an import-scoped eventId, so re-running a partially failed import does
   * not double-score anything.
   */
  async function scoreImportedLeads(ctx, leadIds, opts) {
    requireTenant(ctx); requireRole(ctx, 'SDR', 'score imported leads');
    opts = opts || {};
    var importId = opts.importId || ('import_' + clock());
    var scored = 0, failed = [], skipped = 0;
    for (var i = 0; i < (leadIds || []).length; i++) {
      var id = leadIds[i];
      try {
        var r = await calculateLeadScore(ctx, id, {
          triggeringEvent: 'csv_import', source: 'import',
          eventId: importId + ':' + id, now: opts.now
        });
        if (r.skipped) skipped++; else scored++;
      } catch (e) {
        failed.push({ leadId: id, error: e.message, code: e.code || 'ERROR' });
      }
    }
    return { importId: importId, requested: (leadIds || []).length,
             scored: scored, skippedDuplicate: skipped, failed: failed };
  }

  function bumpVersion(v) {
    var p = String(v || '1.0.0').split('.').map(Number);
    p[2] = (p[2] || 0) + 1;
    return p.join('.');
  }
  function audit(ctx, action, entityType, entityId, before, after) {
    return repo.appendAudit(ctx.tenantId, {
      tenantId: ctx.tenantId, actor: (ctx.actor && ctx.actor.id) || 'system',
      action: action, entityType: entityType, entityId: entityId,
      beforeVal: before, afterVal: after, createdAt: clock()
    });
  }

  return {
    SCORING_RELEVANT_FIELDS: SCORING_RELEVANT_FIELDS,
    shouldRecalculate: shouldRecalculate,
    calculateLeadScore: calculateLeadScore,
    previewLeadScore: previewLeadScore,
    recalculateLeadScores: recalculateLeadScores,
    runScoringDryRun: runScoringDryRun,
    getLeadScore: getLeadScore,
    getLeadScoreBreakdown: getLeadScoreBreakdown,
    getLeadScoreHistory: getLeadScoreHistory,
    getQualificationDecision: getQualificationDecision,
    getScoreModel: getScoreModel,
    createScoreModel: createScoreModel,
    updateScoreModel: updateScoreModel,
    activateScoreModel: activateScoreModel,
    deactivateScoreModel: deactivateScoreModel,
    setManualOverride: setManualOverride,
    simulateLeadScore: simulateLeadScore,
    previewRuleImpact: previewRuleImpact,
    backfillLegacyScores: backfillLegacyScores,
    scoreImportedLeads: scoreImportedLeads
  };
};
