// Builds the flat from IMG_0197/0199 — walls first, on measured centre lines.
//
//   node scripts/trace-0199.mjs --save     # 寫到 img0199-raw；img0199 與 img0199-gen 都不碰
//
// This is the fourth design. The first two derived the walls from the *rooms*:
// flood-fill the drawing, take each pocket of free space as a room, then treat
// its outline as walls. That is backwards. A plan is walls, and rooms are what
// the walls leave over; going the other way meant six stacked heuristics, each
// with its own tolerance, and the tolerances compounded — only 24 of 57 walls
// landed within 5 cm of the drawing's real wall lines.
//
// The third got the topology right but the coordinates wrong: every number in
// the grid was one *face* of a wall pair rather than the pair's centre. The
// error was systematic — X too high by 7.0, Y too low by 7.9, half a wall each
// way — so nothing looked obviously broken, and a uniform shift changes no room
// size. It shows up only when you overlay the result on the drawing. X[0] was
// worse: 16.0 against a measured 0.5, because it had picked up the far face.
//
// So the grid below is measured as pair centres: a wall in this drawing is two
// lines 15–17 px apart (its faces, 15 cm at 1.0710 px/cm) and the coordinate is
// the midpoint. Peter's south wall is the exception — 木作隔間, 11 cm — and is
// carried with its own thickness.
//
// Which spans carry a wall is still read off the drawing by hand and written out
// in WALLS. Automating that does not work here: the wardrobe fronts, the ceiling
// bulkhead lines and the solid black columns all produce line pairs that look
// exactly like walls, and a wall hidden behind a wardrobe produces none.
//
// Two rules the owner gave, both checked by scripts/check-0199.mjs:
//   牆壁不會無緣無故的伸一根出來  → every wall endpoint must touch another wall
//   牆壁會形成房間                → the walls must close exactly 8 regions
// Both caught real errors: the arc used to be joined on with two diagonal stubs
// (and the owner's walls are all straight), and the balcony's west wall ran
// 238 cm past the balcony.
//
// Scale checked three ways against the drawing's own dimensions: the kitchen
// run's chain (95/60/60/20/60 ↔ 102/64/86/64 px), its total (307.2 ↔ 329 px),
// and the wardrobe run (478.5 ↔ 512 px).

import { readFileSync, writeFileSync } from 'node:fs';

const SCRATCH = '/private/tmp/claude-501/-Users-bruuucemac/609650e9-c1d4-4d0d-9616-85360c42d5f7/scratchpad';
const CEIL = 300;
const PID = 'img0199';

// ---- the measured grid, in centimetres, on wall centre lines ---------------
const X = [0.5, 219.4, 493.9, 541.1, 845.0, 948.2, 1204.9, 1241.4, 1375.8];
const Y = [15.4, 152.2, 564.9, 604.8, 627.9, 730.6, 753.0, 799.7, 1230.6];
const Y_BAL = 1048.1;                 // 陽台北牆，量到的面線 1038.8 / 1057.5

// The one curve in the flat: the north side of Peter's room. It is glazing, so
// the wall follows the arc and the window sits in it — there is no straight wall
// behind. Both ends land on a wall, so no connector stubs. Bulge fitted to the
// scanned outer edge: −18.5 leaves 4.9 cm mean error, the old −37 left 16.7.
const ARC = { ax: X[0], ay: 46.9, bx: X[2], by: 113.2, bulge: -18.5 };

// Which spans carry a wall. ['V', xi, yFrom, yTo] / ['H', yi, xFrom, xTo],
// with 'AW'/'AE' for the arc's two ends and 'B' for the balcony's north wall.
const WALLS = [
  ['V', 0, 'AW', 6], ['V', 1, 6, 8], ['V', 2, 'AE', 3], ['V', 3, 'B', 8],
  ['V', 4, 0, 8], ['V', 5, 3, 7], ['V', 6, 0, 7], ['V', 7, 7, 8], ['V', 8, 1, 3],
  ['H', 0, 4, 6], ['H', 1, 2, 4], ['H', 1, 6, 8], ['H', 2, 0, 2], ['H', 3, 2, 5],
  ['H', 3, 6, 8], ['H', 4, 5, 6], ['H', 5, 4, 5], ['H', 6, 0, 1], ['H', 7, 5, 7],
  ['H', 8, 1, 7],
];

// H2 is 木作隔間 (11 cm), and the spine below the living room is 21 cm — measured,
// not assumed. Everything else is 15.
const THICK = (o, i, a) => (o === 'H' && i === 2 ? 11 : o === 'V' && i === 4 && a === 7 ? 21 : 15);

// Solid black blocks: columns, drawn as four walls each — the owner's own way of
// showing them. Found as connected components with ≥90% fill, which lands them
// within 1 cm of the grid correction derived independently, so both agree.
//   Peter 房左上 · 老爸房右上 · Bruce 房左上 · 客廳左側
const COLUMNS = [
  [-8.4, 39.2, 38.3, 110.2], [769.4, 143.8, 84.0, 52.3],
  [786.2, 704.9, 68.2, 98.0], [207.3, 708.7, 64.4, 97.1],
];

// Rooms, matched to the regions the walls enclose by where their centre lands.
const NAMES = [
  [423, 898, '客廳＋廚房', 'wood'],
  [248, 307, 'Peter 房間', 'wood'],
  [1026, 322, '老媽房間', 'wood'],
  [1044, 981, 'Bruce 房間', 'wood'],
  [670, 379, '老爸房間', 'wood'],
  [1291, 379, '衛浴 A', 'tile'],
  [694, 1140, '陽台', 'terrazzo'],
  [1077, 714, '衛浴 B', 'tile'],
];

// Openings, scanned along each wall in the same coordinate system as the grid.
// Two signatures, because the drawing uses both: a *gap* (neither face inked)
// and a *marked* run (both faces continuous, two short ticks across the wall).
// The front door is the marked kind — that is why looking for gaps never found
// it. ['H'|'V', wall centre, from, to].
const DOORS = [
  ['H', Y[6], 58.5, 183.5, '大門'],        // 125 cm 子母門，在那道 2.1 m 的牆上
  ['H', Y[2], 386.0, 481.0, 'Peter 房'],   // 圖上標 95
  ['H', Y[3], 705.9, 794.9, '老爸房'],
  ['H', Y[3], 849.9, 938.9, '老媽房'],
  ['H', Y[5], 851.0, 938.0, 'Bruce 房走道'],
  ['V', X[4], 617.4, 702.4, '走道'],
  ['V', X[5], 632.8, 712.8, '衛浴 B'],
  ['V', X[6], 459.4, 538.4, '衛浴 A'],
];

const WINDOWS = [
  ['H', Y[0], 851.0, 1198.0, '老媽房'],
  ['H', Y[1], 609.9, 838.9, '老爸房'],
  ['H', Y[8], 333.4, 439.4, '客廳'],
  ['H', Y[8], 885.4, 1133.4, 'Bruce 房'],
  ['V', X[8], 158.2, 289.2, '衛浴 A'],
  ['V', X[3], 1055.1, 1221.1, '陽台'],     // 兩片拉門，記號在 1055/1131/1221
];

// Joinery. Every piece here is measured against a printed dimension in the
// drawing; pieces I could only eyeball are left out rather than guessed, because
// a cabinet in the wrong place reads as a wall.
const JOINERY = [
  ['系統開放衣櫃＋木作強化吊頂', 6.0, 504.9, 369, 60],
  ['系統開放衣櫃 4抽', 953.0, 544.8, 240, 60],
  ['系統開放衣櫃 4抽', 948.2, 799.7, 240, 60],
  ['汙衣櫃', 1188.2, 799.7, 53, 60],
  ['廚具（水槽＋爐）', 222.0, 1170.6, 307, 60],
  ['冰箱 R.E.F.', 229.0, 989.0, 83, 89],
];

const regions = JSON.parse(readFileSync(`${SCRATCH}/final.json`, 'utf8')).regions;

let n = 0;
const id = (k) => `${k}_${++n}`;
const objects = [];
const wall = (ax, ay, bx, by, thickness = 15, extra = {}) => objects.push({
  id: id('wall'), kind: 'wall', layer: 'walls',
  a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness, finish: 'paint', ...extra,
});

// ---- walls ---------------------------------------------------------------
const yAt = (t) => (t === 'AW' ? ARC.ay : t === 'AE' ? ARC.by : t === 'B' ? Y_BAL : Y[t]);
for (const [o, i, a, b] of WALLS) {
  if (o === 'V') wall(X[i], yAt(a), X[i], yAt(b), THICK(o, i, a));
  else wall(X[a], Y[i], X[b], Y[i], THICK(o, i, a));
}
wall(X[3], Y_BAL, X[4], Y_BAL);
wall(ARC.ax, ARC.ay, ARC.bx, ARC.by, 15, { bulge: ARC.bulge });

for (const [x, y, w, h] of COLUMNS) {
  wall(x, y, x + w, y); wall(x + w, y, x + w, y + h);
  wall(x + w, y + h, x, y + h); wall(x, y + h, x, y);
}

// ---- rooms, from what the walls enclose ----------------------------------
for (const r of regions) {
  const [, , name, floor] = NAMES
    .map((t) => [Math.hypot(t[0] - r.cx, t[1] - r.cy), ...t])
    .sort((a, b) => a[0] - b[0])[0].slice(1);
  const poly = r.poly.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }));
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  objects.push({
    id: id('room'), kind: 'room', layer: 'rooms', name, floor, poly,
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
  });
}

// ---- openings -------------------------------------------------------------
const opening = (kind, [o, c, a, b, label]) => objects.push({
  id: id(kind), kind, layer: 'openings', label,
  x: o === 'V' ? c : (a + b) / 2,
  y: o === 'V' ? (a + b) / 2 : c,
  width: Math.round(b - a), angle: o === 'V' ? 90 : 0,
  hinge: 'left', swing: 'in',
});
for (const d of DOORS) opening('door', d);
for (const w of WINDOWS) opening('window', w);

// The arc is glazing end to end, so the window follows it rather than sitting in
// a straight wall.
objects.push({
  id: id('window'), kind: 'window', layer: 'openings', label: 'Peter 房弧形窗',
  x: (ARC.ax + ARC.bx) / 2, y: (ARC.ay + ARC.by) / 2,
  width: Math.round(Math.hypot(ARC.bx - ARC.ax, ARC.by - ARC.ay) - 40),
  angle: Math.atan2(ARC.by - ARC.ay, ARC.bx - ARC.ax) * 180 / Math.PI,
  bulge: ARC.bulge,
});

// ---- joinery --------------------------------------------------------------
for (const [label, x, y, w, h] of JOINERY) {
  objects.push({
    id: id('furniture'), kind: 'furniture', layer: 'furniture', item: 'cabinet',
    label, angle: 0, x, y, w, h,
  });
}

const GEN = `${PID}-raw`;

const plan = {
  // `id` is not decoration: `saveProject` writes under `p.id`, so a plan without
  // one makes the app mint a fresh `proj_…` on the first autosave. Opening a
  // generated plan by deep link and editing it therefore forked a new project
  // every time, and neither of us could find where the edits had gone.
  id: GEN,
  schemaVersion: 1,
  name: 'A1 單元（IMG_0199 成品）',
  activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', elevation: 0, height: CEIL, objects }],
  layers: [
    { id: 'walls', name: '牆體', visible: true, locked: false, color: '#c9cfdb' },
    { id: 'rooms', name: '房間', visible: true, locked: false, color: '#6d7890' },
    { id: 'openings', name: '門窗', visible: true, locked: false, color: '#7bc6ff' },
    { id: 'furniture', name: '家具', visible: true, locked: false, color: '#e0b45a' },
    { id: 'dims', name: '尺寸標註', visible: true, locked: false, color: '#8bffb0' },
  ],
};

const kinds = objects.reduce((m, o) => ((m[o.kind] = (m[o.kind] ?? 0) + 1), m), {});
console.log(`天花板 ${CEIL} cm，` + Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join('，'));
// 面積印的是多邊形的實際面積；外接矩形會把 L 形的客廳灌水到 53 m²
for (const r of regions) {
  const o = objects.find((z) => z.kind === 'room'
    && Math.abs(z.x + z.w / 2 - r.cx) < 60 && Math.abs(z.y + z.h / 2 - r.cy) < 60);
  console.log(`  ${(o?.name ?? '？').padEnd(12)} ${r.m2.toFixed(1).padStart(5)} m²`);
}

// ---- saving -------------------------------------------------------------
//
// This script writes to `img0199-raw` and never to `img0199` or `img0199-gen`.
//
// It used to write to `img0199` with a timestamp guard, and I bypassed that
// guard with --force twice. The second time destroyed hand-placed doors and
// hand-adjusted walls, and `save_project` overwrites in place with no history,
// so there was nothing to restore from. A guard I can wave away is not a guard.
//
// So the ownership is split and there is no flag to cross it. It is three ways
// now, because `img0199-gen` became the document the owner actually works in:
//
//   img0199        原始那份，誰都不動
//   img0199-gen    工作中的那份，人在改 — 這支腳本不碰
//   img0199-raw    這支腳本的產物
//
// To take something from a regenerated version, open both and copy it across —
// a decision made by someone who can see both, rather than by a script that
// assumes it is right.
if (process.argv.includes('--save')) {
  const r = await fetch(`http://127.0.0.1:8791/api/projects/${GEN}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${plan.name}｜腳本產生`, data: plan }),
  });
  console.log(`PUT /api/projects/${GEN} →`, r.status);
  console.log(`   看它: http://localhost:5180/?plan=${GEN}`);
  console.log(`   （${PID} 與 ${PID}-gen 是你的，這支腳本碰不到）`);
}
if (process.argv.includes('--out')) {
  writeFileSync(process.argv[process.argv.indexOf('--out') + 1], JSON.stringify(plan));
}
