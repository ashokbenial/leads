#!/usr/bin/env node
/**
 * Build a server-shaped seed document from a browser localStorage export.
 *
 *   node scripts/normalize-seed.js <browser-export.json> <base-server-doc.json> <out.json>
 *
 * Replicates db-server.js's POST /api/snapshot transform EXACTLY: collections
 * stay top-level, the settingsKeys allowlist moves under `settings`, everything
 * else (ephemeral client state: user, session, route, _quotaWarned, …) is
 * dropped. Starts from a base server doc so `tenant`, company shape, and any
 * settings key the browser lacks are preserved — exactly what loadState() does.
 */
const fs = require('fs');
const [,, browserPath, basePath, outPath] = process.argv;
if (!browserPath || !basePath || !outPath) {
  console.error('usage: node scripts/normalize-seed.js <browser.json> <base-server.json> <out.json>');
  process.exit(1);
}
const snap = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
const state = JSON.parse(fs.readFileSync(basePath, 'utf8'));
state.settings = state.settings || {};

// --- mirror of POST /api/snapshot (db-server.js) ---
if (Array.isArray(snap.leads)) state.leads = snap.leads.map(l => ({ ...l, currency: 'INR' }));
if (Array.isArray(snap.subvendors)) state.subvendors = snap.subvendors;
if (Array.isArray(snap.partners)) state.partners = snap.partners;
if (Array.isArray(snap.jobApplicants)) state.jobApplicants = snap.jobApplicants;
if (Array.isArray(snap.scheduledTasks)) state.scheduledTasks = snap.scheduledTasks;
if (Array.isArray(snap.teamMembers)) state.teamMembers = snap.teamMembers;
if (snap.company) state.company = { ...snap.company, billing: { ...(snap.company.billing || {}), currency: 'INR' } };

const settingsKeys = ['scoringRules','serviceDomains','serviceCatalog','qualificationTemplates',
  'industries','countries','currencies','taskKanbanStatuses','notificationPrefs',
  'apiKeys','scim','emailDelivery','emailDns','emailPrefs','emailAccounts','emailAliases',
  'emailLog','emailDeliveryLog','claudeConfig','claudeUsage','integrationConfig','integrations',
  'customFields','mailbox','agentConfig','agentLogs','hitlQueue',
  'winCategories','winListReasons','lossCategories','notInListReasons','routingRules',
  'formulaName','formulaExpression','formulaPublished'];
settingsKeys.forEach(k => { if (snap[k] !== undefined) state.settings[k] = snap[k]; });
state.settings.currencies = ['INR'];

state.tenant = 'ab7-solutions';
state.lastWriteAt = state.lastWriteAt || null; // seed script stamps the real value

// --- report which browser keys were intentionally dropped ---
const kept = new Set([...settingsKeys, 'leads','subvendors','partners','jobApplicants',
  'scheduledTasks','teamMembers','company','tenant','lastWriteAt']);
const dropped = Object.keys(snap).filter(k => !kept.has(k)).filter(k => {
  const v = snap[k];
  return Array.isArray(v) ? v.length : (v && typeof v === 'object') ? Object.keys(v).length : (v !== null && v !== '' && v !== false);
});

fs.writeFileSync(outPath, JSON.stringify(state, null, 2));
console.log('✓ wrote ' + outPath);
console.log('  leads=' + state.leads.length + '  team=' + state.teamMembers.length +
  '  subvendors=' + (state.subvendors || []).length + '  settings-keys=' + Object.keys(state.settings).length);
console.log('  formula: ' + JSON.stringify(state.settings.formulaName) + ' published=' + state.settings.formulaPublished);
console.log('  win/loss lists: winCat=' + (state.settings.winCategories || []).length +
  ' lossCat=' + (state.settings.lossCategories || []).length + ' routingRules=' + (state.settings.routingRules || []).length);
if (dropped.length) console.log('  dropped (client-ephemeral, expected): ' + dropped.join(', '));
