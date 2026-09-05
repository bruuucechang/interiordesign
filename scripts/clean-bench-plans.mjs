// Bin the plans the benches left behind.
//
//   node scripts/clean-bench-plans.mjs            # dry run
//   node scripts/clean-bench-plans.mjs --apply
//
// Opening the app creates a plan as soon as anything is drawn, and most benches
// draw. `isBlankPlan` correctly lets those through — they are not blank — so
// every bench run leaves a row behind, and after three sweeps the user's list
// had grown twice. Cleaning it by hand each time is how it gets forgotten.
//
// The signature is deliberately narrow: created today, tiny, and named like a
// throwaway. **Anything with real content is left alone even if it matches
// everything else** — a wrong deletion here costs somebody their afternoon, and
// a missed one costs a row in a list.

const API = process.env.API ?? 'http://localhost:8791';
const APPLY = process.argv.includes('--apply');

/** Names the benches produce: the blank default, or a single throwaway letter. */
const THROWAWAY = /^(未命名平面圖|Untitled plan|[a-z]{1,2})$/i;
/** Anything with more objects than this is somebody's work, whatever it is called. */
const MAX_OBJECTS = 20;
/** Only today's. An old row with a bad name is still not ours to guess about. */
const MAX_AGE_HOURS = 24;

const j = async (u, o) => {
  const r = await fetch(API + u, o);
  if (!r.ok) throw new Error(`${o?.method ?? 'GET'} ${u} → ${r.status}`);
  return r.json();
};

const metas = (await j('/api/projects')).projects ?? [];
const now = Date.now();
const hits = [];

for (const m of metas) {
  const at = Date.parse(String(m.updatedAt ?? '').replace(' ', 'T'));
  if (Number.isNaN(at) || (now - at) / 3.6e6 > MAX_AGE_HOURS) continue;
  if (!THROWAWAY.test(String(m.name ?? '').trim())) continue;
  let full;
  try { full = await j('/api/projects/' + m.id); } catch { continue; }
  const objs = ((full.data?.project ? full.data.project.floors : full.data?.floors) ?? [])
    .flatMap(f => f.objects ?? []);
  if (objs.length > MAX_OBJECTS) continue;   // has real content — not ours
  hits.push({ id: m.id, name: m.name, n: objs.length, at: m.updatedAt });
}

console.log(`${metas.length} 份中，符合 bench 殘留特徵的：${hits.length}`);
for (const h of hits) console.log(`  ${h.id.padEnd(22)} ${String(h.n).padStart(3)} 物件  ${h.name}  ${h.at}`);

if (!hits.length) process.exit(0);
if (!APPLY) { console.log('\n（乾跑。加 --apply 才會移到回收桶——刪除是軟刪，30 天內救得回來）'); process.exit(0); }

let ok = 0;
for (const h of hits) {
  try { await j('/api/projects/' + h.id, { method: 'DELETE' }); ok++; }
  catch (e) { console.error(`  ✗ ${h.id}: ${e.message}`); }
}
console.log(`\n移到回收桶 ${ok} 份`);
