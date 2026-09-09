/**
 * LeadForge 360 — API server
 * ----------------------------------------------------------
 * ONE datastore: Supabase Postgres. There is no other backend — no local
 * file, no Redis, no Blob, no SQLite. Do not add one.
 *
 * The entire workspace is a single JSON document living in one row of
 * public.leadforge_state (schema: docs-leadforge-supabase-setup.sql):
 *
 *     tenant text primary key | data jsonb | updated_at timestamptz
 *
 * Dev and prod are separate Supabase PROJECTS (separate databases), selected
 * purely by which SUPABASE_URL is in the environment.
 *
 * Runs identically in three places:
 *   • local dev  — `npm start`, pointed at the leadforge-dev project
 *   • Vercel     — imported by api/index.js, invoked per request
 *   • any VPS    — `node db-server.js`
 *
 *   npm install
 *   npm start            # http://localhost:4000
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const PORT = Number(process.env.PORT || 4000);

// Primary key of the leadforge_state row. NOT a Supabase concept — it is this
// app's own row key. Single-tenant install, so it is a constant. Dev and prod
// are different Supabase projects and therefore never share a row.
const TENANT = 'ab7-solutions';

// ---------- Storage backend: Supabase, and only Supabase ----------
// Refuse to boot without credentials. A loud crash beats silently falling back
// to a store nobody reads — which is exactly how this app lost six days of
// writes in July 2026.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || '';
if(!SUPABASE_URL || !SUPABASE_KEY){
  throw new Error(
    'FATAL: SUPABASE_URL and SUPABASE_SECRET_KEY are required — this app has ' +
    'exactly one datastore and cannot start without it. Local dev: copy ' +
    '.env.example to .env.local and fill in the DEV project. Vercel: ' +
    'Settings → Environment Variables, scoped per environment.'
  );
}
// Must be the SECRET key (sb_secret_… , or a legacy service_role JWT). The
// publishable key is subject to RLS, and leadforge_state has RLS enabled with
// no policies — so a publishable key returns an EMPTY workspace behind a green
// health check, and the first client write then overwrites production.
if(/^sb_publishable_/.test(SUPABASE_KEY)){
  throw new Error(
    'FATAL: SUPABASE_SECRET_KEY holds a publishable key. Use the secret key ' +
    '(sb_secret_… from Settings → API Keys → Secret keys).'
  );
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth:{ persistSession:false } });
// Relational data-access layer (schema v2). db-server.js touches Supabase only
// through this — assembleState() for reads, per-record writers for mutations.
const repo = require('./db-repo.js')(supabase);
console.log('[db] storage backend: Supabase relational v2 (' + new URL(SUPABASE_URL).host + ')');

// ---------- Ingest authentication (shared secret) ----------
// All three website webhooks (vendor / partner / job) are protected by one
// shared secret. Set INGEST_TOKEN on this server AND send it from the website
// as either `Authorization: Bearer <token>` or `x-ab7-token: <token>`.
// Backward-compatible with the older SUBVENDOR_INGEST_TOKEN name.
// If NO token is configured the endpoints stay open (local dev) but log a
// warning — always set INGEST_TOKEN in production.
const crypto = require('crypto');
const INGEST_TOKEN = (process.env.INGEST_TOKEN || process.env.SUBVENDOR_INGEST_TOKEN || '').trim();
if(!INGEST_TOKEN){
  console.warn('[auth] ⚠ No INGEST_TOKEN set — website ingest endpoints are UNAUTHENTICATED. Set INGEST_TOKEN before deploying.');
}
// Constant-time string compare to avoid leaking the token via timing.
function safeEqual(a, b){
  a = String(a || ''); b = String(b || '');
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if(ba.length !== bb.length) return false;
  try{ return crypto.timingSafeEqual(ba, bb); }catch(e){ return false; }
}
// Returns true when the request carries the right secret (or none is required).
function ingestAuthorized(req){
  if(!INGEST_TOKEN) return true; // dev fallback — no secret configured
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const header = (req.get('x-ab7-token') || '').trim();
  return safeEqual(bearer, INGEST_TOKEN) || safeEqual(header, INGEST_TOKEN);
}
// Express guard — call at the top of every ingest route.
function requireIngestAuth(req, res){
  if(ingestAuthorized(req)) return true;
  res.status(401).json({ ok:false, error:'unauthorized' });
  return false;
}

// Tolerant array reader — website may send a real array, a JSON string, or a
// comma-joined string. Shared by the partner + job + vendor normalizers.
function _arr(v){
  if(Array.isArray(v)) return v.filter(x=>x!==undefined && x!==null && x!=='');
  if(v == null || v === '') return [];
  if(typeof v === 'string'){
    const s = v.trim();
    if(s[0] === '['){ try{ const a = JSON.parse(s); return Array.isArray(a)?a:[]; }catch(e){} }
    return s.split(',').map(x=>x.trim()).filter(Boolean);
  }
  return [];
}
// Pick the first non-empty value across several possible keys (snake/camel).
function _pick(b, ...keys){
  for(const k of keys){ const val = b[k]; if(val!==undefined && val!==null && val!=='') return val; }
  return '';
}
// Resolve a submission timestamp from any of several possible keys.
function _submittedAt(b){
  const submitted = _pick(b, 'created_at', 'submittedAt', 'createdAt');
  if(submitted){ const t = typeof submitted==='number' ? submitted : Date.parse(submitted); if(!isNaN(t)) return t; }
  return Date.now();
}

// ---------- One-time admin seed ----------
// On a brand-new database (no Admin with credentials yet), seed a single Admin
// so the portal is reachable without the manual first-run setup screen.
// Idempotent: once ANY Admin has credentials this is a no-op.
// The password uses the same non-crypto hash the frontend login checks against
// (LF.team._hash → "sh1_<hex>_<len>"), so sign-in Just Works.
function _seedHash(s){
  let h = 5381;
  for(let i=0;i<s.length;i++) h = ((h<<5)+h) ^ s.charCodeAt(i);
  return 'sh1_' + ((h>>>0).toString(16)).padStart(8,'0') + '_' + s.length;
}
let _seedChecked = false;
async function seedAdminIfEmpty(){
  if(_seedChecked) return; _seedChecked = true;
  if(await repo.hasAdminWithCreds()) return;
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@ab7solutions.com').trim().toLowerCase();
  const pass  = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe@AB7';
  const adminPerms = { leads:'admin', pipeline:'admin', scoring:'admin', cdp:'admin',
    analytics:'admin', conversion:'admin', collab:'admin', customization:'admin',
    integrations:'admin', mail:'admin', settings:'admin' };
  await repo.upsertMember({
    id:'admin-seed', name:'Administrator', email, role:'Admin', team:'Enterprise',
    status:'active', avatar:'AD', permissions:adminPerms, invitedAt:Date.now(), lastLogin:null,
    credentials:{ username:email, passwordHash:_seedHash(pass), mustResetOnFirstLogin:true }
  });
  console.log('  ★ Seeded first Admin account (database was empty): ' + email);
}

// ---------- Express ----------
const app = express();
app.use(express.json({ limit:'12mb' }));
app.use(cors({ origin:true, credentials:true }));

// Small async wrapper so a rejected promise becomes a clean 500 instead of a hang.
const h = fn => (req,res) => Promise.resolve(fn(req,res)).catch(e => {
  console.error('[api] error:', e && e.message);
  if(!res.headersSent) res.status(500).json({ error:'server error' });
});

// Health
app.get('/api/health', h(async (req,res)=>{
  await seedAdminIfEmpty();
  const c = await repo.counts();
  res.json({
    ok:true,
    db: 'supabase-relational-v2',
    host: new URL(SUPABASE_URL).host,
    version:'supabase relational store v4',
    tenant:TENANT,
    leads:c.leads,
    subvendors:c.subvendors,
    tasks:c.tasks,
    users:c.users,
    lastWriteAt:null
  });
}));

// Snapshot — fetch full state for portal hydration (assembled from the tables).
// The client's read path is unchanged: this returns the same document shape the
// single-document store used to return.
app.get('/api/snapshot', h(async (req,res)=>{
  await seedAdminIfEmpty();
  const _state = await repo.assembleState();
  // The POST handler stores extended config (serviceDomains, scoringRules,
  // integrationConfig, claudeConfig, etc.) nested inside _state.settings.
  // The client expects those at the top level — spread them back so the
  // round-trip is symmetric and reload doesn't lose user-added domains.
  const s = _state.settings || {};
  res.json({
    tenant:TENANT,
    leads: _state.leads.map(l => ({
      id:l.id, first_name:l.firstName, last_name:l.lastName, name:l.name,
      email:l.email, phone:l.phone, company:l.company, industry:l.industry,
      city:l.city, country:l.country, source:l.source, owner_id:l.ownerId,
      stage:l.stage, score:l.score, amount:l.amount, currency:'INR',
      notes:l.notes, tags:l.tags||[], service_interest:l.serviceInterest||null,
      consent:l.consent||{email:true}, qualifications:l.qualifications||{},
      action_plan:l.actionPlan, visibility:l.visibility||{mode:'all',users:[]},
      activities:l.activities||[],
      created_at: l.createdAt ? new Date(l.createdAt).toISOString() : null,
      updated_at: l.updatedAt ? new Date(l.updatedAt).toISOString() : null
    })),
    scheduledTasks: _state.scheduledTasks.map(t => ({
      id:t.id, lead_id:t.leadId, assignee_id:t.assigneeId,
      title:t.title, description:t.description, priority:t.priority, status:t.status,
      kanban_status:t.kanbanStatus||'todo', remind:!!t.remind,
      due_at: t.dueAt ? new Date(t.dueAt).toISOString() : null,
      completed_at: t.completedAt ? new Date(t.completedAt).toISOString() : null,
      created_at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
      created_by:t.createdBy
    })),
    teamMembers: _state.teamMembers,
    subvendors: _state.subvendors || [],
    partners: _state.partners || [],
    jobApplicants: _state.jobApplicants || [],
    company: _state.company,
    settings: s,
    // Top-level mirrors of the keys the client reads after loadSnapshot().
    // Keeps `settings` in the response too for any consumer that still
    // expects the nested shape.
    scoringRules: s.scoringRules,
    serviceDomains: s.serviceDomains,
    serviceCatalog: s.serviceCatalog,
    qualificationTemplates: s.qualificationTemplates,
    industries: s.industries,
    countries: s.countries,
    currencies: s.currencies,
    taskKanbanStatuses: s.taskKanbanStatuses,
    notificationPrefs: s.notificationPrefs,
    apiKeys: s.apiKeys,
    scim: s.scim,
    emailDelivery: s.emailDelivery,
    emailDns: s.emailDns,
    emailPrefs: s.emailPrefs,
    emailAccounts: s.emailAccounts,
    emailAliases: s.emailAliases,
    emailLog: s.emailLog,
    emailDeliveryLog: s.emailDeliveryLog,
    claudeConfig: s.claudeConfig,
    claudeUsage: s.claudeUsage,
    integrationConfig: s.integrationConfig,
    integrations: s.integrations,
    customFields: s.customFields,
    mailbox: s.mailbox,
    agentConfig: s.agentConfig,
    agentLogs: s.agentLogs,
    hitlQueue: s.hitlQueue,
    // Won/lost picklists, routing rules, and the Deal-health formula — mirror
    // of the extra settingsKeys added to the POST handler. Keep both in sync.
    winCategories: s.winCategories,
    winListReasons: s.winListReasons,
    lossCategories: s.lossCategories,
    notInListReasons: s.notInListReasons,
    routingRules: s.routingRules,
    formulaName: s.formulaName,
    formulaExpression: s.formulaExpression,
    formulaPublished: s.formulaPublished
  });
}));

// ---------- Config bulk-save (low-contention, admin-edited) ----------
// The transactional entities (leads, tasks, subvendors) are NEVER written here
// — they go through the per-record routes below so concurrent edits can't
// clobber each other. This endpoint only persists the workspace *configuration*
// the client edits in Settings/Customization: the service catalog, picklists,
// scoring/routing rules, team roster, and the app_settings blob (formula,
// integrations, prefs, company). Those are edited rarely and by admins, so a
// bulk replace is safe. Leads/tasks/subvendors in the payload are ignored.
async function saveConfig(snap){
  // catalog & picklists & rules → replace-in-place (single-admin config)
  if(Array.isArray(snap.serviceDomains)) await repo.replaceServiceDomains(snap.serviceDomains);
  if(Array.isArray(snap.serviceCatalog)) await repo.replaceServices(snap.serviceCatalog);
  if(Array.isArray(snap.qualificationTemplates)) await repo.replaceQualificationTemplates(snap.qualificationTemplates);
  if(Array.isArray(snap.scoringRules)) await repo.replaceScoringRules(snap.scoringRules);
  if(Array.isArray(snap.routingRules)) await repo.replaceRoutingRules(snap.routingRules);
  if(Array.isArray(snap.emailAccounts)) await repo.replaceEmailAccounts(snap.emailAccounts);
  if(Array.isArray(snap.apiKeys)) await repo.replaceApiKeys(snap.apiKeys);
  if(Array.isArray(snap.partners)) await repo.replacePartners(snap.partners);
  if(Array.isArray(snap.jobApplicants)) await repo.replaceJobApplicants(snap.jobApplicants);
  const pick = {};
  ['industries','countries','currencies','winCategories','lossCategories','winListReasons','notInListReasons']
    .forEach(k => { if(Array.isArray(snap[k])) pick[k] = snap[k]; });
  if(Object.keys(pick).length) await repo.replacePicklists(pick);
  if(Array.isArray(snap.teamMembers)) for(const m of snap.teamMembers) await repo.upsertMember(m);
  // app_settings blob (everything document-shaped)
  const blobKeys = ['taskKanbanStatuses','notificationPrefs','scim','emailDelivery','emailDns',
    'emailPrefs','emailAliases','emailLog','emailDeliveryLog','claudeConfig','claudeUsage',
    'integrationConfig','integrations','customFields','mailbox','agentConfig','agentLogs','hitlQueue',
    'formulaName','formulaExpression','formulaPublished'];
  const blob = {};
  blobKeys.forEach(k => { if(snap[k] !== undefined) blob[k] = snap[k]; });
  if(snap.company) blob.company = { ...snap.company, billing:{ ...(snap.company.billing||{}), currency:'INR' } };
  if(Object.keys(blob).length) await repo.saveSettingsBlob(blob);
}
app.post('/api/config', h(async (req,res)=>{ await saveConfig(req.body || {}); res.json({ ok:true }); }));
// Back-compat alias: an un-rewired client save still persists CONFIG safely, but
// its leads/tasks/subvendors are ignored here (those must use per-record routes).
app.post('/api/snapshot', h(async (req,res)=>{ await saveConfig(req.body || {}); res.json({ ok:true, note:'config-only; use per-record routes for leads/tasks' }); }));

// ---------- Per-record writes (atomic; concurrent-safe) ----------
app.post('/api/leads', h(async (req,res)=>{ res.json(await repo.createLead(req.body || {})); }));
app.put('/api/leads/:id', h(async (req,res)=>{
  const r = await repo.updateLead(req.params.id, req.body || {});
  if(!r) return res.status(404).json({ error:'not found' });
  res.json(r);
}));
app.delete('/api/leads/:id', h(async (req,res)=>{ await repo.deleteLead(req.params.id); res.json({ ok:true }); }));
app.post('/api/leads/:id/activities', h(async (req,res)=>{ res.json(await repo.addLeadActivity(req.params.id, req.body || {})); }));

app.post('/api/tasks', h(async (req,res)=>{ res.json(await repo.createTask(req.body || {})); }));
app.put('/api/tasks/:id', h(async (req,res)=>{
  const r = await repo.updateTask(req.params.id, req.body || {});
  if(!r) return res.status(404).json({ error:'not found' });
  res.json(r);
}));
app.delete('/api/tasks/:id', h(async (req,res)=>{ await repo.deleteTask(req.params.id); res.json({ ok:true }); }));

app.put('/api/team/:id', h(async (req,res)=>{ res.json(await repo.upsertMember({ ...req.body, id:req.params.id })); }));
app.delete('/api/team/:id', h(async (req,res)=>{ await repo.deleteMember(req.params.id); res.json({ ok:true }); }));

// ----------------------------------------------------------
// Sub-vendors
// ----------------------------------------------------------
// Fed by the ab7solutions.com "Become a Sub-Vendor" form. The website's
// /api/vendor route forwards each new submission here (snake_case payload).
// We normalise it into the camelCase shape the LeadForge UI (LF.subvendors)
// reads, stamp it stage:"New", and persist. The record then round-trips
// through GET/POST /api/snapshot like leads/tasks.
function _svArr(v){
  if(Array.isArray(v)) return v.filter(x=>x!==undefined && x!==null && x!=='');
  if(v == null || v === '') return [];
  if(typeof v === 'string'){
    const s = v.trim();
    if(s[0] === '['){ try{ const a = JSON.parse(s); return Array.isArray(a)?a:[]; }catch(e){} }
    return s.split(',').map(x=>x.trim()).filter(Boolean);
  }
  return [];
}
function normalizeSubvendor(b){
  b = b || {};
  const pick = (...keys)=>{ for(const k of keys){ const val=b[k]; if(val!==undefined && val!==null && val!=='') return val; } return ''; };
  const submitted = pick('created_at','submittedAt','createdAt');
  let createdAt = Date.now();
  if(submitted){ const t = typeof submitted==='number'?submitted:Date.parse(submitted); if(!isNaN(t)) createdAt = t; }
  return {
    id: 'sv_' + Math.random().toString(36).slice(2,10),
    stage: 'New', ownerId: null, internalNotes: '',
    companyName: pick('company_name','companyName'),
    contactPerson: pick('contact_person','contactPerson'),
    officialEmail: pick('official_email','officialEmail'),
    contactNumber: pick('contact_number','contactNumber'),
    whatsappNumber: pick('whatsapp_number','whatsappNumber'),
    companyWebsite: pick('company_website','companyWebsite'),
    socialLinks: pick('social_links','socialLinks'),
    services: _svArr(b.services), servicesOther: pick('services_other','servicesOther'),
    companyDescription: pick('company_description','companyDescription'),
    yearEstablished: pick('year_established','yearEstablished'),
    teamSize: pick('team_size','teamSize'),
    industries: _svArr(b.industries), industriesOther: pick('industries_other','industriesOther'),
    regions: _svArr(b.regions), regionsOther: pick('regions_other','regionsOther'),
    coreExpertise: pick('core_expertise','coreExpertise'),
    deliveryModels: _svArr(b.delivery_models || b.deliveryModels), deliveryOther: pick('delivery_other','deliveryOther'),
    projectCapacity: pick('project_capacity','projectCapacity'),
    toolsPlatforms: pick('tools_platforms','toolsPlatforms'),
    notableClients: pick('notable_clients','notableClients'),
    certifications: pick('certifications'),
    engagementModels: _svArr(b.engagement_models || b.engagementModels), engagementOther: pick('engagement_other','engagementOther'),
    warrantySupport: pick('warranty_support','warrantySupport'),
    paymentTerms: pick('payment_terms','paymentTerms'),
    gstRegistered: pick('gst_registered','gstRegistered'),
    legalCompanyName: pick('legal_company_name','legalCompanyName','company_name'),
    panNumber: pick('pan_number','panNumber'),
    gstNumber: pick('gst_number','gstNumber'),
    cinNumber: pick('cin_number','cinNumber'),
    signatoryName: pick('signatory_name','signatoryName'),
    signatoryDesignation: pick('signatory_designation','signatoryDesignation'),
    signatoryEmail: pick('signatory_email','signatoryEmail'),
    panFileUrl: pick('pan_file_url','panFileUrl'),
    gstFileUrl: pick('gst_file_url','gstFileUrl'),
    brochureFileUrl: pick('brochure_file_url','brochureFileUrl'),
    panFileLink: pick('pan_file_link','panFileLink'),
    gstFileLink: pick('gst_file_link','gstFileLink'),
    brochureFileLink: pick('brochure_file_link','brochureFileLink'),
    howHeard: pick('how_heard','howHeard'),
    partnershipReason: pick('partnership_reason','partnershipReason'),
    declarationAccepted: b.declaration_accepted === true || b.declaration_accepted === 'Yes' || b.declarationAccepted === true,
    source: pick('source') || 'become-a-vendor portal',
    ipAddress: pick('ip_address','ipAddress'),
    userAgent: pick('user_agent','userAgent'),
    activities: [{ type:'create', at: createdAt, by: null, text: 'Application received from website' }],
    createdAt, updatedAt: Date.now()
  };
}

// Webhook receiver — the website posts here on every new submission.
// Optional shared secret: set SUBVENDOR_INGEST_TOKEN in this server's env and
// send it as the `x-ab7-token` header from the website to reject spoofed posts.
app.post('/api/subvendors/ingest', h(async (req,res)=>{
  if(!requireIngestAuth(req, res)) return;
  const rec = normalizeSubvendor(req.body);
  if(!rec.companyName && !rec.officialEmail){
    return res.status(400).json({ ok:false, error:'company_name or official_email required' });
  }
  // De-dupe: same email within the last 60s (double-post guard).
  const dupe = await repo.subvendorEmailSeenRecently(rec.officialEmail, 60000);
  if(dupe){ return res.json({ ok:true, id:dupe, deduped:true }); }
  await repo.createSubvendor(rec);
  console.log('[subvendor] ingested:', rec.companyName, '·', rec.officialEmail);
  res.json({ ok:true, id:rec.id });
}));

app.get('/api/subvendors', h(async (req,res)=>{ res.json((await repo.assembleState()).subvendors || []); }));
app.post('/api/subvendors', h(async (req,res)=>{
  const rec = { ...normalizeSubvendor(req.body), ...(req.body && req.body.stage ? {stage:req.body.stage} : {}) };
  await repo.createSubvendor(rec); res.json(rec);
}));
app.put('/api/subvendors/:id', h(async (req,res)=>{
  const r = await repo.updateSubvendor(req.params.id, { ...req.body, id:req.params.id });
  if(!r) return res.status(404).json({ error:'not found' });
  res.json(r);
}));
app.delete('/api/subvendors/:id', h(async (req,res)=>{ await repo.deleteSubvendor(req.params.id); res.json({ ok:true }); }));

// ----------------------------------------------------------
// Partners  (Become-a-Partner program)
// ----------------------------------------------------------
// Fed by the ab7solutions.com "Become a Partner" apply form. The website's
// /api/partner route forwards each submission here (snake_case payload) after
// storing it in Supabase. We normalise it into the camelCase shape the
// LeadForge Partners module (LF.partners) reads, stamp stage:"New", persist,
// and round-trip it through GET/POST /api/snapshot like leads/subvendors.
function normalizePartner(b){
  b = b || {};
  const createdAt = _submittedAt(b);
  return {
    id: 'pt_' + Math.random().toString(36).slice(2,10),
    stage: 'New', ownerId: null, internalNotes: '',
    fullName: _pick(b, 'full_name','fullName','name'),
    email: _pick(b, 'email','official_email'),
    phone: _pick(b, 'phone','contact_number'),
    whatsapp: _pick(b, 'whatsapp','whatsapp_number'),
    country: _pick(b, 'country'),
    city: _pick(b, 'city'),
    linkedin: _pick(b, 'linkedin','linkedin_url','website'),
    profession: _pick(b, 'profession','role','current_role'),
    companyName: _pick(b, 'company_name','companyName'),
    networks: _arr(b.networks),
    servicesInterested: _arr(b.services_interested || b.servicesInterested),
    sourceRegions: _arr(b.source_regions || b.sourceRegions),
    introVolume: _pick(b, 'intro_volume','introVolume'),
    earningModel: _arr(b.earning_model || b.earningModel),
    aboutNetwork: _pick(b, 'about_network','aboutNetwork'),
    howHeard: _pick(b, 'how_heard','howHeard'),
    profileFileUrl: _pick(b, 'profile_file_url','profileFileUrl'),
    portfolioFileUrl: _pick(b, 'portfolio_file_url','portfolioFileUrl'),
    profileFileLink: _pick(b, 'profile_file_link','profileFileLink'),
    portfolioFileLink: _pick(b, 'portfolio_file_link','portfolioFileLink'),
    declarationAccepted: b.declaration_accepted === true || b.declaration_accepted === 'Yes' || b.declarationAccepted === true,
    source: _pick(b, 'source') || 'become-a-partner apply',
    ipAddress: _pick(b, 'ip_address','ipAddress'),
    userAgent: _pick(b, 'user_agent','userAgent'),
    activities: [{ type:'create', at: createdAt, by: null, text: 'Partner application received from website' }],
    createdAt, updatedAt: Date.now()
  };
}

app.post('/api/partners/ingest', h(async (req,res)=>{
  if(!requireIngestAuth(req, res)) return;
  const rec = normalizePartner(req.body);
  if(!rec.fullName && !rec.email){
    return res.status(400).json({ ok:false, error:'full_name or email required' });
  }
  await repo.createPartner(rec);
  console.log('[partner] ingested:', rec.fullName, '·', rec.email);
  res.json({ ok:true, id:rec.id });
}));

app.get('/api/partners', h(async (req,res)=>{ res.json((await repo.assembleState()).partners || []); }));

// ----------------------------------------------------------
// Job applicants  (Apply-for-a-Job / Careers)
// ----------------------------------------------------------
// Fed by the ab7solutions.com "Apply for a Job" form. The website's /api/job
// route forwards each submission here. Normalised into the shape the LeadForge
// Job Applicants module (LF.jobApplicants) reads, stamped stage:"New".
function normalizeJobApplicant(b){
  b = b || {};
  const createdAt = _submittedAt(b);
  return {
    id: 'ja_' + Math.random().toString(36).slice(2,10),
    stage: 'New', ownerId: null, internalNotes: '',
    fullName: _pick(b, 'full_name','fullName','name'),
    email: _pick(b, 'email'),
    phone: _pick(b, 'phone','contact_number'),
    whatsapp: _pick(b, 'whatsapp','whatsapp_number'),
    roleApplied: _pick(b, 'role_applied','roleApplied','role','position','job_title'),
    experienceYears: _pick(b, 'experience_years','experienceYears','experience'),
    currentLocation: _pick(b, 'current_location','currentLocation','location'),
    country: _pick(b, 'country'),
    linkedin: _pick(b, 'linkedin','linkedin_url'),
    portfolio: _pick(b, 'portfolio','portfolio_url'),
    resumeLink: _pick(b, 'resume_link','resumeLink','resume_file_link','cv_link'),
    resumeFileUrl: _pick(b, 'resume_file_url','resumeFileUrl'),
    noticePeriod: _pick(b, 'notice_period','noticePeriod'),
    expectedSalary: _pick(b, 'expected_salary','expectedSalary'),
    coverNote: _pick(b, 'cover_note','coverNote','message','notes'),
    howHeard: _pick(b, 'how_heard','howHeard'),
    source: _pick(b, 'source') || 'apply-for-a-job',
    ipAddress: _pick(b, 'ip_address','ipAddress'),
    userAgent: _pick(b, 'user_agent','userAgent'),
    activities: [{ type:'create', at: createdAt, by: null, text: 'Job application received from website' }],
    createdAt, updatedAt: Date.now()
  };
}

app.post('/api/jobs/ingest', h(async (req,res)=>{
  if(!requireIngestAuth(req, res)) return;
  const rec = normalizeJobApplicant(req.body);
  if(!rec.fullName && !rec.email){
    return res.status(400).json({ ok:false, error:'full_name or email required' });
  }
  await repo.createJobApplicant(rec);
  console.log('[job] ingested:', rec.fullName, '·', rec.roleApplied || '(no role)');
  res.json({ ok:true, id:rec.id });
}));

app.get('/api/jobs', h(async (req,res)=>{ res.json((await repo.assembleState()).jobApplicants || []); }));

// Settings — read the assembled settings object; write a single key.
// Config collections (serviceDomains, scoringRules, picklists, …) are routed to
// their tables; everything else lands in the app_settings blob.
app.get('/api/settings', h(async (req,res)=>{ res.json((await repo.assembleState()).settings); }));
app.get('/api/settings/:key', h(async (req,res)=>{ res.json((await repo.assembleState()).settings[req.params.key] || null); }));
app.put('/api/settings/:key', h(async (req,res)=>{
  await saveConfig({ [req.params.key]: req.body });
  res.json(req.body);
}));

// ---------- Static portal (ALLOW-LIST ONLY) ----------
// SECURITY: never serve the whole project directory. It contains the datastore
// (data/leadforge.json — leads + password hashes), server source, .env, DB
// backups and the old portal/ copy. Expose ONLY the public front-end assets.
const STATIC_DIRS = ['css', 'js', 'assets'];
STATIC_DIRS.forEach(dir => {
  app.use('/' + dir, express.static(path.join(__dirname, dir), { dotfiles:'deny', index:false }));
});
// A short allow-list of public files that live at the repo root.
const STATIC_ROOT_FILES = new Set(['logo-no-background.png', 'favicon.ico', 'robots.txt']);
app.get('/:file', (req, res, next) => {
  if(STATIC_ROOT_FILES.has(req.params.file)) return res.sendFile(path.join(__dirname, req.params.file));
  next();
});
// SPA shell for every other (non-API) route. Any attempt to reach a sensitive
// path (e.g. /data/leadforge.json, /.env, /server.js) falls through to here and
// just gets index.html — never the file.
app.get('*', (req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'Not found'});
  res.setHeader('Cache-Control','no-cache');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Boot — only listen when run directly (local dev / VPS / EC2). On Vercel this
// module is imported by api/index.js and invoked per-request, so we don't listen.
if(require.main === module){
  app.listen(PORT, ()=>{
    console.log('');
    console.log('  ✓ LeadForge 360 — DB-backed portal running');
    console.log('  ✓ Store:  Supabase relational v2 (' + new URL(SUPABASE_URL).host + ')');
    console.log('  ✓ Tenant: ' + TENANT);
    console.log('  ✓ Open:   http://localhost:' + PORT);
    console.log('');
  });
}

module.exports = app;
