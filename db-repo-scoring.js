/**
 * LeadForge 360 — Supabase repository for the scoring subsystem (schema v3).
 * Implements the interface scoring-service.js depends on. Every query is
 * tenant-scoped; nothing here can read across tenants.
 *
 * Kept in its own file so db-repo.js (the v2 lead/task/subvendor layer) is not
 * touched by this phase.
 */
const TENANT_COL = 'tenant_id';

module.exports = function makeScoringRepo(supabase, TENANT) {
  const q  = (t, tenantId) => supabase.from(t).select('*').eq(TENANT_COL, tenantId);
  const ms = ts => (ts == null ? null : (typeof ts === 'number' ? ts : Date.parse(ts)));
  const iso = v => (v == null ? null : (typeof v === 'number' ? new Date(v).toISOString() : v));

  // Rebuild a rule's nested condition tree from scoring_rule_conditions rows.
  // These rows are the system of record — there is no cached JSON copy to drift.
  function buildTree(rows, parentId) {
    const kids = rows.filter(r => (r.parent_id || null) === (parentId || null))
                     .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    return kids.map(r => r.node_type === 'group'
      ? { logic: r.logic || 'AND', conditions: buildTree(rows, r.id) }
      : { field: r.field, operator: r.operator, value: r.value });
  }

  async function assembleModel(tenantId, row, ruleRows, condRows, actionRows) {
    const rules = ruleRows.filter(r => r.scoring_model_id === row.id).map(r => {
      const mine = condRows.filter(c => c.rule_id === r.id);
      const roots = buildTree(mine, null);
      const primary = actionRows.filter(a => a.rule_id === r.id).sort((a, b) => (a.sort || 0) - (b.sort || 0))[0];
      return {
        id: r.id, name: r.name, description: r.description, category: r.category,
        priority: r.priority, status: r.active ? 'active' : 'inactive',
        action: primary ? primary.action_type : 'add',
        points: primary && primary.points != null ? Number(primary.points) : Number(r.points || 0),
        frequency: { mode: r.frequency_mode || 'once', maxTimes: r.max_times,
                     maxPoints: r.lifetime_cap != null ? Number(r.lifetime_cap) : (r.max_points != null ? Number(r.max_points) : undefined) },
        effectiveFrom: ms(r.effective_from), effectiveTo: ms(r.effective_to),
        version: r.version, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
        conditions: roots.length === 1 ? roots[0] : { logic: r.logic || 'AND', conditions: roots }
      };
    });
    return {
      id: row.id, tenantId: row.tenant_id, name: row.name, description: row.description,
      version: row.version, status: row.status,
      scoreRange: row.score_range, weights: row.weights,
      categoryMax: row.category_max, categoryCap: row.category_cap,
      thresholds: Array.isArray(row.thresholds) && row.thresholds.length ? row.thresholds : undefined,
      qualifiedTiers: row.qualified_tiers, gateFailStatus: row.gate_fail_status,
      gates: [], disqualifiers: [],   // sourced from rules with qualify/disqualify actions
      rules
    };
  }

  async function loadModelRow(tenantId, row) {
    if (!row) return null;
    const [rules, conds, actions] = await Promise.all([
      q('scoring_rules_v2', tenantId).eq('scoring_model_id', row.id),
      q('scoring_rule_conditions', tenantId),
      q('scoring_rule_actions', tenantId)
    ]);
    const model = await assembleModel(tenantId, row, rules.data || [], conds.data || [], actions.data || []);
    // qualify / disqualify actions become gates and disqualifiers
    (actions.data || []).forEach(a => {
      const rule = model.rules.find(r => r.id === a.rule_id);
      if (!rule) return;
      if (a.action_type === 'disqualify') model.disqualifiers.push({ id: a.id, name: rule.name, reason: a.reason || rule.name, condition: rule.conditions });
      if (a.action_type === 'qualify')    model.gates.push({ id: a.id, name: rule.name, message: a.reason || rule.name, condition: rule.conditions });
    });
    model.rules = model.rules.filter(r => ['add', 'subtract', 'set', 'cap'].indexOf(r.action) !== -1);
    return model;
  }

  return {
    async getLead(tenantId, id) {
      // Tenant predicate at the QUERY, not only in the service above it —
       // defence in depth against IDOR.
      const { data } = await supabase.from('leads').select('*, lead_activities(*)')
        .eq('id', id).eq(TENANT_COL, tenantId).maybeSingle();
      if (!data) return null;
      return {
        id: data.id, tenantId: data.tenant_id, name: data.name, email: data.email, phone: data.phone,
        company: data.company, industry: data.industry, city: data.city, country: data.country,
        source: data.source, ownerId: data.owner_id, stage: data.stage, score: Number(data.score || 0),
        amount: Number(data.amount || 0), notes: data.notes, tags: data.tags || [],
        consent: data.consent || {}, qualifications: data.qualifications || {},
        serviceInterest: (data.service_domain_id || data.service_id)
          ? { domainId: data.service_domain_id, serviceId: data.service_id } : null,
        activities: (data.lead_activities || []).map(a => ({ type: a.type, at: ms(a.at), by: a.actor_id, text: a.note })),
        createdAt: ms(data.created_at), updatedAt: ms(data.updated_at)
      };
    },

    async listLeads(tenantId, f) {
      f = f || {};
      let sel = supabase.from('leads').select('*, lead_activities(*)').eq(TENANT_COL, tenantId)
        .order('created_at', { ascending: true })
        .range(f.offset || 0, (f.offset || 0) + (f.limit || 200) - 1);
      if (f.stage) sel = sel.eq('stage', f.stage);
      const { data, error } = await sel;
      if (error) throw new Error('listLeads: ' + error.message);
      const self = this;
      return (data || []).map(d => ({
        id: d.id, tenantId: d.tenant_id, name: d.name, email: d.email, phone: d.phone,
        company: d.company, industry: d.industry, city: d.city, country: d.country,
        source: d.source, ownerId: d.owner_id, stage: d.stage, score: Number(d.score || 0),
        amount: Number(d.amount || 0), notes: d.notes, tags: d.tags || [],
        consent: d.consent || {}, qualifications: d.qualifications || {},
        serviceInterest: (d.service_domain_id || d.service_id) ? { domainId: d.service_domain_id, serviceId: d.service_id } : null,
        activities: (d.lead_activities || []).map(a => ({ type: a.type, at: ms(a.at), by: a.actor_id, text: a.note })),
        createdAt: ms(d.created_at), updatedAt: ms(d.updated_at)
      }));
    },

    async getActiveModel(tenantId) {
      const { data } = await q('scoring_models', tenantId).eq('status', 'active')
        .order('priority', { ascending: false }).limit(1);
      return loadModelRow(tenantId, (data || [])[0]);
    },
    async listModels(tenantId) {
      const { data } = await q('scoring_models', tenantId).order('priority', { ascending: false });
      return (data || []).map(m => ({ id: m.id, name: m.name, version: m.version, status: m.status,
        description: m.description, updatedAt: ms(m.updated_at) }));
    },
    async getModel(tenantId, id) {
      const { data } = await supabase.from('scoring_models').select('*')
        .eq('id', id).eq(TENANT_COL, tenantId).maybeSingle();
      return loadModelRow(tenantId, data);
    },
    async saveModel(tenantId, m) {
      // Guard before upsert: never let an id collision overwrite another
      // tenant's model.
      const clash = await supabase.from('scoring_models').select('tenant_id').eq('id', m.id).maybeSingle();
      if (clash.data && clash.data.tenant_id && clash.data.tenant_id !== tenantId) {
        const e = new Error('cross-tenant model id conflict'); e.code = 'CROSS_TENANT'; throw e;
      }
      const { error } = await supabase.from('scoring_models').upsert({
        id: m.id, tenant_id: tenantId, name: m.name, description: m.description,
        version: m.version, status: m.status, score_range: m.scoreRange, weights: m.weights,
        category_max: m.categoryMax, category_cap: m.categoryCap || {},
        thresholds: m.thresholds || [], qualified_tiers: m.qualifiedTiers || ['qualified', 'hot'],
        gate_fail_status: m.gateFailStatus || 'nurture', updated_by: m.updatedBy || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
      if (error) throw new Error('saveModel: ' + error.message);
    },
    async setModelStatus(tenantId, id, status) {
      const { error } = await supabase.from('scoring_models').update({ status, updated_at: new Date().toISOString() })
        .eq('id', id).eq(TENANT_COL, tenantId);
      if (error) throw new Error('setModelStatus: ' + error.message);
    },

    async getLeadScore(tenantId, leadId, modelId) {
      const { data } = await supabase.from('lead_scores').select('*')
        .eq('lead_id', leadId).eq('scoring_model_id', modelId).eq(TENANT_COL, tenantId).maybeSingle();
      if (!data) return null;
      return { leadId: data.lead_id, tenantId: data.tenant_id, scoringModelId: data.scoring_model_id,
        modelVersion: data.model_version, totalScore: Number(data.total_score), systemScore: Number(data.system_score),
        overrideScore: data.override_score == null ? null : Number(data.override_score),
        qualificationStatus: data.qualification_status, qualificationReasons: data.qualification_reasons || [],
        calculatedAt: ms(data.calculated_at) };
    },
    /** Bulk fetch, chunked to stay under URL length limits on .in() filters. */
    async listLeadScores(tenantId, modelId, leadIds) {
      const out = {};
      const CHUNK = 200;
      for (let i = 0; i < (leadIds || []).length; i += CHUNK) {
        const slice = leadIds.slice(i, i + CHUNK);
        const { data, error } = await supabase.from('lead_scores')
          .select('lead_id,total_score,qualification_status,model_version')
          .eq(TENANT_COL, tenantId).eq('scoring_model_id', modelId).in('lead_id', slice);
        if (error) throw new Error('listLeadScores: ' + error.message);
        (data || []).forEach(d => { out[d.lead_id] = {
          leadId: d.lead_id, totalScore: Number(d.total_score),
          qualificationStatus: d.qualification_status, modelVersion: d.model_version }; });
      }
      return out;
    },
    async saveLeadScore(tenantId, r) {
      const { error } = await supabase.from('lead_scores').upsert({
        lead_id: r.leadId, tenant_id: tenantId, scoring_model_id: r.scoringModelId,
        model_version: r.modelVersion, engine_version: r.engineVersion,
        total_score: r.totalScore, system_score: r.systemScore, override_score: r.overrideScore,
        fit_score: r.fitScore, engagement_score: r.engagementScore, intent_score: r.intentScore,
        behavior_score: r.behaviorScore, source_score: r.sourceScore, qualification_score: r.qualificationScore,
        positive_score: r.positiveScore, negative_score: r.negativeScore, touchpoint_score: r.touchpointScore,
        qualification_status: r.qualificationStatus, qualification_reasons: r.qualificationReasons,
        conversion_probability: r.conversionProbability, confidence: r.confidence,
        calculated_at: iso(r.calculatedAt)
      }, { onConflict: 'lead_id,scoring_model_id' });
      if (error) throw new Error('saveLeadScore: ' + error.message);
    },
    async replaceComponents(tenantId, leadId, modelId, rows) {
      await supabase.from('lead_score_components').delete()
        .eq('lead_id', leadId).eq('scoring_model_id', modelId).eq(TENANT_COL, tenantId);
      if (!rows.length) return;
      const { error } = await supabase.from('lead_score_components').insert(rows.map(r => ({
        lead_id: r.leadId, tenant_id: tenantId, scoring_model_id: r.scoringModelId, model_version: r.modelVersion,
        rule_id: r.ruleId, rule_name: r.ruleName, category: r.category, points_awarded: r.pointsAwarded,
        matched: r.matched, direction: r.direction, reason: r.reason, calculated_at: iso(r.calculatedAt)
      })));
      if (error) throw new Error('replaceComponents: ' + error.message);
    },
    async hasScoreEvent(tenantId, eventId) {
      const { data } = await supabase.from('lead_score_events').select('id')
        .eq(TENANT_COL, tenantId).eq('event_id', eventId).limit(1);
      return !!(data && data.length);
    },
    async appendScoreEvent(tenantId, r) {
      const { error } = await supabase.from('lead_score_events').insert({
        lead_id: r.leadId, tenant_id: tenantId, event_type: r.eventType, source: r.source,
        event_id: r.eventId, previous_score: r.previousScore, score_delta: r.scoreDelta,
        new_score: r.newScore, scoring_model_id: r.scoringModelId, model_version: r.modelVersion,
        created_at: iso(r.createdAt)
      });
      // A unique-violation here means a concurrent request already scored this
      // event — that is the idempotency guard working, not a failure.
      if (error && !/duplicate key|unique/i.test(error.message)) throw new Error('appendScoreEvent: ' + error.message);
    },
    async appendHistory(tenantId, r) {
      const { error } = await supabase.from('score_history').insert({
        lead_id: r.leadId, tenant_id: tenantId, scoring_model_id: r.scoringModelId,
        model_version: r.modelVersion, total_score: r.totalScore, components: r.components,
        qualification_status: r.qualificationStatus, legacy: !!r.legacy, calculated_at: iso(r.calculatedAt)
      });
      if (error) throw new Error('appendHistory: ' + error.message);
    },
    async hasLegacySnapshot(tenantId, leadId) {
      const { data } = await supabase.from('score_history').select('id')
        .eq('lead_id', leadId).eq(TENANT_COL, tenantId).eq('legacy', true).limit(1);
      return !!(data && data.length);
    },
    async listHistory(tenantId, leadId, limit) {
      const { data } = await supabase.from('score_history').select('*')
        .eq('lead_id', leadId).eq(TENANT_COL, tenantId)
        .order('calculated_at', { ascending: false }).limit(limit || 50);
      return (data || []).map(h => ({ leadId: h.lead_id, totalScore: Number(h.total_score),
        modelVersion: h.model_version, qualificationStatus: h.qualification_status,
        components: h.components, legacy: h.legacy, calculatedAt: ms(h.calculated_at) }));
    },
    async appendQualificationEvent(tenantId, r) {
      const { error } = await supabase.from('qualification_events').insert({
        lead_id: r.leadId, tenant_id: tenantId, from_status: r.fromStatus, to_status: r.toStatus,
        reason: r.reason, triggering_rule: r.triggeringRule, score_at_event: r.scoreAtEvent,
        scoring_model_id: r.scoringModelId, model_version: r.modelVersion, actor: r.actor,
        created_at: iso(r.createdAt)
      });
      if (error) throw new Error('appendQualificationEvent: ' + error.message);
    },
    async appendAudit(tenantId, r) {
      await supabase.from('score_audit_logs').insert({
        tenant_id: tenantId, actor: r.actor, action: r.action, entity_type: r.entityType,
        entity_id: r.entityId, before_val: r.beforeVal, after_val: r.afterVal,
        reason: r.reason, created_at: iso(r.createdAt)
      });
    },
    async listPriorEvents(tenantId, leadId) {
      const { data } = await supabase.from('lead_score_components').select('rule_id,points_awarded,calculated_at')
        .eq('lead_id', leadId).eq(TENANT_COL, tenantId);
      return (data || []).map(c => ({ ruleId: c.rule_id, points: Number(c.points_awarded), occurredAt: ms(c.calculated_at) }));
    },
    async getActiveOverride(tenantId, leadId) {
      const { data } = await supabase.from('lead_score_overrides').select('*')
        .eq('lead_id', leadId).eq(TENANT_COL, tenantId).eq('active', true)
        .order('created_at', { ascending: false }).limit(1);
      const o = (data || [])[0];
      return o ? { leadId: o.lead_id, systemScore: Number(o.system_score), overrideScore: Number(o.override_score),
                   reason: o.reason, actor: o.actor } : null;
    },
    async saveOverride(tenantId, rec) {
      await supabase.from('lead_score_overrides').update({ active: false })
        .eq('lead_id', rec.leadId).eq(TENANT_COL, tenantId).eq('active', true);
      const { error } = await supabase.from('lead_score_overrides').insert({
        lead_id: rec.leadId, tenant_id: tenantId, system_score: rec.systemScore,
        override_score: rec.overrideScore, reason: rec.reason, actor: rec.actor,
        active: true, created_at: iso(rec.createdAt)
      });
      if (error) throw new Error('saveOverride: ' + error.message);
    }
  };
};
