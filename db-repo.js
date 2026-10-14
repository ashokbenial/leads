/**
 * LeadForge 360 — relational data-access layer (schema v2).
 * ----------------------------------------------------------
 * db-server.js talks to Supabase ONLY through this module.
 *
 * Two responsibilities:
 *   1. assembleState()  — rebuild the whole workspace *document* from the 18
 *      tables, in the exact camelCase shape db-server.js's /api/snapshot
 *      serialization already expects. This keeps every client READ unchanged.
 *   2. per-record writers — createLead / updateLead / deleteLead / addActivity,
 *      tasks, subvendors, settings, … — each an atomic single-row write. This
 *      is what stops concurrent edits from clobbering each other: one person's
 *      lead is one INSERT/UPDATE, never a whole-document overwrite.
 *
 * The old `leadforge_state` JSONB row is NOT touched here — it stays as the
 * rollback copy until the migration is verified in production.
 */
const TENANT = 'ab7-solutions';

// epoch-millis <-> timestamptz helpers (the client works in millis)
const toMs = ts => (ts == null) ? undefined : (typeof ts === 'number' ? ts : (isNaN(Date.parse(ts)) ? undefined : Date.parse(ts)));
const toIso = ms => (ms == null || ms === '') ? null : (typeof ms === 'number' ? new Date(ms).toISOString() : (isNaN(Date.parse(ms)) ? null : new Date(ms).toISOString()));
const nowIso = () => new Date().toISOString();

// Retry transient failures — network blips and the "JWT issued at future"
// clock-skew hiccup that hits freshly-created keys across distributed edge
// nodes. Bounded, and only for clearly-transient errors so real failures still
// surface immediately.
async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const msg = (e && e.message) || '';
      if (!/JWT|issued at future|fetch failed|ETIMEDOUT|ECONNRESET|timeout|503|502/i.test(msg) || i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw last;
}

module.exports = function makeRepo(supabase) {

  // ---- ROW -> DOCUMENT mappers (DB shape -> client camelCase) --------------

  function leadRowToDoc(r, acts) {
    return {
      id: r.id, firstName: r.first_name, lastName: r.last_name, name: r.name,
      email: r.email, phone: r.phone, company: r.company, industry: r.industry,
      city: r.city, country: r.country, source: r.source, ownerId: r.owner_id,
      stage: r.stage, score: r.score, amount: r.amount == null ? 0 : Number(r.amount),
      currency: 'INR', notes: r.notes,
      serviceInterest: (r.service_domain_id || r.service_id)
        ? { domainId: r.service_domain_id, serviceId: r.service_id } : null,
      tags: r.tags || [], consent: r.consent || {}, visibility: r.visibility || { mode: 'all', users: [] },
      outcome: r.outcome || {}, qualifications: r.qualifications || {}, actionPlan: r.action_plan,
      activities: (acts || []).map(a => ({ at: toMs(a.at), by: a.actor_id, type: a.type, text: a.note })),
      createdAt: toMs(r.created_at), updatedAt: toMs(r.updated_at)
    };
  }

  function taskRowToDoc(r) {
    return {
      id: r.id, leadId: r.lead_id, assigneeId: r.assignee_id, title: r.title,
      description: r.description, priority: r.priority, status: r.status,
      kanbanStatus: r.kanban_status, remind: !!r.remind,
      dueAt: toMs(r.due_at), completedAt: toMs(r.completed_at),
      createdBy: r.created_by, createdAt: toMs(r.created_at)
    };
  }

  function memberRowToDoc(r) {
    return {
      id: r.id, name: r.name, email: r.email, role: r.role, team: r.team,
      avatar: r.avatar, status: r.status, grp: r.grp,
      invitedAt: toMs(r.invited_at), lastLogin: toMs(r.last_login),
      permissions: r.permissions || {},
      credentials: { username: r.username, passwordHash: r.password_hash, mustResetOnFirstLogin: !!r.must_reset }
    };
  }

  function subvendorRowToDoc(r, acts) {
    return {
      ...(r.details || {}),               // long-tail form fields first…
      id: r.id, stage: r.stage, ownerId: r.owner_id, source: r.source,
      companyName: r.company_name, legalCompanyName: r.legal_company_name,
      contactPerson: r.contact_person, officialEmail: r.official_email,
      contactNumber: r.contact_number, whatsappNumber: r.whatsapp_number,
      companyWebsite: r.company_website, socialLinks: r.social_links,
      yearEstablished: r.year_established, teamSize: r.team_size,
      gstNumber: r.gst_number, panNumber: r.pan_number, cinNumber: r.cin_number,
      gstRegistered: r.gst_registered, internalNotes: r.internal_notes,
      regions: r.regions || [], services: r.services || [], industries: r.industries || [],
      deliveryModels: r.delivery_models || [], engagementModels: r.engagement_models || [],
      activities: (acts || []).map(a => ({ at: toMs(a.at), by: a.actor_id, text: a.note })),
      createdAt: toMs(r.created_at), updatedAt: toMs(r.updated_at)
    };
  }

  // ---- assembleState: rebuild the whole document from tables ---------------
  //
  // PostgREST truncates any single response at the project's max-rows setting
  // (1,000 by default on Supabase) and reports no error when it does, so a
  // plain .select('*') silently loses rows once a table outgrows that. Every
  // read below therefore pages with .range() until a page comes back empty.
  //
  // Paging needs a deterministic sort or rows can repeat or vanish between
  // pages, so each query orders by a unique column ('id'); the activity tables
  // keep their chronological sort with 'id' only as a tie-breaker.
  const PAGE = 1000;
  async function fetchPaged(build) {
    const rows = [];
    for (;;) {
      // Offset from rows.length, not a fixed stride: if the server returns
      // fewer rows than asked (a max-rows setting below PAGE), the next range
      // still resumes exactly where this one stopped instead of skipping.
      // Termination is an empty page rather than a short one, for the same
      // reason — a short page does not mean the table is exhausted.
      const { data, error } = await build().range(rows.length, rows.length + PAGE - 1);
      if (error) return { data: null, error };
      const page = data || [];
      if (!page.length) return { data: rows, error: null };
      rows.push(...page);
    }
  }

  function assembleState() { return withRetry(_assembleState); }
  async function _assembleState() {
    const q = t => fetchPaged(() =>
      supabase.from(t).select('*').eq('tenant_id', TENANT).order('id', { ascending: true }));
    const acts = t => fetchPaged(() =>
      supabase.from(t).select('*')
        .order('at', { ascending: true })
        .order('id', { ascending: true }));
    const [
      members, domains, services, quals, leadRows, leadActs, tasks,
      svRows, svActs, partners, jobs, scoring, routing, emailAcc, apiKeys,
      picks, settingsRow
    ] = await Promise.all([
      q('team_members'), q('service_domains'), q('services'), q('qualification_templates'),
      q('leads'), acts('lead_activities'),
      q('scheduled_tasks'), q('subvendors'),
      acts('subvendor_activities'),
      q('partners'), q('job_applicants'), q('scoring_rules'), q('routing_rules'),
      q('email_accounts'), q('api_keys'), q('picklists'),
      supabase.from('app_settings').select('settings').eq('tenant_id', TENANT).maybeSingle()
    ]);
    let postings = await q('job_postings');
    if (postings.error) {
      console.warn('[db] job_postings unavailable (' + postings.error.message + ') — continuing without it');
      postings = { data: [], error: null };
    }
    for (const r of [members, domains, services, quals, leadRows, leadActs, tasks, svRows, svActs, partners, jobs, scoring, routing, emailAcc, apiKeys, picks]) {
      if (r.error) throw new Error('assemble read failed: ' + r.error.message);
    }

    // group activities by parent
    const actsByLead = {}; (leadActs.data || []).forEach(a => (actsByLead[a.lead_id] = actsByLead[a.lead_id] || []).push(a));
    const actsBySv = {}; (svActs.data || []).forEach(a => (actsBySv[a.subvendor_id] = actsBySv[a.subvendor_id] || []).push(a));

    // picklists by kind
    const byKind = {}; (picks.data || []).sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .forEach(p => (byKind[p.kind] = byKind[p.kind] || []).push(p));
    const listVals = k => (byKind[k] || []).map(p => p.value);

    // settings = app_settings blob + normalized collections spread back in
    const blob = (settingsRow.data && settingsRow.data.settings) || {};
    const company = blob.company || null;
    const settings = { ...blob };
    delete settings.company;
    settings.serviceDomains = (domains.data || []).sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map(d => ({ id: d.id, name: d.name, icon: d.icon, color: d.color }));
    settings.serviceCatalog = (services.data || []).sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map(s => ({ id: s.id, domainId: s.domain_id, name: s.name }));
    settings.qualificationTemplates = (quals.data || [])
      .map(q2 => ({ id: q2.id, serviceId: q2.service_id, domainId: q2.domain_id, name: q2.name, questions: q2.questions || [] }));
    settings.scoringRules = (scoring.data || []).sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map(r => ({ id: r.id, label: r.label, points: r.points, on: r.enabled }));
    settings.routingRules = (routing.data || []).sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map(r => ({ id: r.id, name: r.name, match: r.match_expr, assignee: r.assignee, on: r.enabled }));
    settings.emailAccounts = (emailAcc.data || []).map(e => ({ id: e.id, address: e.address, status: e.status, ...(e.config || {}) }));
    settings.apiKeys = (apiKeys.data || []).map(k => ({ id: k.id, label: k.label, key: k.key, createdAt: toMs(k.created_at), lastUsed: toMs(k.last_used) }));
    settings.industries = listVals('industry');
    settings.countries = (byKind['country'] || []).map(p => ({ code: (p.meta && p.meta.code) || p.value, name: p.value }));
    settings.currencies = ['INR'];
    settings.winCategories = listVals('winCategory');
    settings.lossCategories = listVals('lossCategory');
    settings.winListReasons = listVals('winListReason');
    settings.notInListReasons = listVals('notInListReason');

    return {
      tenant: TENANT,
      company,
      teamMembers: (members.data || []).map(memberRowToDoc),
      leads: (leadRows.data || []).map(r => leadRowToDoc(r, actsByLead[r.id])),
      scheduledTasks: (tasks.data || []).map(taskRowToDoc),
      subvendors: (svRows.data || []).map(r => subvendorRowToDoc(r, actsBySv[r.id])),
      partners: (partners.data || []).map(p => ({ ...(p.details || {}), id: p.id, stage: p.stage, companyName: p.company_name, contactPerson: p.contact_person, officialEmail: p.official_email, createdAt: toMs(p.created_at), updatedAt: toMs(p.updated_at) })),
      jobApplicants: (jobs.data || []).map(j => ({ ...(j.details || {}), id: j.id, stage: j.stage, fullName: j.full_name, email: j.email, roleApplied: j.role_applied, createdAt: toMs(j.created_at), updatedAt: toMs(j.updated_at) })),
      jobPostings: (postings.data || []).map(postingRowToDoc),
      settings
    };
  }

  // ---- DOCUMENT -> ROW mappers (client camelCase -> DB columns) ------------
  function leadDocToRow(l) {
    const si = l.serviceInterest || {};
    const row = {
      id: l.id, tenant_id: TENANT,
      first_name: l.firstName ?? null, last_name: l.lastName ?? null, name: l.name ?? null,
      email: l.email ?? null, phone: l.phone ?? null, company: l.company ?? null,
      industry: l.industry ?? null, city: l.city ?? null, country: l.country ?? null,
      source: l.source ?? null, owner_id: l.ownerId ?? null,
      stage: l.stage || 'New', score: l.score || 0, amount: l.amount || 0, currency: 'INR',
      notes: l.notes ?? null,
      service_domain_id: si.domainId ?? null, service_id: si.serviceId ?? null,
      tags: Array.isArray(l.tags) ? l.tags : [],
      consent: l.consent || {}, visibility: l.visibility || { mode: 'all', users: [] },
      outcome: l.outcome || {}, qualifications: l.qualifications || {},
      action_plan: l.actionPlan ?? null
    };
    if (l.createdAt) row.created_at = toIso(l.createdAt);
    return row;
  }

  // Partial patch -> row: map ONLY the keys present in the patch, so a partial
  // update (e.g. just {stage}) never nulls fields it didn't mention.
  const LEAD_MAP = {
    firstName: 'first_name', lastName: 'last_name', name: 'name', email: 'email',
    phone: 'phone', company: 'company', industry: 'industry', city: 'city',
    country: 'country', source: 'source', ownerId: 'owner_id', stage: 'stage',
    score: 'score', amount: 'amount', notes: 'notes', tags: 'tags', consent: 'consent',
    visibility: 'visibility', outcome: 'outcome', qualifications: 'qualifications',
    actionPlan: 'action_plan'
  };
  function leadPatchToRow(patch) {
    const row = {};
    for (const [camel, col] of Object.entries(LEAD_MAP)) if (camel in patch) row[col] = patch[camel];
    if ('serviceInterest' in patch) {
      const si = patch.serviceInterest || {};
      row.service_domain_id = si.domainId ?? null;
      row.service_id = si.serviceId ?? null;
    }
    return row;
  }

  const TASK_MAP = {
    leadId: 'lead_id', assigneeId: 'assignee_id', title: 'title', description: 'description',
    priority: 'priority', status: 'status', kanbanStatus: 'kanban_status', remind: 'remind',
    createdBy: 'created_by'
  };
  function taskPatchToRow(patch) {
    const row = {};
    for (const [camel, col] of Object.entries(TASK_MAP)) if (camel in patch) row[col] = patch[camel];
    if ('dueAt' in patch) row.due_at = toIso(patch.dueAt);
    if ('completedAt' in patch) row.completed_at = toIso(patch.completedAt);
    return row;
  }

  function taskDocToRow(t) {
    const row = {
      id: t.id, tenant_id: TENANT, lead_id: t.leadId ?? null, assignee_id: t.assigneeId ?? null,
      title: t.title || '', description: t.description ?? null, priority: t.priority || 'med',
      status: t.status || 'todo', kanban_status: t.kanbanStatus || 'todo', remind: !!t.remind,
      due_at: toIso(t.dueAt), completed_at: toIso(t.completedAt), created_by: t.createdBy ?? null
    };
    if (t.createdAt) row.created_at = toIso(t.createdAt);
    return row;
  }

  // Guarded FK: only keep an owner/assignee id if that member exists.
  async function validMemberIds(ids) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Set();
    const { data } = await supabase.from('team_members').select('id').in('id', uniq);
    return new Set((data || []).map(m => m.id));
  }

  // ---- per-record writers --------------------------------------------------

  async function createLead(l) {
    const row = leadDocToRow(l);
    // drop FK if the referenced member/domain/service doesn't exist (defensive)
    const ok = await validMemberIds([row.owner_id]);
    if (row.owner_id && !ok.has(row.owner_id)) row.owner_id = null;
    const { data, error } = await supabase.from('leads').insert(row).select().single();
    if (error) throw new Error('createLead: ' + error.message);
    // seed activities passed with the new lead
    const acts = Array.isArray(l.activities) ? l.activities : [];
    if (acts.length) await replaceLeadActivities(l.id, acts);
    return data;
  }

  async function updateLead(id, patch) {
    const row = leadPatchToRow(patch);  // ONLY the fields present in the patch
    if (row.owner_id) { const ok = await validMemberIds([row.owner_id]); if (!ok.has(row.owner_id)) row.owner_id = null; }
    row.updated_at = nowIso();
    const { data, error } = await supabase.from('leads').update(row).eq('id', id).select().maybeSingle();
    if (error) throw new Error('updateLead: ' + error.message);
    if (!data) return null;             // 404
    if (Array.isArray(patch.activities)) await replaceLeadActivities(id, patch.activities);
    return data;
  }

  async function deleteLead(id) {
    const { error } = await supabase.from('leads').delete().eq('id', id);   // cascades activities
    if (error) throw new Error('deleteLead: ' + error.message);
    return true;
  }

  // Append one activity without touching the rest of the lead.
  async function addLeadActivity(leadId, act) {
    const members = await validMemberIds([act.by]);
    const { data, error } = await supabase.from('lead_activities').insert({
      lead_id: leadId, at: toIso(act.at) || nowIso(),
      actor_id: members.has(act.by) ? act.by : null, type: act.type || null, note: act.text || act.note || null
    }).select().single();
    if (error) throw new Error('addLeadActivity: ' + error.message);
    await supabase.from('leads').update({ updated_at: nowIso() }).eq('id', leadId);
    return data;
  }

  // Replace a lead's activity log (used when the client PUTs the full lead).
  async function replaceLeadActivities(leadId, acts) {
    const members = await validMemberIds(acts.map(a => a.by));
    await supabase.from('lead_activities').delete().eq('lead_id', leadId);
    if (!acts.length) return;
    const rows = acts.map(a => ({
      lead_id: leadId, at: toIso(a.at) || nowIso(),
      actor_id: members.has(a.by) ? a.by : null, type: a.type || null, note: a.text || a.note || null
    }));
    const { error } = await supabase.from('lead_activities').insert(rows);
    if (error) throw new Error('replaceLeadActivities: ' + error.message);
  }

  async function createTask(t) {
    const { data, error } = await supabase.from('scheduled_tasks').insert(taskDocToRow(t)).select().single();
    if (error) throw new Error('createTask: ' + error.message);
    return data;
  }
  async function updateTask(id, patch) {
    const row = taskPatchToRow(patch);  // ONLY the fields present in the patch
    const { data, error } = await supabase.from('scheduled_tasks').update(row).eq('id', id).select().maybeSingle();
    if (error) throw new Error('updateTask: ' + error.message);
    return data;
  }
  async function deleteTask(id) {
    const { error } = await supabase.from('scheduled_tasks').delete().eq('id', id);
    if (error) throw new Error('deleteTask: ' + error.message);
    return true;
  }

  // Subvendors: promote known columns, park the rest in details jsonb.
  const SV_COL = new Set(['id', 'stage', 'source', 'companyName', 'legalCompanyName', 'contactPerson',
    'officialEmail', 'contactNumber', 'whatsappNumber', 'companyWebsite', 'socialLinks',
    'yearEstablished', 'teamSize', 'gstNumber', 'panNumber', 'cinNumber', 'gstRegistered',
    'internalNotes', 'regions', 'services', 'industries', 'deliveryModels', 'engagementModels',
    'activities', 'ownerId', 'createdAt', 'updatedAt']);
  function subvendorDocToRow(v) {
    const details = {};
    Object.keys(v).forEach(k => { if (!SV_COL.has(k)) details[k] = v[k]; });
    const row = {
      id: v.id, tenant_id: TENANT, stage: v.stage || 'New', owner_id: v.ownerId ?? null, source: v.source ?? null,
      company_name: v.companyName ?? null, legal_company_name: v.legalCompanyName ?? null,
      contact_person: v.contactPerson ?? null, official_email: v.officialEmail ?? null,
      contact_number: v.contactNumber ?? null, whatsapp_number: v.whatsappNumber ?? null,
      company_website: v.companyWebsite ?? null, social_links: v.socialLinks ?? null,
      year_established: v.yearEstablished ?? null, team_size: v.teamSize ?? null,
      gst_number: v.gstNumber ?? null, pan_number: v.panNumber ?? null, cin_number: v.cinNumber ?? null,
      gst_registered: v.gstRegistered ?? null, internal_notes: v.internalNotes ?? null,
      regions: v.regions || [], services: v.services || [], industries: v.industries || [],
      delivery_models: v.deliveryModels || [], engagement_models: v.engagementModels || [], details
    };
    if (v.createdAt) row.created_at = toIso(v.createdAt);
    return row;
  }
  async function createSubvendor(v) {
    const { data, error } = await supabase.from('subvendors').insert(subvendorDocToRow(v)).select().single();
    if (error) throw new Error('createSubvendor: ' + error.message);
    const acts = Array.isArray(v.activities) ? v.activities : [];
    if (acts.length) {
      const rows = acts.map(a => ({ subvendor_id: v.id, at: toIso(a.at) || nowIso(), actor_id: null, note: a.text || null }));
      await supabase.from('subvendor_activities').insert(rows);
    }
    return data;
  }
  async function updateSubvendor(id, patch) {
    const row = subvendorDocToRow({ ...patch, id }); delete row.created_at; row.updated_at = nowIso();
    const { data, error } = await supabase.from('subvendors').update(row).eq('id', id).select().maybeSingle();
    if (error) throw new Error('updateSubvendor: ' + error.message);
    return data;
  }
  async function deleteSubvendor(id) {
    const { error } = await supabase.from('subvendors').delete().eq('id', id);
    if (error) throw new Error('deleteSubvendor: ' + error.message);
    return true;
  }
  async function subvendorEmailSeenRecently(email, withinMs) {
    if (!email) return null;
    const cutoff = new Date(Date.now() - withinMs).toISOString();
    const { data } = await supabase.from('subvendors').select('id')
      .ilike('official_email', email).gte('created_at', cutoff).limit(1);
    return (data && data[0]) ? data[0].id : null;
  }

  async function leadEmailSeenRecently(email, withinMs) {
    if (!email) return null;
    const cutoff = new Date(Date.now() - withinMs).toISOString();
    const { data } = await supabase.from('leads').select('id')
      .ilike('email', email).gte('created_at', cutoff).limit(1);
    return (data && data[0]) ? data[0].id : null;
  }

  // Partners / job applicants (light tables; keep full payload in details).
  async function createPartner(p) {
    const row = { id: p.id, tenant_id: TENANT, stage: p.stage || 'New', company_name: p.companyName ?? null,
      contact_person: p.fullName ?? null, official_email: p.email ?? null, details: p };
    if (p.createdAt) row.created_at = toIso(p.createdAt);
    const { data, error } = await supabase.from('partners').insert(row).select().single();
    if (error) throw new Error('createPartner: ' + error.message); return data;
  }
  function postingRowToDoc(p) {
    return {
      id: p.id, title: p.title, slug: p.slug, department: p.department,
      location: p.location, workType: p.work_type, employmentType: p.employment_type,
      experienceLevel: p.experience_level, experienceMin: p.experience_min, experienceMax: p.experience_max,
      salaryMin: p.salary_min, salaryMax: p.salary_max, salaryCurrency: p.salary_currency,
      salaryPeriod: p.salary_period, salaryHidden: !!p.salary_hidden, openings: p.openings,
      summary: p.summary, description: p.description,
      responsibilities: p.responsibilities || [], requirements: p.requirements || [],
      niceToHave: p.nice_to_have || [], benefits: p.benefits || [], skills: p.skills || [],
      applyEmail: p.apply_email, status: p.status || 'Draft', featured: !!p.featured,
      industryType: p.industry_type, roleCategory: p.role_category,
      educationUG: p.education_ug, educationPG: p.education_pg,
      highlights: p.highlights || [], showApplicants: !!p.show_applicants,
      postedAt: toMs(p.posted_at), closesAt: toMs(p.closes_at),
      createdAt: toMs(p.created_at), updatedAt: toMs(p.updated_at)
    };
  }

  const _arr = v => (Array.isArray(v) ? v.filter(x => x != null && String(x).trim() !== '') : []);
  const _num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));

  function postingDocToRow(p) {
    const row = {
      id: p.id, tenant_id: TENANT,
      title: p.title || 'Untitled role',
      slug: p.slug || null,
      department: p.department ?? null, location: p.location ?? null,
      work_type: p.workType ?? null, employment_type: p.employmentType ?? null,
      experience_level: p.experienceLevel ?? null,
      experience_min: _num(p.experienceMin), experience_max: _num(p.experienceMax),
      salary_min: _num(p.salaryMin), salary_max: _num(p.salaryMax),
      salary_currency: p.salaryCurrency || 'INR', salary_period: p.salaryPeriod || 'year',
      salary_hidden: !!p.salaryHidden, openings: _num(p.openings) ?? 1,
      summary: p.summary ?? null, description: p.description ?? null,
      responsibilities: _arr(p.responsibilities), requirements: _arr(p.requirements),
      nice_to_have: _arr(p.niceToHave), benefits: _arr(p.benefits), skills: _arr(p.skills),
      apply_email: p.applyEmail ?? null,
      status: p.status || 'Draft', featured: !!p.featured,
      industry_type: p.industryType ?? null, role_category: p.roleCategory ?? null,
      education_ug: p.educationUG ?? null, education_pg: p.educationPG ?? null,
      highlights: _arr(p.highlights), show_applicants: !!p.showApplicants,
      posted_at: toIso(p.postedAt), closes_at: toIso(p.closesAt),
      updated_at: nowIso()
    };
    if (p.createdAt) row.created_at = toIso(p.createdAt);
    return row;
  }

  async function createJobPosting(p) {
    const { data, error } = await supabase.from('job_postings').insert(postingDocToRow(p)).select().single();
    if (error) throw new Error('createJobPosting: ' + error.message);
    return postingRowToDoc(data);
  }
  async function updateJobPosting(id, p) {
    const row = postingDocToRow({ ...p, id });
    delete row.created_at;
    const { data, error } = await supabase.from('job_postings').update(row).eq('id', id).select().maybeSingle();
    if (error) throw new Error('updateJobPosting: ' + error.message);
    return data ? postingRowToDoc(data) : null;
  }
  async function deleteJobPosting(id) {
    const { error } = await supabase.from('job_postings').delete().eq('id', id);
    if (error) throw new Error('deleteJobPosting: ' + error.message);
    return true;
  }

  async function createJobApplicant(j) {
    const row = { id: j.id, tenant_id: TENANT, stage: j.stage || 'New', full_name: j.fullName ?? null,
      email: j.email ?? null, role_applied: j.roleApplied ?? null, details: j };
    if (j.createdAt) row.created_at = toIso(j.createdAt);
    const { data, error } = await supabase.from('job_applicants').insert(row).select().single();
    if (error) throw new Error('createJobApplicant: ' + error.message); return data;
  }

  // Team members (upsert a single member).
  async function upsertMember(m) {
    const c = m.credentials || {};
    const row = {
      id: m.id, tenant_id: TENANT, name: m.name || '', email: m.email || '', role: m.role || 'AE',
      team: m.team ?? null, avatar: m.avatar ?? null, status: m.status || 'active', grp: m.grp ?? null,
      username: c.username || m.email || null, password_hash: c.passwordHash ?? null,
      must_reset: !!c.mustResetOnFirstLogin, invited_at: toIso(m.invitedAt), last_login: toIso(m.lastLogin),
      permissions: m.permissions || {}
    };
    const { data, error } = await supabase.from('team_members').upsert(row, { onConflict: 'id' }).select().single();
    if (error) throw new Error('upsertMember: ' + error.message); return data;
  }
  async function deleteMember(id) {
    const { error } = await supabase.from('team_members').delete().eq('id', id);
    if (error) throw new Error('deleteMember: ' + error.message); return true;
  }

  // App settings blob (formula, integrations, prefs, company, …). Merge patch.
  async function saveSettingsBlob(patch) {
    const { data: cur } = await supabase.from('app_settings').select('settings').eq('tenant_id', TENANT).maybeSingle();
    const merged = { ...((cur && cur.settings) || {}), ...patch };
    const { error } = await supabase.from('app_settings').upsert(
      { tenant_id: TENANT, settings: merged, updated_at: nowIso() }, { onConflict: 'tenant_id' });
    if (error) throw new Error('saveSettingsBlob: ' + error.message);
    return merged;
  }

  // ---- config collection replacers (delete-all + insert; admin-edited) ----
  async function _replace(table, rows) {
    const isBigint = (table === 'picklists');
    const del = isBigint ? supabase.from(table).delete().gte('id', 0)
      : supabase.from(table).delete().neq('id', '__none__');
    const { error: de } = await del;
    if (de) throw new Error('replace ' + table + ' (clear): ' + de.message);
    if (!rows.length) return;
    const { error } = await supabase.from(table).insert(rows);
    if (error) throw new Error('replace ' + table + ': ' + error.message);
  }
  const replaceServiceDomains = list => _replace('service_domains',
    list.map((d, i) => ({ id: d.id, tenant_id: TENANT, name: d.name || '', icon: d.icon ?? null, color: d.color ?? null, sort: i })));
  const replaceServices = list => _replace('services',
    list.map((s, i) => ({ id: s.id, tenant_id: TENANT, domain_id: s.domainId ?? null, name: s.name || '', sort: i })));
  const replaceQualificationTemplates = list => _replace('qualification_templates',
    list.map(q => ({ id: q.id, tenant_id: TENANT, service_id: q.serviceId ?? null, domain_id: q.domainId ?? null, name: q.name || '', questions: q.questions || [] })));
  const replaceScoringRules = list => _replace('scoring_rules',
    list.map((r, i) => ({ id: r.id, tenant_id: TENANT, label: r.label || '', points: r.points || 0, enabled: r.on !== false, sort: i })));
  const replaceRoutingRules = list => _replace('routing_rules',
    list.map((r, i) => ({ id: r.id, tenant_id: TENANT, name: r.name || '', match_expr: r.match ?? null, assignee: r.assignee ?? null, enabled: r.on !== false, sort: i })));
  const replaceEmailAccounts = list => _replace('email_accounts',
    list.map(e => ({ id: e.id, tenant_id: TENANT, address: e.address ?? null, status: e.status ?? null, config: e })));
  const replaceApiKeys = list => _replace('api_keys',
    list.map(k => ({ id: k.id, tenant_id: TENANT, label: k.label ?? null, key: k.key || '', created_at: toIso(k.createdAt) || nowIso(), last_used: toIso(k.lastUsed) })));
  async function replacePicklists(lists) {
    const rows = [];
    const add = (arr, kind, metaFn) => (arr || []).forEach((v, i) => rows.push({
      tenant_id: TENANT, kind, value: (typeof v === 'string' ? v : (v.name || v.value || v.code || '')),
      meta: metaFn ? metaFn(v) : null, sort: i
    }));
    const K = { industries: 'industry', countries: 'country', currencies: 'currency',
      winCategories: 'winCategory', lossCategories: 'lossCategory',
      winListReasons: 'winListReason', notInListReasons: 'notInListReason' };
    // only clear the kinds present in this patch
    for (const key of Object.keys(lists)) {
      const kind = K[key]; if (!kind) continue;
      await supabase.from('picklists').delete().eq('tenant_id', TENANT).eq('kind', kind);
      add(lists[key], kind, key === 'countries' ? (v => (typeof v === 'object' && v.code) ? { code: v.code } : null) : null);
    }
    if (rows.length) {
      const { error } = await supabase.from('picklists').insert(rows);
      if (error) throw new Error('replacePicklists: ' + error.message);
    }
  }

  const replacePartners = list => _replace('partners', list.map(p => {
    const row = { id: p.id, tenant_id: TENANT, stage: p.stage || 'New', company_name: p.companyName ?? null,
      contact_person: p.fullName ?? p.contactPerson ?? null, official_email: p.email ?? null, details: p };
    if (p.createdAt) row.created_at = toIso(p.createdAt); return row;
  }));
  const replaceJobApplicants = list => _replace('job_applicants', list.map(j => {
    const row = { id: j.id, tenant_id: TENANT, stage: j.stage || 'New', full_name: j.fullName ?? null,
      email: j.email ?? null, role_applied: j.roleApplied ?? null, details: j };
    if (j.createdAt) row.created_at = toIso(j.createdAt); return row;
  }));

  async function counts() {
    const one = async t => (await supabase.from(t).select('*', { count: 'exact', head: true })).count || 0;
    const [leads, subvendors, tasks, users] = await Promise.all([
      one('leads'), one('subvendors'), one('scheduled_tasks'), one('team_members')]);
    return { leads, subvendors, tasks, users };
  }

  async function hasAdminWithCreds() {
    const { data } = await supabase.from('team_members').select('id')
      .eq('role', 'Admin').not('password_hash', 'is', null).limit(1);
    return !!(data && data.length);
  }

  return {
    TENANT, assembleState, counts, hasAdminWithCreds,
    createLead, updateLead, deleteLead, addLeadActivity, leadEmailSeenRecently, replaceLeadActivities,
    createTask, updateTask, deleteTask,
    createSubvendor, updateSubvendor, deleteSubvendor, subvendorEmailSeenRecently,
    createPartner, createJobApplicant,
    createJobPosting, updateJobPosting, deleteJobPosting,
    upsertMember, deleteMember, saveSettingsBlob,
    replaceServiceDomains, replaceServices, replaceQualificationTemplates,
    replaceScoringRules, replaceRoutingRules, replaceEmailAccounts, replaceApiKeys, replacePicklists,
    replacePartners, replaceJobApplicants
  };
};
