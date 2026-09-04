// Give every saved plan a name that says what is in it.
//
//   node scripts/name-plans.mjs             # dry run — prints every rename
//   node scripts/name-plans.mjs --apply     # writes
//   node scripts/name-plans.mjs --apply --only=proj_x,proj_y
//
// 219 plans, 150 of them called 未命名平面圖 and a dozen more called `s`, `c`,
// `k`. The open dialog's search cannot help with that: every row matches
// nothing, or 36 rows match identically. So the name has to come from the plan.
//
// Two rules, and the second is the one that matters:
//
//   1. A plan that already has a real name keeps it. Renaming
//      「A1 單元（IMG_0199 成品）」to「8個房間・110㎡」would throw away the only
//      thing in the string a person put there.
//   2. A name is only useful if it is *different from its neighbours*. Sixteen
//      plans share that A1 name and their contents genuinely differ (44–85
//      objects, 85–125 m²), so the suffix is added to the ones that collide,
//      and only as far as it takes to separate them: date first, then size.
//
// Both the row's `name` column and `data.name` are written. `saveProject` sends
// both and the app reads `data.name` into the title field, so setting one and
// not the other means the next save puts the old name back.

const API = process.env.API ?? 'http://localhost:8791';
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) ?? '').slice(7)
  .split(',').map(s => s.trim()).filter(Boolean);

const j = async (url, opts) => {
  const r = await fetch(API + url, opts);
  if (!r.ok) throw new Error(`${opts?.method ?? 'GET'} ${url} → ${r.status}`);
  return r.json();
};

/** Names that carry no information — everything else is treated as deliberate. */
const isPlaceholder = (n) =>
  !n || !n.trim() || /^未命名平面圖$/.test(n.trim()) || /^[a-z]{1,2}$/i.test(n.trim());

const polyArea = (pts) => {
  let a = 0;
  for (let i = 0, k = pts.length - 1; i < pts.length; k = i++)
    a += (pts[k].x + pts[i].x) * (pts[k].y - pts[i].y);
  return Math.abs(a / 2) / 10000;   // cm² → m²
};

/** What the plan is, in as few words as carry a decision. */
function describe(objs) {
  if (!objs.length) return '空白圖';
  const by = (k) => objs.filter(o => o.kind === k);
  const rooms = by('room'), walls = by('wall'), furn = by('furniture');
  const area = rooms.reduce((s, o) => s + (o.poly?.length >= 3 ? polyArea(o.poly) : (o.w * o.h) / 10000), 0);

  if (rooms.length) {
    // Area first: it is the number you recognise a plan by. Room count second,
    // furniture only when there is any.
    const bits = [];
    if (area >= 1) bits.push(`${Math.round(area)}㎡`);
    bits.push(`${rooms.length} 室`);
    if (furn.length) bits.push(`${furn.length} 件家具`);
    return bits.join('・');
  }
  if (walls.length) return `${walls.length} 道牆`;
  return `${objs.length} 個物件`;
}

const parseAt = (iso) => {
  const t = Date.parse(String(iso ?? '').replace(' ', 'T'));
  return Number.isNaN(t) ? null : new Date(t);
};
const md = (d) => d && `${d.getMonth() + 1}/${d.getDate()}`;
const hm = (d) => d && `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const metas = (await j('/api/projects')).projects ?? [];
const plans = [];
for (const m of metas) {
  if (ONLY.length && !ONLY.includes(m.id)) continue;
  let full;
  try { full = await j('/api/projects/' + m.id); } catch { continue; }
  const data = full.data;
  if (!data || typeof data !== 'object') continue;
  const objs = ((data.project ? data.project.floors : data.floors) ?? []).flatMap(f => f.objects ?? []);
  const at = parseAt(m.updatedAt ?? m.updatedAtIso);
  plans.push({
    id: m.id, was: full.name ?? m.name, data, objs, at,
    stem: isPlaceholder(full.name ?? m.name) ? describe(objs) : (full.name ?? m.name).trim(),
  });
}

// Escalate only as far as it takes to separate neighbours.
//
// The first version escalated by appending the size — and produced
// 「1 個房間・220㎡・7 件家具・8/19・8 件・220㎡ #1」, which says 220㎡ twice and
// is no easier to tell from the row below than the bare name was. When two
// saves have identical *contents*, the thing that differs is **when they were
// saved**, so that is what the suffix has to carry.
const countBy = (arr, key) => arr.reduce((m, x) => (m.set(key(x), (m.get(key(x)) ?? 0) + 1), m), new Map());
for (const p of plans) p.name = p.at ? `${p.stem}・${md(p.at)}` : p.stem;
const lvl1 = countBy(plans, p => p.name);
for (const p of plans) if (lvl1.get(p.name) > 1 && p.at) p.name = `${p.stem}・${md(p.at)} ${hm(p.at)}`;
// Same content, same minute — genuinely indistinguishable. A visible「#2」beats
// two rows that silently are not the same plan.
const lvl2 = countBy(plans, p => p.name);
const seen = new Map();
for (const p of plans) {
  if (lvl2.get(p.name) > 1) {
    const i = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, i);
    p.name = `${p.name} #${i}`;
  }
}

const changed = plans.filter(p => p.name !== p.was);
console.log(`${plans.length} 份，${changed.length} 份會改名，${plans.length - changed.length} 份維持原樣`);
console.log(`原名是佔位字的：${plans.filter(p => isPlaceholder(p.was)).length}`);
console.log(`名字仍然重複的：${[...countBy(plans, p => p.name)].filter(([, c]) => c > 1).length}\n`);
for (const p of changed) console.log(`  ${p.id.padEnd(20)} ${String(p.was).padEnd(30)} → ${p.name}`);

if (!APPLY) { console.log('\n（乾跑。加 --apply 才會寫入）'); process.exit(0); }

let ok = 0, fail = 0;
for (const p of changed) {
  try {
    // The plan's own `name` travels inside `data`; leave it disagreeing with the
    // row and the next autosave writes the old one back over this.
    const data = { ...p.data, name: p.name };
    await j('/api/projects/' + p.id, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: p.name, data }),
    });
    ok++;
  } catch (e) {
    fail++;
    console.error(`  ✗ ${p.id}: ${e.message}`);
  }
}
console.log(`\n寫入 ${ok} 份，失敗 ${fail} 份`);
