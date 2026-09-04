// Keep one save per plan, delete the rest.
//
//   node scripts/prune-plans.mjs            # dry run — prints keep/delete per group
//   node scripts/prune-plans.mjs --apply    # deletes
//
// **Keeps the fullest, not the newest.** `updated_at` stops meaning "when I last
// worked on this" the moment anything touches the rows in bulk — a rename pass,
// or a tab whose `syncPending` replays the offline mirror every 20 seconds. Both
// happened here, and the newest row in the largest group turned out to be one an
// autosave loop had written minutes earlier, with the hand-built version 28
// places below it. Object count cannot be bumped by a heartbeat.
//
// PROTECTED ids are never deleted whatever the counts say: an id somebody typed
// (`img0199-gen`) is a statement that this one is the keeper, and no heuristic
// should be allowed to outvote it. `proj_mtmnlj9g_3` is in there because it was
// being rewritten every 20 seconds while this was being written — something
// live owns it, and "I do not know what this is" is a reason to keep a row, not
// to delete it.
//
// **DELETING FROM HERE IS NOT ENOUGH.** The browser keeps an offline mirror, and
// `syncPending` pushes every mirrored plan the server does not have — so a plain
// DELETE is undone on the next 20-second heartbeat, for all 103 mirrored plans.
// Deletion has to go through `deleteProject`'s semantics: drop the mirror entry,
// write a tombstone, then DELETE, and only clear the tombstone once the server
// has confirmed. This script is therefore the *planner*; run the dry run to
// agree the list, then delete from the page so the tombstones get written.

const API = process.env.API ?? 'http://localhost:8791';
const APPLY = process.argv.includes('--apply');

const PROTECTED = new Set(['img0199-gen', 'img0199-raw', 'img0199', 'img9720']);

const j = async (url, opts) => {
  const r = await fetch(API + url, opts);
  if (!r.ok) throw new Error(`${opts?.method ?? 'GET'} ${url} → ${r.status}`);
  return r.json();
};

/** Strip the disambiguating suffix so versions of one plan land in one group. */
const stemOf = (name) => String(name ?? '')
  .replace(/・\d+\/\d+(\s+\d+:\d+)?/g, '')
  .replace(/\s*#\d+$/, '')
  .trim();

const metas = (await j('/api/projects')).projects ?? [];
const rows = [];
for (const m of metas) {
  let full;
  try { full = await j('/api/projects/' + m.id); } catch { continue; }
  const d = full.data;
  if (!d || typeof d !== 'object') continue;
  const objs = ((d.project ? d.project.floors : d.floors) ?? []).flatMap(f => f.objects ?? []);
  rows.push({ id: m.id, name: full.name ?? m.name, at: m.updatedAt, n: objs.length });
}

const groups = new Map();
for (const r of rows) {
  const k = stemOf(r.name);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const keep = new Set(), drop = [];
for (const [k, g] of groups) {
  // Fullest wins; a tie goes to the newer, which is as good a coin as any.
  const sorted = [...g].sort((a, b) => (b.n - a.n) || String(b.at).localeCompare(String(a.at)));
  keep.add(sorted[0].id);
  for (const r of g) if (PROTECTED.has(r.id)) keep.add(r.id);
  for (const r of g) if (!keep.has(r.id)) drop.push({ ...r, group: k });
}

console.log(`${rows.length} 份 → 保留 ${keep.size}，刪除 ${drop.length}\n`);
for (const [k, g] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  if (g.length < 2) continue;
  const kept = g.filter(r => keep.has(r.id));
  console.log(`【${k}】${g.length} 份`);
  for (const r of kept) console.log(`   留 ${r.id.padEnd(20)} ${String(r.n).padStart(3)} 物件  ${r.at}${PROTECTED.has(r.id) ? '  (保護)' : ''}`);
  console.log(`   刪 ${g.length - kept.length} 份，最大的 ${Math.max(0, ...g.filter(r => !keep.has(r.id)).map(r => r.n))} 物件\n`);
}

if (!APPLY) { console.log('（乾跑。加 --apply 才會刪除）'); process.exit(0); }

let ok = 0, fail = 0;
for (const r of drop) {
  try { await j('/api/projects/' + r.id, { method: 'DELETE' }); ok++; }
  catch (e) { fail++; console.error(`  ✗ ${r.id}: ${e.message}`); }
}
console.log(`\n刪除 ${ok} 份，失敗 ${fail} 份，保留 ${keep.size} 份`);
