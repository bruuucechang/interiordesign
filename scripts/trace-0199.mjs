// Builds the flat from IMG_0197/0199 — walls first.
//
//   node scripts/trace-0199.mjs --save [--force]
//
// This is the third design and the first sound one. The first two derived the
// walls from the *rooms*: flood-fill the drawing, take each pocket of free
// space as a room, then treat its outline as walls. That is backwards. A plan
// is walls, and rooms are what the walls leave over; going the other way meant
// six stacked heuristics — dilation compensation, coordinate clustering,
// orthogonalisation, notch flattening, face merging — each with its own
// tolerance, and the tolerances compounded. Measured against the drawing's real
// wall lines, only 24 of 57 walls landed within 5 cm; the median error was 6 cm
// and the worst 2.3 m.
//
// So: walls come from the grid below, which is measured. A wall in this drawing
// is a pair of lines 15–17 px apart — its two faces, 15 cm apart at 1.0710 px
// per cm — and their centres are the numbers in X[] and Y[]. Which spans
// actually carry a wall is read off the drawing and written out explicitly in
// WALLS; that part resisted automation, because a wall hidden behind a wardrobe
// leaves no line pair to find, and every attempt to infer it from the rooms put
// it somewhere else.
//
// Rooms are then derived from the walls, not measured separately — the same
// direction the building was built in. Names are the only human input.
//
// Scale checked three ways against the drawing's own dimensions: the kitchen
// run's chain (95/60/60/20/60 ↔ 102/64/86/64 px), its total (307.2 ↔ 329 px),
// and the wardrobe run (478.5 ↔ 512 px).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SCRATCH = '/private/tmp/claude-501/-Users-bruuucemac/609650e9-c1d4-4d0d-9616-85360c42d5f7/scratchpad';
const CEIL = 300;
const PID = 'img0199';
const STAMP = `${SCRATCH}/img0199.stamp`;

// ---- the measured grid, in centimetres -----------------------------------
const X = [16.0, 226.0, 500.5, 548.1, 852.5, 955.2, 1212.0, 1248.4, 1382.8];
const Y = [7.5, 143.8, 570.5, 597.6, 620.0, 722.7, 745.1, 791.8, 1223.2];
const Y_BAL = 1030.0;                 // 陽台北牆 — no line pair, measured off the ink

// Which spans carry a wall. ['V', xIndex, yFrom, yTo] / ['H', yIndex, xFrom, xTo].
const WALLS = [
  ['V', 0, 1, 6], ['V', 1, 6, 8], ['V', 2, 1, 3], ['V', 3, 7, 8], ['V', 4, 0, 8],
  ['V', 5, 3, 7], ['V', 6, 0, 7], ['V', 7, 7, 8], ['V', 8, 1, 3],
  ['H', 0, 4, 6], ['H', 1, 2, 4], ['H', 1, 6, 8], ['H', 2, 0, 2], ['H', 3, 0, 5],
  ['H', 3, 6, 8], ['H', 4, 5, 6], ['H', 5, 4, 5], ['H', 6, 0, 1], ['H', 7, 5, 7],
  ['H', 8, 1, 7],
];

// The one curve in the flat: the north side of Peter's room. It is glazing, so
// the wall follows the arc and the window sits in it — there is no straight
// wall behind. Measured by scanning down each column of pixels for first ink.
const ARC = { ax: 9, ay: 32, bx: 446, by: 98, bulge: -37 };

// Solid black blocks: columns, drawn as four walls each — the owner's own way
// of showing them.
const COLUMNS = [[-1, 32, 39, 111], [777, 136, 85, 53], [794, 697, 69, 99], [215, 701, 65, 98]];

// Rooms, matched to the regions the walls enclose by where their centre lands.
const NAMES = [
  [435, 911, '客廳＋廚房', 'wood'],
  [255, 296, 'Peter 房間', 'wood'],
  [1033, 314, '老媽房間', 'wood'],
  [1051, 974, 'Bruce 房間', 'wood'],
  [677, 372, '老爸房間', 'wood'],
  [1298, 372, '衛浴 A', 'tile'],
  [701, 1127, '陽台', 'terrazzo'],
  [1084, 707, '衛浴 B', 'tile'],
];

// Joinery, positioned against the wall it stands on rather than at a coordinate
// copied out of one detection run — so correcting a wall takes it along.
// Sizes are the drawing's own: 240 wardrobes, 53 汙衣櫃, 369 吊頂, 307.2 廚具.
const JOINERY = [
  ['系統開放衣櫃 4抽', 240, 60, 'H', 4, 5, 4],
  ['系統開放衣櫃 4抽', 240, 60, 'H', 7, 5, 0],
  ['汙衣櫃', 53, 60, 'H', 7, 5, 244],
  ['木作強化吊頂＋鋁框拉門', 369, 60, 'H', 2, 0, 0],
  ['廚具（水槽＋爐）', 307, 60, 'H', 8, 1, 8],
  ['冰箱 R.E.F.', 60, 89, 'V', 1, 6, 255],
];

const regions = JSON.parse(readFileSync(`${SCRATCH}/final.json`, 'utf8')).regions;

let n = 0;
const id = (k) => `${k}_${++n}`;
const objects = [];
const wall = (ax, ay, bx, by, extra = {}) => objects.push({
  id: id('wall'), kind: 'wall', layer: 'walls',
  a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 15, finish: 'paint', ...extra,
});

// ---- walls ---------------------------------------------------------------
for (const [o, i, a, b] of WALLS) {
  if (o === 'V') wall(X[i], Y[a], X[i], Y[b]);
  else wall(X[a], Y[i], X[b], Y[i]);
}
wall(X[3], Y_BAL, X[4], Y_BAL);
wall(ARC.ax, ARC.ay, ARC.bx, ARC.by, { bulge: ARC.bulge });
// The arc's ends have to reach the walls either side or the room is open.
wall(ARC.ax, ARC.ay, X[0], Y[1]);
wall(ARC.bx, ARC.by, X[2], Y[1]);

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

// ---- window in the arc ----------------------------------------------------
objects.push({
  id: id('window'), kind: 'window', layer: 'openings',
  x: (ARC.ax + ARC.bx) / 2, y: (ARC.ay + ARC.by) / 2,
  width: Math.hypot(ARC.bx - ARC.ax, ARC.by - ARC.ay) - 40,
  angle: Math.atan2(ARC.by - ARC.ay, ARC.bx - ARC.ax) * 180 / Math.PI,
  bulge: ARC.bulge,
});

// ---- joinery, against its wall -------------------------------------------
for (const [label, w, d, wo, wi, ai, off] of JOINERY) {
  const on = wo === 'H'
    ? { x: X[ai] + off, y: Y[wi], w, h: d }
    : { x: X[wi], y: Y[ai] + off, w: d, h: w };
  objects.push({
    id: id('furniture'), kind: 'furniture', layer: 'furniture', item: 'cabinet',
    label, angle: 0, ...on,
  });
}

const plan = {
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
for (const o of objects.filter((z) => z.kind === 'room')) {
  console.log(`  ${o.name.padEnd(12)} ${(o.w * o.h / 10000).toFixed(1)} m²`);
}

if (process.argv.includes('--save')) {
  const force = process.argv.includes('--force');
  const mine = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : null;
  const cur = await fetch(`http://127.0.0.1:8791/api/projects/${PID}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (cur?.updatedAtIso && mine && cur.updatedAtIso !== mine && !force) {
    console.error(`\n✖ 沒有寫入：${PID} 在這支腳本上次寫入之後又被改過（可能是手動改的）。要覆蓋加 --force。`);
    process.exit(1);
  }
  const r = await fetch(`http://127.0.0.1:8791/api/projects/${PID}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: plan.name, data: plan }),
  });
  const body = await r.json().catch(() => ({}));
  if (body.updatedAtIso) writeFileSync(STAMP, body.updatedAtIso);
  console.log(`PUT /api/projects/${PID} →`, r.status, force ? '(--force)' : '');
}
if (process.argv.includes('--out')) {
  writeFileSync(process.argv[process.argv.indexOf('--out') + 1], JSON.stringify(plan));
}
