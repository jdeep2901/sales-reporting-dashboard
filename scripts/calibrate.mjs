#!/usr/bin/env node
// Recompute the forecast calibration from our own snapshot history.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... DASH_USER=... DASH_PASS=... \
//     node scripts/calibrate.mjs [--limit N]
//
// Prints P(win | deal ever reached stage) on a resolved-deal basis, plus median days from
// first-seen-at-stage to Win. Update CALIBRATION in src/lib/vpCompute.ts by hand from this
// — deliberately not automatic, so one odd month cannot silently move the forecast.

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_ANON_KEY;
const USER = process.env.DASH_USER, PASS = process.env.DASH_PASS;
if (!URL || !KEY || !USER || !PASS) { console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, DASH_USER, DASH_PASS'); process.exit(1); }
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Some machines sit behind a TLS-intercepting proxy that Node does not trust but curl does
// (system keychain). Try fetch, fall back to curl transparently.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
let useCurl = false;
const viaCurl = async (url, body) => {
  const args = ['-s', '--max-time', '120', '-X', 'POST', url, '-H', `apikey: ${KEY}`,
    '-H', `Authorization: Bearer ${KEY}`, '-H', 'Content-Type: application/json', '-d', JSON.stringify(body)];
  const { stdout } = await execFileP('curl', args, { maxBuffer: 1024 * 1024 * 512 });
  return JSON.parse(stdout);
};
const rpc = async (fn, body) => {
  const url = `${URL}/rest/v1/rpc/${fn}`;
  if (!useCurl) {
    try {
      const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${fn} ${r.status}`);
      return await r.json();
    } catch (e) {
      if (!/certificate|fetch failed|UNABLE_TO_VERIFY/i.test(String(e))) throw e;
      console.error('  (TLS not trusted by node — falling back to curl)');
      useCurl = true;
    }
  }
  return viaCurl(url, body);
};

// Stage numbering must match stageNumber() in vpCompute (Contracting is the LAST open stage).
const N = (stage) => {
  const s = String(stage ?? '').trim();
  if (s.startsWith('1.')) return 1;
  if (s.startsWith('2.')) return 2;
  if (s.startsWith('3.')) return 3;
  if (s.startsWith('4.')) return 4;
  if (s.startsWith('6. Commercial')) return 5;
  if (s.startsWith('5. Contracting')) return 6;
  if (s === '7. Win') return 7;
  if (s === '8. Loss') return 8;
  if (/^(9|10|11|12)\.|latent/i.test(s)) return 9;
  return null;
};

const state = await rpc('get_dashboard_state', { p_username: USER, p_password: PASS });
const st = Array.isArray(state) ? state[0] : state;
const versions = (st.versions_meta ?? st.versions ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
const use = versions.slice(-Math.min(versions.length, LIMIT));
console.error(`fetching ${use.length} of ${versions.length} snapshots…`);

const seenAt = new Map();   // item -> { stage -> first date }
const won = new Map();      // item -> first win date
const dead = new Set();

for (const [i, v] of use.entries()) {
  let data;
  try { data = await rpc('get_dashboard_version', { p_username: USER, p_password: PASS, p_version_id: v.id }); }
  catch (e) { console.error(`  skip ${v.created_at.slice(0,10)}: ${e.message}`); continue; }
  const rows = (Array.isArray(data) ? data[0] : data)?.dataset?.all_deals_rows ?? [];
  const day = v.created_at.slice(0, 10);
  for (const r of rows) {
    const id = String(r.item_id ?? ''); if (!id) continue;
    const n = N(r.stage ?? r.deal_stage); if (n == null) continue;
    if (n >= 1 && n <= 6) {
      if (!seenAt.has(id)) seenAt.set(id, new Map());
      const m = seenAt.get(id);
      if (!m.has(n)) m.set(n, day);
    } else if (n === 7) { if (!won.has(id)) won.set(id, day); }
    else if (n === 8 || n === 9) dead.add(id);
  }
  if ((i + 1) % 10 === 0) console.error(`  ${i + 1}/${use.length}`);
}

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const LBL = { 1: 'Intro', 2: 'Qualification', 3: 'Capability', 4: 'Problem Scoping', 5: 'Commercial Proposal', 6: 'Contracting' };
console.log(`\ncalibration from ${use.length} snapshots (${use[0]?.created_at.slice(0,10)} → ${use.at(-1)?.created_at.slice(0,10)})\n`);
console.log('stage                  reached   won   dead  open   P(win|resolved)   median days→win');
for (let n = 1; n <= 6; n++) {
  const ids = [...seenAt.entries()].filter(([, m]) => m.has(n)).map(([id]) => id);
  const w = ids.filter((id) => won.has(id));
  const d = ids.filter((id) => !won.has(id) && dead.has(id));
  const resolved = w.length + d.length;
  const cyc = w.map((id) => days(seenAt.get(id).get(n), won.get(id))).filter((x) => x > 0).sort((a, b) => a - b);
  const med = cyc.length ? cyc[Math.floor(cyc.length / 2)] : null;
  const pct = resolved ? ((w.length / resolved) * 100).toFixed(1) : '—';
  console.log(`${LBL[n].padEnd(22)}${String(ids.length).padStart(7)}${String(w.length).padStart(6)}${String(d.length).padStart(7)}${String(ids.length-w.length-d.length).padStart(6)}${(pct+'%').padStart(18)}${String(med ?? '—').padStart(18)}`);
}
console.log('\nP(win|resolved) = won / (won + dead). Deals still open are excluded — with only a few');
console.log('months of history they right-censor the thin stages, so add a small uplift by hand.');
