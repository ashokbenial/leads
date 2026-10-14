/**
 * LeadForge 360 — deterministic scoring & qualification engine.
 * ============================================================
 * ONE implementation, loaded in both places:
 *   • Node   — `require('./scoring-engine.js')` from db-server.js (AUTHORITATIVE)
 *   • Browser— <script src="scoring-engine.js"> before js/app.js → window.LF.scoring
 *              (preview / simulator ONLY — the browser never decides a stored score)
 *
 * Guarantees:
 *   1. PURE. Never mutates the lead. Never writes updatedAt. Returns data only.
 *   2. DETERMINISTIC. No Math.random(), no implicit Date.now() — "now" is injected
 *      via ctx.now, so the same (lead, model version, now) always yields the same
 *      score. This is what makes recalculation and tests reproducible.
 *   3. EXPLAINABLE. Every point is attributed to a rule with a reason and category.
 *   4. VERSIONED. Every result and event carries modelId + modelVersion.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.LF = root.LF || {}; root.LF.scoring = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ENGINE_VERSION = '1.0.0';
  var DAY = 86400000;

  var CATEGORIES = ['fit', 'engagement', 'intent', 'behavior', 'source', 'qualification'];

  // ---------------------------------------------------------------- helpers
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function lower(v) { return str(v).toLowerCase(); }
  function isBlank(v) {
    return v === null || v === undefined || v === '' ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function toMs(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    var t = Date.parse(v);
    return isNaN(t) ? null : t;
  }

  // ------------------------------------------------------------- field model
  // Only fields that genuinely exist on a LeadForge lead are first-class.
  // Anything else must come through `custom.<key>` so a rule can never silently
  // evaluate against a field the schema does not have.
  var FIELDS = {
    leadSource:        function (l) { return str(l.source); },
    industry:          function (l) { return str(l.industry); },
    country:           function (l) { return str(l.country); },
    city:              function (l) { return str(l.city); },
    company:           function (l) { return str(l.company); },
    email:             function (l) { return str(l.email); },
    phone:             function (l) { return str(l.phone); },
    name:              function (l) { return str(l.name); },
    notes:             function (l) { return str(l.notes); },
    stage:             function (l) { return str(l.stage); },
    ownerId:           function (l) { return str(l.ownerId); },
    amount:            function (l) { return num(l.amount); },
    currentScore:      function (l) { return num(l.score); },
    tags:              function (l) { return Array.isArray(l.tags) ? l.tags : []; },
    serviceId:         function (l) { return str((l.serviceInterest || {}).serviceId); },
    domainId:          function (l) { return str((l.serviceInterest || {}).domainId); },
    emailConsent:      function (l) { return !!(l.consent || {}).email; },
    hasPhone:          function (l) { return !isBlank(l.phone); },
    hasEmail:          function (l) { return !isBlank(l.email); },
    activityCount:     function (l) { return acts(l).length; },
    realActivityCount: function (l) { return acts(l).filter(function (a) { return a.type !== 'create'; }).length; },
    lastActivityAt:    function (l) { return lastTouch(l); },
    createdAt:         function (l) { return toMs(l.createdAt); },
    daysSinceCreated:  function (l, ctx) { var t = toMs(l.createdAt); return t === null ? null : Math.floor((ctx.now - t) / DAY); },
    daysSinceLastTouch:function (l, ctx) { var t = lastTouch(l); return t === null ? null : Math.floor((ctx.now - t) / DAY); },
    isQualified:       function (l) { return hasQual(l, 'qualified'); },
    isDisqualified:    function (l) { return hasQual(l, 'disqualified'); }
  };

  function acts(l) { return Array.isArray(l.activities) ? l.activities.filter(Boolean) : []; }
  function lastTouch(l) {
    var t = toMs(l.updatedAt);
    var a = acts(l).map(function (x) { return toMs(x.at); }).filter(function (x) { return x !== null; });
    var maxAct = a.length ? Math.max.apply(null, a) : null;
    if (t === null) return maxAct !== null ? maxAct : toMs(l.createdAt);
    return maxAct !== null ? Math.max(t, maxAct) : t;
  }
  function hasQual(l, status) {
    var q = l.qualifications || {};
    return Object.keys(q).some(function (k) { return q[k] && q[k].status === status; });
  }

  // activityCount:<type> — touchpoint counting (spec §10), optionally windowed
  // by the rule's own `withinDays`.
  function resolveField(lead, path, ctx) {
    if (FIELDS[path]) return FIELDS[path](lead, ctx);
    var m = /^activityCount:(.+)$/.exec(path);
    if (m) {
      var want = m[1].toLowerCase();
      return acts(lead).filter(function (a) { return lower(a.type) === want; }).length;
    }
    m = /^activityCountWithin:([^:]+):(\d+)$/.exec(path);
    if (m) {
      var t2 = m[1].toLowerCase(), days = parseInt(m[2], 10);
      var cutoff = ctx.now - days * DAY;
      return acts(lead).filter(function (a) {
        var at = toMs(a.at);
        return lower(a.type) === t2 && at !== null && at >= cutoff;
      }).length;
    }
    if (path.indexOf('custom.') === 0) {
      var key = path.slice(7);
      var bag = lead.custom || lead.customFields || {};
      return bag[key];
    }
    return undefined; // unknown field — never throws, never silently scores
  }

  // ---------------------------------------------------------------- operators
  var OPERATORS = {
    equals:        function (a, b) { return typeof a === 'number' ? a === num(b) : lower(a) === lower(b); },
    notEquals:     function (a, b) { return !OPERATORS.equals(a, b); },
    contains:      function (a, b) { return Array.isArray(a) ? a.map(lower).indexOf(lower(b)) !== -1 : lower(a).indexOf(lower(b)) !== -1; },
    notContains:   function (a, b) { return !OPERATORS.contains(a, b); },
    startsWith:    function (a, b) { return lower(a).indexOf(lower(b)) === 0; },
    endsWith:      function (a, b) { var s = lower(a), t = lower(b); return t.length <= s.length && s.lastIndexOf(t) === s.length - t.length; },
    greaterThan:   function (a, b) { return a !== null && a !== undefined && num(a) > num(b); },
    lessThan:      function (a, b) { return a !== null && a !== undefined && num(a) < num(b); },
    gte:           function (a, b) { return a !== null && a !== undefined && num(a) >= num(b); },
    lte:           function (a, b) { return a !== null && a !== undefined && num(a) <= num(b); },
    between:       function (a, b) { var r = Array.isArray(b) ? b : [];
                                     return a !== null && a !== undefined && num(a) >= num(r[0]) && num(a) <= num(r[1]); },
    isEmpty:       function (a) { return isBlank(a); },
    isNotEmpty:    function (a) { return !isBlank(a); },
    isTrue:        function (a) { return a === true; },
    isFalse:       function (a) { return a === false; },
    inList:        function (a, b) { return (Array.isArray(b) ? b : []).map(lower).indexOf(lower(a)) !== -1; },
    notInList:     function (a, b) { return !OPERATORS.inList(a, b); },
    // date / recency — all relative to ctx.now, never to a hidden Date.now()
    withinDays:    function (a, b, ctx) { var t = toMs(a); return t !== null && (ctx.now - t) <= num(b) * DAY && t <= ctx.now; },
    olderThanDays: function (a, b, ctx) { var t = toMs(a); return t !== null && (ctx.now - t) > num(b) * DAY; },
    before:        function (a, b) { var t = toMs(a), u = toMs(b); return t !== null && u !== null && t < u; },
    after:         function (a, b) { var t = toMs(a), u = toMs(b); return t !== null && u !== null && t > u; }
  };

  // ------------------------------------------------------- condition matching
  function testCondition(lead, cond, ctx) {
    var op = OPERATORS[cond.operator];
    if (!op) return false;                       // unknown operator never matches
    var actual = resolveField(lead, cond.field, ctx);
    if (actual === undefined && cond.operator !== 'isEmpty') return false;
    try { return !!op(actual, cond.value, ctx); } catch (e) { return false; }
  }

  // A group is {logic:'AND'|'OR', conditions:[cond | group]} and nests freely.
  function evaluateGroup(lead, group, ctx) {
    if (!group) return true;
    if (group.field) return testCondition(lead, group, ctx);   // bare condition
    var list = Array.isArray(group.conditions) ? group.conditions : [];
    if (!list.length) return true;
    var logic = (group.logic || 'AND').toUpperCase();
    if (logic === 'OR') return list.some(function (c) { return evaluateGroup(lead, c, ctx); });
    return list.every(function (c) { return evaluateGroup(lead, c, ctx); });
  }

  // ------------------------------------------------------------- rule support
  function ruleActive(rule, ctx) {
    if (rule.status && rule.status !== 'active') return false;
    if (rule.enabled === false) return false;
    var from = toMs(rule.effectiveFrom), to = toMs(rule.effectiveTo);
    if (from !== null && ctx.now < from) return false;
    if (to !== null && ctx.now > to) return false;
    return true;
  }

  // Frequency + caps (spec §18/§19). priorEvents lets a live system honour
  // "once", "once per day" and lifetime caps; a from-scratch recalculation
  // passes none and every matching rule contributes exactly once.
  function allowance(rule, ctx) {
    var f = rule.frequency || {};
    var mode = f.mode || 'once';
    var prior = (ctx.priorEvents || []).filter(function (e) { return e.ruleId === rule.id; });
    var basePoints = num(rule.points);

    if (mode === 'once' && prior.length) return 0;
    if (mode === 'perDay') {
      var dayStart = ctx.now - (ctx.now % DAY);
      if (prior.some(function (e) { return toMs(e.occurredAt) >= dayStart; })) return 0;
    }
    if (mode === 'maxN' && prior.length >= num(f.maxTimes)) return 0;

    if (f.maxPoints !== undefined && f.maxPoints !== null) {
      var used = prior.reduce(function (a, e) { return a + Math.abs(num(e.points)); }, 0);
      var room = num(f.maxPoints) - used;
      if (room <= 0) return 0;
      return Math.min(Math.abs(basePoints), room) * (basePoints < 0 ? -1 : 1);
    }
    return basePoints;
  }

  function validateRule(rule) {
    var errs = [];
    if (!rule || !rule.id) errs.push('rule.id is required');
    if (!rule.name) errs.push('rule.name is required');
    if (CATEGORIES.indexOf(rule.category) === -1 && rule.category !== 'negative')
      errs.push('rule.category must be one of ' + CATEGORIES.concat('negative').join(', '));
    if (['add', 'subtract', 'set', 'cap'].indexOf(rule.action || 'add') === -1)
      errs.push('rule.action must be add|subtract|set|cap');
    if (typeof rule.points !== 'number') errs.push('rule.points must be a number');
    (function walk(g, depth) {
      if (!g || depth > 10) return;
      if (g.field) {
        if (!OPERATORS[g.operator]) errs.push('unknown operator: ' + g.operator);
        if (!FIELDS[g.field] && g.field.indexOf('custom.') !== 0 && !/^activityCount(Within)?:/.test(g.field))
          errs.push('unknown field: ' + g.field);
        return;
      }
      (g.conditions || []).forEach(function (c) { walk(c, depth + 1); });
    }(rule.conditions, 0));
    return { valid: errs.length === 0, errors: errs };
  }

  // ------------------------------------------------------------------ scoring
  function defaultModel() {
    return {
      id: 'default', name: 'Default Lead Scoring', version: '1.0.0', status: 'active',
      scoreRange: { min: 0, max: 100 },
      weights: { fit: 0.25, engagement: 0.20, intent: 0.25, behavior: 0.10, source: 0.05, qualification: 0.15 },
      categoryMax: { fit: 100, engagement: 100, intent: 100, behavior: 100, source: 100, qualification: 100 },
      categoryCap: {},   // optional hard ceilings on raw points, per category
      rules: [], thresholds: defaultThresholds(), gates: [], disqualifiers: []
    };
  }
  function defaultThresholds() {
    return [
      { tier: 'unqualified', min: 0,  max: 20,  label: 'Unqualified' },
      { tier: 'cold',        min: 21, max: 40,  label: 'Cold' },
      { tier: 'warm',        min: 41, max: 60,  label: 'Warm' },
      { tier: 'qualified',   min: 61, max: 80,  label: 'Qualified' },
      { tier: 'hot',         min: 81, max: 100, label: 'Hot / Sales Ready' }
    ];
  }

  /**
   * evaluate(lead, model, ctx) — the authoritative calculation.
   * ctx: { now?, priorEvents?, ai?, override? }
   * Returns a fully attributed result; never touches `lead`.
   */
  function evaluate(lead, model, ctx) {
    ctx = ctx || {};
    ctx.now = ctx.now === undefined ? Date.now() : ctx.now;
    model = model || defaultModel();
    var range = model.scoreRange || { min: 0, max: 100 };
    var weights = model.weights || defaultModel().weights;
    // categoryMax = the raw total that counts as 100% of a category (the
    // normalisation denominator). categoryCap = an optional HARD ceiling on raw
    // points (spec §19). They are separate: conflating them meant lowering a cap
    // raised the normalised score, because the denominator shrank with it.
    var catMax = model.categoryMax || defaultModel().categoryMax;
    var catCap = model.categoryCap || {};

    var raw = {}; CATEGORIES.forEach(function (c) { raw[c] = 0; });
    var negative = 0;
    var matchedRules = [], events = [], setScore = null, capScore = null;

    var rules = (model.rules || [])
      .slice()
      .sort(function (a, b) { return num(a.priority) - num(b.priority); });

    rules.forEach(function (rule) {
      if (!ruleActive(rule, ctx)) return;
      if (!evaluateGroup(lead, rule.conditions, ctx)) return;

      var pts = allowance(rule, ctx);
      var action = rule.action || 'add';
      if (action !== 'set' && action !== 'cap' && pts === 0) return; // capped out

      var ev = {
        ruleId: rule.id, ruleName: rule.name, category: rule.category,
        action: action, points: pts, direction: (action === 'subtract' || pts < 0) ? 'negative' : 'positive',
        reason: rule.description || rule.name,
        triggeringEvent: ctx.triggeringEvent || 'recalculation',
        occurredAt: ctx.now,
        modelId: model.id, modelVersion: model.version
      };

      if (action === 'set')      { setScore = num(rule.points); }
      else if (action === 'cap') { capScore = capScore === null ? num(rule.points) : Math.min(capScore, num(rule.points)); }
      else if (action === 'subtract' || rule.category === 'negative') {
        negative += Math.abs(pts);
        ev.points = -Math.abs(pts); ev.direction = 'negative';
      } else {
        raw[rule.category] = (raw[rule.category] || 0) + pts;
      }
      matchedRules.push(rule.id);
      events.push(ev);
    });

    // Category caps, then weighted normalisation to the model's range.
    var components = [], weightedPct = 0;
    CATEGORIES.forEach(function (c) {
      var max = num(catMax[c]) || 100;
      var cap = catCap[c] === undefined || catCap[c] === null ? max : num(catCap[c]);
      var capped = clamp(raw[c], 0, cap);
      var pct = max > 0 ? clamp(capped / max, 0, 1) : 0;
      var w = num(weights[c]);
      weightedPct += pct * w;
      components.push({ category: c, raw: raw[c], capped: capped, cap: cap, max: max,
                        weight: w, weighted: +(pct * w * range.max).toFixed(2) });
    });

    var base = weightedPct * range.max;
    var systemScore = clamp(Math.round(base - negative), range.min, range.max);
    if (setScore !== null) systemScore = clamp(Math.round(setScore), range.min, range.max);
    if (capScore !== null) systemScore = Math.min(systemScore, clamp(Math.round(capScore), range.min, range.max));

    // Manual override (spec §46) — the system score is never erased.
    var override = ctx.override || null;
    var effectiveScore = override && typeof override.score === 'number'
      ? clamp(Math.round(override.score), range.min, range.max) : systemScore;

    // AI is advisory and never required (spec §11/§54).
    var ai = (ctx.ai && ctx.ai.available)
      ? { available: true, score: ctx.ai.score, confidence: ctx.ai.confidence, factors: ctx.ai.factors || [] }
      : { available: false, reason: ctx.ai && ctx.ai.reason ? ctx.ai.reason : 'insufficient_historical_data' };

    var result = {
      leadId: lead.id,
      modelId: model.id, modelVersion: model.version, engineVersion: ENGINE_VERSION,
      calculatedAt: ctx.now,
      systemScore: systemScore,
      overrideScore: override && typeof override.score === 'number' ? effectiveScore : null,
      totalScore: effectiveScore,
      fitScore: raw.fit, engagementScore: raw.engagement, intentScore: raw.intent,
      behaviorScore: raw.behavior, sourceScore: raw.source, qualificationScore: raw.qualification,
      negativeScore: -negative,
      scoreComponents: components,
      matchedRules: matchedRules,
      events: events,
      ai: ai
    };
    result.qualification = qualify(lead, result, model, ctx);
    return result;
  }

  /**
   * Qualification is decided separately from the score (spec §5/§20–23).
   * Precedence, per spec §71: hard disqualifier → manual override → gates → thresholds.
   */
  function qualify(lead, result, model, ctx) {
    ctx = ctx || {}; ctx.now = ctx.now === undefined ? Date.now() : ctx.now;
    var reasons = [];

    // 1. hard disqualifiers override everything, score included
    var dq = (model.disqualifiers || []).filter(function (d) { return d.enabled !== false; });
    for (var i = 0; i < dq.length; i++) {
      if (evaluateGroup(lead, dq[i].condition || dq[i].conditions, ctx)) {
        return {
          status: 'disqualified', tier: 'disqualified', label: 'Disqualified',
          qualified: false, overriddenBy: 'hard_disqualifier',
          reasons: [{ type: 'disqualifier', id: dq[i].id, message: dq[i].reason || dq[i].name }]
        };
      }
    }

    // 2. mandatory gates — a high score alone must not qualify a lead (spec §22)
    var failed = (model.gates || []).filter(function (g) {
      return g.enabled !== false && !evaluateGroup(lead, g.condition || g.conditions, ctx);
    });

    // 3. threshold tier on the effective score
    var score = result.totalScore;
    var tiers = model.thresholds && model.thresholds.length ? model.thresholds : defaultThresholds();
    var hit = tiers.filter(function (t) { return score >= num(t.min) && score <= num(t.max); })[0] || tiers[0];
    reasons.push({ type: 'threshold', message: 'Score ' + score + ' falls in ' + hit.label + ' (' + hit.min + '–' + hit.max + ')' });

    if (failed.length) {
      failed.forEach(function (g) {
        reasons.push({ type: 'gate', id: g.id, message: g.message || (g.name + ' not satisfied') });
      });
      return {
        status: model.gateFailStatus || 'nurture',
        tier: hit.tier, label: 'Gate not met', qualified: false,
        overriddenBy: 'qualification_gate', reasons: reasons
      };
    }

    var qualifiedTiers = model.qualifiedTiers || ['qualified', 'hot'];
    return {
      status: hit.tier, tier: hit.tier, label: hit.label,
      qualified: qualifiedTiers.indexOf(hit.tier) !== -1,
      overriddenBy: null, reasons: reasons
    };
  }

  /** Human-readable attribution (spec §24/§25). */
  function explain(result) {
    var pos = result.events.filter(function (e) { return e.direction === 'positive'; })
      .sort(function (a, b) { return b.points - a.points; });
    var neg = result.events.filter(function (e) { return e.direction === 'negative'; })
      .sort(function (a, b) { return a.points - b.points; });
    return {
      total: result.totalScore,
      systemScore: result.systemScore,
      overridden: result.overrideScore !== null,
      positive: pos.map(function (e) { return { points: e.points, reason: e.reason, category: e.category, ruleId: e.ruleId }; }),
      negative: neg.map(function (e) { return { points: e.points, reason: e.reason, category: e.category, ruleId: e.ruleId }; }),
      components: result.scoreComponents,
      qualification: result.qualification,
      modelVersion: result.modelId + '@' + result.modelVersion
    };
  }

  /**
   * dryRun — spec §7 / STEP 7. Computes what a migration WOULD do.
   * Commits nothing and mutates nothing.
   */
  function dryRun(leads, model, ctx) {
    ctx = ctx || {}; ctx.now = ctx.now === undefined ? Date.now() : ctx.now;
    var rows = [], band = function (s) { return s <= 20 ? '0-20' : s <= 40 ? '21-40' : s <= 60 ? '41-60' : s <= 80 ? '61-80' : '81-100'; };
    var before = {}, after = {}, tierAfter = {};
    ['0-20', '21-40', '41-60', '61-80', '81-100'].forEach(function (b) { before[b] = 0; after[b] = 0; });

    leads.forEach(function (l) {
      var r = evaluate(l, model, { now: ctx.now });
      var old = num(l.score);
      rows.push({ id: l.id, name: l.name, oldScore: old, newScore: r.totalScore, delta: r.totalScore - old,
                  newTier: r.qualification.tier, qualified: r.qualification.qualified });
      before[band(old)]++; after[band(r.totalScore)]++;
      tierAfter[r.qualification.tier] = (tierAfter[r.qualification.tier] || 0) + 1;
    });

    var withScores = rows.filter(function (r) { return r.oldScore > 0; });
    var avg = function (a, k) { return a.length ? +(a.reduce(function (s, r) { return s + r[k]; }, 0) / a.length).toFixed(1) : 0; };
    return {
      committed: false,
      totalLeads: rows.length,
      leadsWithExistingScore: withScores.length,
      avgOldScore: avg(rows, 'oldScore'),
      avgNewScore: avg(rows, 'newScore'),
      distributionBefore: before,
      distributionAfter: after,
      qualificationAfter: tierAfter,
      largestChanges: rows.slice().sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).slice(0, 20),
      rows: rows
    };
  }

  return {
    ENGINE_VERSION: ENGINE_VERSION,
    CATEGORIES: CATEGORIES, FIELDS: FIELDS, OPERATORS: OPERATORS,
    resolveField: resolveField, testCondition: testCondition, evaluateGroup: evaluateGroup,
    validateRule: validateRule, allowance: allowance,
    defaultModel: defaultModel, defaultThresholds: defaultThresholds,
    evaluate: evaluate, qualify: qualify, explain: explain, dryRun: dryRun
  };
}));
