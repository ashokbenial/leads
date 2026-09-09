#!/usr/bin/env node
/**
 * Restore a JSON backup taken by the companion snapshot (backups/<stamp>/<table>.json)
 * back into Supabase, using the REST API + secret key.
 *
 *   node --env-file-if-exists=.env.local scripts/restore-from-backup.js backups/<stamp>
 *   node --env-file-if-exists=.env.local scripts/restore-from-backup.js backups/<stamp> --table leads
 *
 * Upserts by primary key, in FK-safe order, so it is re-runnable and never
 * deletes anything. Rows added after the backup are left alone; rows that were
 * in the backup are restored to their backed-up values.
 *
 * Env: SUPABASE_URL + SUPABASE_SECRET_KEY (same vars db-server.js uses).
 */
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error('✗ SUPABASE_URL + SUPABASE_SECRET_KEY required'); process.exit(1); }
if (/^sb_publishable_/.test(key)) { console.error('✗ publishable key — need the secret key'); process.exit(1); }

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: restore-from-backup.js backups/<stamp> [--table <name>]');
  process.exit(1);
}
const onlyIdx = process.argv.indexOf('--table');
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

// Parents before children — FK constraints reject a child whose parent is absent.
const ORDER = [
  'tenants', 'team_members', 'service_domains', 'services', 'picklists',
  'app_settings', 'leads', 'lead_activities', 'scheduled_tasks',
  'subvendors', 'subvendor_activities', 'partners', 'job_applicants',
  'leadforge_state',
];
// Conflict target per table (its primary key). Tables keyed by a serial id are
// restored without an explicit target so PostgREST uses the PK it finds.
const CONFLICT = {
  app_settings: 'tenant_id',
  leadforge_state: 'tenant',
};

const CHUNK = 200;

async function push(table, rows) {
  const target = CONFLICT[table];
  const qs = target ? `?on_conflict=${target}` : '';
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const res = await fetch(`${url}/rest/v1/${table}${qs}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(slice),
    });
    if (!res.ok) throw new Error(`${table} [${i}..${i + slice.length}): ${res.status} ${await res.text()}`);
  }
}

(async () => {
  let restored = 0, skipped = 0;
  for (const table of ORDER) {
    if (only && table !== only) continue;
    const file = path.join(dir, `${table}.json`);
    if (!fs.existsSync(file)) { console.log(`  – ${table.padEnd(22)} no backup file, skipped`); skipped++; continue; }
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(rows) || !rows.length) { console.log(`  – ${table.padEnd(22)} empty, skipped`); skipped++; continue; }
    try {
      await push(table, rows);
      console.log(`  ✓ ${table.padEnd(22)} ${rows.length} rows`);
      restored += rows.length;
    } catch (e) {
      console.error(`  ✗ ${table.padEnd(22)} ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${restored} rows restored, ${skipped} tables skipped.`);
})();
