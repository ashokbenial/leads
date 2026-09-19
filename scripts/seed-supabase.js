#!/usr/bin/env node
/**
 * Seed a Supabase project's leadforge_state row from a JSON document.
 *
 *   node scripts/seed-supabase.js --check
 *   node scripts/seed-supabase.js backups/SEED-prod.json
 *   node scripts/seed-supabase.js backups/SEED-prod.json --force
 *
 * Reads SUPABASE_URL + SUPABASE_SECRET_KEY from the environment (or .env.local
 * via `npm run seed`). It writes to WHICHEVER PROJECT THOSE POINT AT — so it
 * prints the target host and refuses to clobber a row that already holds leads
 * unless you pass --force.
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const TENANT = 'ab7-solutions';
const TABLE = 'leadforge_state';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FORCE = args.includes('--force');
const file = args.find(a => !a.startsWith('--')) || 'backups/SEED-prod.json';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SECRET_KEY || '';
if (!url || !key) {
  console.error('✗ SUPABASE_URL and SUPABASE_SECRET_KEY must be set.');
  process.exit(1);
}
if (/^sb_publishable_/.test(key)) {
  console.error('✗ SUPABASE_SECRET_KEY is a publishable key. RLS will silently hide every row.');
  console.error('  Use the secret key: Settings → API Keys → Secret keys (sb_secret_…).');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const COLLECTIONS = ['leads', 'subvendors', 'partners', 'jobApplicants', 'scheduledTasks', 'teamMembers'];
const counts = d => COLLECTIONS.map(k => `${k}=${(d[k] || []).length}`).join('  ');

async function readRow() {
  const { data, error } = await supabase
    .from(TABLE).select('data,updated_at').eq('tenant', TENANT).maybeSingle();
  if (error) throw new Error(`read failed: ${error.message}`);
  return data;
}

// Validate the seed document BEFORE opening a connection, so a malformed file
// can never leave us half-committed against the wrong project.
function loadSeed(path) {
  if (!fs.existsSync(path)) { console.error(`✗ Seed file not found: ${path}`); process.exit(1); }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch (e) { console.error(`✗ ${path} is not valid JSON: ${e.message}`); process.exit(1); }

  // Must already be in server shape: extended config nested under `settings`,
  // not at top level. A raw browser localStorage export is NOT.
  if (!doc.settings || typeof doc.settings !== 'object') {
    console.error('✗ Document has no `settings` object — this looks like a raw browser export,');
    console.error('  not a server document. POST it through db-server.js first to normalise it.');
    process.exit(1);
  }
  if (!Array.isArray(doc.leads)) {
    console.error('✗ Document has no `leads` array. Refusing to seed.');
    process.exit(1);
  }
  const admin = (doc.teamMembers || []).some(m => m && m.role === 'Admin' && m.credentials && m.credentials.passwordHash);
  if (!admin) {
    console.warn('  ⚠ No Admin with credentials in this document — you will land on the first-run setup screen.');
  }
  return doc;
}

(async () => {
  const doc = CHECK ? null : loadSeed(file);

  console.log(`\n  Target : ${new URL(url).host}`);
  console.log(`  Row    : ${TABLE} / ${TENANT}`);
  if (doc) {
    console.log(`  Seed   : ${file}`);
    console.log(`  Data   : ${counts(doc)}`);
  }
  console.log('');

  const existing = await readRow();
  if (existing && existing.data) {
    console.log(`  Current row: ${counts(existing.data)}`);
    console.log(`  updated_at : ${existing.updated_at}\n`);
  } else {
    console.log('  Current row: (absent — table is empty)\n');
  }

  if (CHECK) return;

  const hasData = existing && existing.data && (existing.data.leads || []).length > 0;
  if (hasData && !FORCE) {
    console.error('✗ The target row already holds leads. Refusing to overwrite.');
    console.error('  Back it up first, then re-run with --force if you really mean it.');
    process.exit(1);
  }

  doc.tenant = TENANT;
  doc.lastWriteAt = new Date().toISOString();

  const { error } = await supabase.from(TABLE).upsert(
    { tenant: TENANT, data: doc, updated_at: doc.lastWriteAt },
    { onConflict: 'tenant' }
  );
  if (error) { console.error(`✗ write failed: ${error.message}`); process.exit(1); }

  const after = await readRow();
  if (!after || !after.data) { console.error('✗ Wrote, but read-back returned nothing. Check RLS / key.'); process.exit(1); }
  console.log(`  ✓ Seeded. Read-back: ${counts(after.data)}`);
  console.log(`  ✓ updated_at: ${after.updated_at}\n`);
})().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });
