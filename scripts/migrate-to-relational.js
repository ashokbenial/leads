#!/usr/bin/env node
/**
 * One-time migration: leadforge_state JSONB document -> relational tables (v2).
 *
 *   node --env-file-if-exists=.env.local scripts/migrate-to-relational.js backups/12082026.json
 *
 * Reads env SUPABASE_URL + SUPABASE_SECRET_KEY (dev via .env.local; prod inline).
 * Re-runnable: wipes the v2 tables (reverse FK order) then re-inserts. It does
 * NOT touch leadforge_state — that stays as the rollback copy.
 *
 * Requires supabase-schema-v2.sql to have been run first (DDL can't go through
 * the REST key). Prints per-table counts at the end.
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const file = process.argv.find(a => a.endsWith('.json')) || 'backups/12082026.json';
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error('✗ SUPABASE_URL + SUPABASE_SECRET_KEY required'); process.exit(1); }
if (/^sb_publishable_/.test(key)) { console.error('✗ publishable key — need the secret key'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const S = doc.settings || {};

// Validity sets — null out any FK that points at an id we're not inserting
// (legacy/deleted users, stale service refs) so FK constraints don't reject rows.
const memberIds = new Set((doc.teamMembers || []).map(m => m && m.id));
const domainIds = new Set(((doc.settings || {}).serviceDomains || []).map(d => d && d.id));
const serviceIds = new Set(((doc.settings || {}).serviceCatalog || []).map(s => s && s.id));
const leadIds = new Set((doc.leads || []).map(l => l && l.id));
const mid = id => memberIds.has(id) ? id : null;   // valid member id or null
const did = id => domainIds.has(id) ? id : null;   // valid service_domain id or null
const svid = id => serviceIds.has(id) ? id : null; // valid service id or null
const lid = id => leadIds.has(id) ? id : null;     // valid lead id or null
const iso = ms => (ms === null || ms === undefined || ms === '') ? null
  : (typeof ms === 'number' ? new Date(ms).toISOString()
    : (isNaN(Date.parse(ms)) ? null : new Date(ms).toISOString()));
const arr = v => Array.isArray(v) ? v : [];
const TENANT = 'ab7-solutions';

async function wipe() {
  // reverse FK order
  const order = ['lead_activities', 'subvendor_activities', 'scheduled_tasks', 'leads',
    'qualification_templates', 'services', 'service_domains', 'subvendors', 'partners',
    'job_applicants', 'scoring_rules', 'routing_rules', 'email_accounts', 'api_keys',
    'picklists', 'app_settings', 'team_members'];
  for (const t of order) {
    // delete all rows for this tenant (or all)
    const { error } = await sb.from(t).delete().neq('id', '__none__').select('id').limit(1)
      .then(() => sb.from(t).delete().gte('id', ''))  // string/bigint pk: match all
      .catch(e => ({ error: e }));
    if (error && !/does not exist/.test(error.message || '')) console.warn('  wipe ' + t + ':', error.message);
  }
}

async function insertAll(table, rows, label) {
  if (!rows.length) { console.log('  ' + (label || table).padEnd(22) + '0'); return; }
  // chunk to stay under payload limits
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(table + ' insert failed: ' + error.message);
  }
  console.log('  ' + (label || table).padEnd(22) + rows.length);
}

(async () => {
  console.log('\n  Target : ' + new URL(url).host);
  console.log('  Source : ' + file + '\n');

  await sb.from('tenants').upsert({ id: TENANT, name: 'AB7 Solutions' }, { onConflict: 'id' });
  console.log('  wiping v2 tables…');
  // simplest robust wipe: delete-all per table in reverse FK order
  for (const t of ['lead_activities', 'subvendor_activities', 'scheduled_tasks', 'leads',
    'qualification_templates', 'services', 'service_domains', 'subvendors', 'partners',
    'job_applicants', 'scoring_rules', 'routing_rules', 'email_accounts', 'api_keys',
    'picklists', 'app_settings', 'team_members']) {
    const isBigint = (t === 'lead_activities' || t === 'subvendor_activities' || t === 'picklists');
    const q = isBigint ? sb.from(t).delete().gte('id', 0)
      : (t === 'app_settings' ? sb.from(t).delete().neq('tenant_id', '__none__')
        : sb.from(t).delete().neq('id', '__none__'));
    const { error } = await q;
    if (error && !/does not exist/.test(error.message)) console.warn('   wipe ' + t + ': ' + error.message);
  }
  console.log('  inserting:\n');

  // ---- team_members ----
  await insertAll('team_members', arr(doc.teamMembers).map(m => {
    const c = m.credentials || {};
    return {
      id: m.id, tenant_id: TENANT, name: m.name || '', email: m.email || '',
      role: m.role || 'AE', team: m.team || null, avatar: m.avatar || null,
      status: m.status || 'active', grp: m.grp || null,
      username: c.username || m.email || null, password_hash: c.passwordHash || null,
      must_reset: !!c.mustResetOnFirstLogin,
      invited_at: iso(m.invitedAt), last_login: iso(m.lastLogin),
      permissions: m.permissions || {}
    };
  }), 'team_members');

  // ---- service catalog ----
  await insertAll('service_domains', arr(S.serviceDomains).map((d, i) => ({
    id: d.id, tenant_id: TENANT, name: d.name || '', icon: d.icon || null, color: d.color || null, sort: i
  })), 'service_domains');
  await insertAll('services', arr(S.serviceCatalog).map((s, i) => ({
    id: s.id, tenant_id: TENANT, domain_id: did(s.domainId), name: s.name || '', sort: i
  })), 'services');
  await insertAll('qualification_templates', arr(S.qualificationTemplates).map(q => ({
    id: q.id, tenant_id: TENANT, service_id: svid(q.serviceId), domain_id: did(q.domainId),
    name: q.name || '', questions: q.questions || q.items || []
  })), 'qualification_templates');

  // ---- leads (+ activities) ----
  const leadRows = [], actRows = [];
  arr(doc.leads).forEach(l => {
    const si = l.serviceInterest || {};
    leadRows.push({
      id: l.id, tenant_id: TENANT,
      first_name: l.firstName || null, last_name: l.lastName || null, name: l.name || null,
      email: l.email || null, phone: l.phone || null, company: l.company || null,
      industry: l.industry || null, city: l.city || null, country: l.country || null,
      source: l.source || null, owner_id: mid(l.ownerId),
      stage: l.stage || 'New', score: l.score || 0, amount: l.amount || 0,
      currency: l.currency || 'INR', notes: l.notes || null,
      service_domain_id: did(si.domainId), service_id: svid(si.serviceId),
      tags: arr(l.tags), consent: l.consent || {}, visibility: l.visibility || { mode: 'all', users: [] },
      outcome: l.outcome || {}, qualifications: l.qualifications || {},
      action_plan: l.actionPlan || null,
      created_at: iso(l.createdAt) || new Date().toISOString(), updated_at: iso(l.updatedAt) || iso(l.createdAt) || new Date().toISOString()
    });
    arr(l.activities).forEach(a => actRows.push({
      lead_id: l.id, at: iso(a.at) || new Date().toISOString(),
      actor_id: mid(a.by), type: a.type || null, note: a.text || a.note || null
    }));
  });
  await insertAll('leads', leadRows, 'leads');
  await insertAll('lead_activities', actRows, 'lead_activities');

  // ---- scheduled_tasks ----
  await insertAll('scheduled_tasks', arr(doc.scheduledTasks).map(t => ({
    id: t.id, tenant_id: TENANT,
    lead_id: lid(t.leadId || t.lead_id), assignee_id: mid(t.assigneeId || t.assignee_id),
    title: t.title || '', description: t.description || null,
    priority: t.priority || 'med', status: t.status || 'todo',
    kanban_status: t.kanbanStatus || t.kanban_status || 'todo', remind: !!t.remind,
    due_at: iso(t.dueAt || t.due_at), completed_at: iso(t.completedAt || t.completed_at),
    created_by: mid(t.createdBy || t.created_by), created_at: iso(t.createdAt || t.created_at) || new Date().toISOString()
  })), 'scheduled_tasks');

  // ---- subvendors (+ activities) ----
  const SV_COLS = new Set(['id', 'stage', 'source', 'ownerId', 'companyName', 'legalCompanyName',
    'contactPerson', 'officialEmail', 'contactNumber', 'whatsappNumber', 'companyWebsite',
    'socialLinks', 'yearEstablished', 'teamSize', 'gstNumber', 'panNumber', 'cinNumber',
    'gstRegistered', 'internalNotes', 'regions', 'services', 'industries', 'deliveryModels',
    'engagementModels', 'activities', 'createdAt', 'updatedAt']);
  const svRows = [], svAct = [];
  arr(doc.subvendors).forEach(v => {
    const details = {};
    Object.keys(v).forEach(k => { if (!SV_COLS.has(k)) details[k] = v[k]; });
    svRows.push({
      id: v.id, tenant_id: TENANT, stage: v.stage || 'New', owner_id: mid(v.ownerId),
      source: v.source || null, company_name: v.companyName || null,
      legal_company_name: v.legalCompanyName || null, contact_person: v.contactPerson || null,
      official_email: v.officialEmail || null, contact_number: v.contactNumber || null,
      whatsapp_number: v.whatsappNumber || null, company_website: v.companyWebsite || null,
      social_links: v.socialLinks || null, year_established: v.yearEstablished || null,
      team_size: v.teamSize || null, gst_number: v.gstNumber || null, pan_number: v.panNumber || null,
      cin_number: v.cinNumber || null, gst_registered: v.gstRegistered || null,
      internal_notes: v.internalNotes || null,
      regions: arr(v.regions), services: arr(v.services), industries: arr(v.industries),
      delivery_models: arr(v.deliveryModels), engagement_models: arr(v.engagementModels),
      details, created_at: iso(v.createdAt) || new Date().toISOString(), updated_at: iso(v.updatedAt) || new Date().toISOString()
    });
    arr(v.activities).forEach(a => svAct.push({
      subvendor_id: v.id, at: iso(a.at) || new Date().toISOString(), actor_id: mid(a.by), note: a.text || null
    }));
  });
  await insertAll('subvendors', svRows, 'subvendors');
  await insertAll('subvendor_activities', svAct, 'subvendor_activities');

  // ---- partners & job_applicants (empty today; copy through if present) ----
  await insertAll('partners', arr(doc.partners).map(p => ({
    id: p.id, tenant_id: TENANT, stage: p.stage || 'New', company_name: p.companyName || null,
    contact_person: p.contactPerson || null, official_email: p.officialEmail || null,
    details: p, created_at: iso(p.createdAt) || new Date().toISOString(), updated_at: iso(p.updatedAt) || new Date().toISOString()
  })), 'partners');
  await insertAll('job_applicants', arr(doc.jobApplicants).map(j => ({
    id: j.id, tenant_id: TENANT, stage: j.stage || 'New', full_name: j.fullName || j.name || null,
    email: j.email || null, role_applied: j.roleApplied || j.role || null,
    details: j, created_at: iso(j.createdAt) || new Date().toISOString(), updated_at: iso(j.updatedAt) || new Date().toISOString()
  })), 'job_applicants');

  // ---- rules & integrations ----
  await insertAll('scoring_rules', arr(S.scoringRules).map((r, i) => ({
    id: r.id, tenant_id: TENANT, label: r.label || '', points: r.points || 0, enabled: r.on !== false, sort: i
  })), 'scoring_rules');
  await insertAll('routing_rules', arr(S.routingRules).map((r, i) => ({
    id: r.id, tenant_id: TENANT, name: r.name || '', match_expr: r.match || null,
    assignee: mid(r.assignee), enabled: r.on !== false, sort: i
  })), 'routing_rules');
  await insertAll('email_accounts', arr(S.emailAccounts).map(e => ({
    id: e.id, tenant_id: TENANT, address: e.address || null, status: e.status || null, config: e
  })), 'email_accounts');
  await insertAll('api_keys', arr(S.apiKeys).map(k => ({
    id: k.id, tenant_id: TENANT, label: k.label || null, key: k.key || '',
    created_at: iso(k.createdAt) || new Date().toISOString(), last_used: iso(k.lastUsed)
  })), 'api_keys');

  // ---- picklists ----
  const pick = [];
  const addList = (list, kind, metaFn) => arr(list).forEach((v, i) => pick.push({
    tenant_id: TENANT, kind, value: (typeof v === 'string' ? v : (v.name || v.value || v.code || '')),
    meta: metaFn ? metaFn(v) : null, sort: i
  }));
  addList(S.industries, 'industry');
  addList(S.countries, 'country', v => (typeof v === 'object' && v.code) ? { code: v.code } : null);
  addList(S.currencies, 'currency');
  addList(S.winCategories, 'winCategory');
  addList(S.lossCategories, 'lossCategory');
  addList(S.winListReasons, 'winListReason');
  addList(S.notInListReasons, 'notInListReason');
  await insertAll('picklists', pick, 'picklists');

  // ---- app_settings (everything document-shaped that isn't its own table) ----
  const TABLE_KEYS = new Set(['serviceDomains', 'serviceCatalog', 'qualificationTemplates',
    'scoringRules', 'routingRules', 'emailAccounts', 'apiKeys', 'industries', 'countries',
    'currencies', 'winCategories', 'lossCategories', 'winListReasons', 'notInListReasons']);
  const settingsBlob = {};
  Object.keys(S).forEach(k => { if (!TABLE_KEYS.has(k)) settingsBlob[k] = S[k]; });
  if (doc.company) settingsBlob.company = doc.company;
  await insertAll('app_settings', [{ tenant_id: TENANT, settings: settingsBlob, updated_at: new Date().toISOString() }], 'app_settings');

  // ---- verify ----
  console.log('\n  verify (row counts in DB):');
  for (const t of ['team_members', 'service_domains', 'services', 'qualification_templates',
    'leads', 'lead_activities', 'scheduled_tasks', 'subvendors', 'scoring_rules', 'routing_rules',
    'picklists', 'app_settings']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    console.log('    ' + t.padEnd(22) + count);
  }
  console.log('\n  ✓ migration complete\n');
})().catch(e => { console.error('\n✗ ' + e.message + '\n'); process.exit(1); });
