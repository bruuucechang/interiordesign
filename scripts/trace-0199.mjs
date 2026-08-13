// Builds the flat from IMG_0197/0199 — the finished design.
//
//   node scripts/trace-0199.mjs --save
//
// IMG_9720 is the developer's original; IMG_0199 is what was built. Earlier
// passes traced the shell by eye and got the room count wrong twice — first
// twelve (the original's rooms, carried over wholesale), then seven. Guessing
// at where a wall runs from a picture of a wall is what kept failing.
//
// So this does not guess. The rooms are the drawing's own enclosed regions,
// found by flood-filling the CAD linework and taking each connected component
// of free space: eight of them, with their real outlines. Walls are then the
// edges of those regions, de-duplicated where two rooms share one. The only
// human input left is what each room is called.
//
// Scale 1.0710 px/cm, checked three ways against the drawing's own dimensions
// (95/60/60/20/60 ↔ 102/64/86/64 px, 307.2 ↔ 329 px, 478.5 ↔ 512 px).

import { readFileSync } from 'node:fs';

const REGIONS = '/private/tmp/claude-501/-Users-bruuucemac/609650e9-c1d4-4d0d-9616-85360c42d5f7/scratchpad/regions-flat.json';
const UNDERLAY = '/private/tmp/claude-501/-Users-bruuucemac/609650e9-c1d4-4d0d-9616-85360c42d5f7/scratchpad/ul0197.jpg';
const CEIL = 300;

// Names in the order the regions come out (largest first). The drawing labels
// only 廚房; the rest are placed by position and are the one thing here that is
// not measured — they are the bit to correct.
// From the owner.
const NAMES = [
  ['客廳＋廚房', 'wood'],     // 28.6 — one open space, the drawing labels it 廚房
  ['老媽房間', 'wood'],       // 16.5
  ['Peter 房間', 'wood'],     // 15.9 — the arc on its north side is a window
  ['老爸房間', 'wood'],       // 13.8
  ['Bruce 房間', 'wood'],     // 12.7
  ['衛浴 A', 'tile'],         // 6.3
  ['陽台', 'terrazzo'],       // 4.3
  ['衛浴 B', 'tile'],         // 3.3
];

const SNAP = 5;                                  // cm — kills contour jitter
const snap = (v) => Math.round(v / SNAP) * SNAP;

const regions = JSON.parse(readFileSync(REGIONS, 'utf8'));

let n = 0;
const id = (k) => `${k}_${++n}`;
const objects = [];

// ---- rooms ---------------------------------------------------------------
const polys = regions.map((r) => {
  const pts = r.poly.map(([x, y]) => ({ x: snap(x), y: snap(y) }));
  // Drop points that repeat after snapping, and the near-collinear jitter the
  // contour tracer leaves on a scanned line.
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1 || Math.abs(last.y - p.y) > 1) out.push(p);
  }
  return out;
});

regions.forEach((r, i) => {
  const poly = polys[i];
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const [name, floor] = NAMES[i] ?? [`房間 ${i + 1}`, 'wood'];
  objects.push({
    id: id('room'), kind: 'room', layer: 'rooms', name, floor, poly,
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
  });
});

// ---- walls ---------------------------------------------------------------
//
// Every region edge becomes a wall. Two rooms that share a wall each contribute
// the same edge, so the key is orientation-independent — otherwise the party
// walls come out doubled, which is invisible on the plan and doubles them in
// the 3D model and in any take-off.
const seen = new Map();
for (const poly of polys) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 20) continue;      // ignore stubs
    const key = [a.x, a.y, b.x, b.y].join(',') < [b.x, b.y, a.x, a.y].join(',')
      ? `${a.x},${a.y},${b.x},${b.y}` : `${b.x},${b.y},${a.x},${a.y}`;
    if (!seen.has(key)) seen.set(key, { a, b });
  }
}
// Two lines 15 cm apart are the two *faces* of one wall, not two walls.
//
// The rooms are traced from the free space inside them, so a shared wall shows
// up once per room — at its own face. Emitting both leaves a pair of walls with
// a gap between them: one 15 cm wall modelled as 45 cm of building. The owner
// spotted it. Anything parallel, overlapping and within 40 cm is the same wall
// seen from both sides, and collapses to one on the centreline.
let segs = [...seen.values()];
const vert = (s) => s.a.x === s.b.x;
const span = (s) => (vert(s) ? [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)]
                             : [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]);
let merged = true;
while (merged) {
  merged = false;
  outer: for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], u = segs[j];
      if (vert(s) !== vert(u)) continue;
      const off = vert(s) ? Math.abs(s.a.x - u.a.x) : Math.abs(s.a.y - u.a.y);
      if (off < 1 || off > 40) continue;
      const [s0, s1] = span(s), [u0, u1] = span(u);
      if (Math.min(s1, u1) - Math.max(s0, u0) < 50) continue;      // barely overlap
      const mid = vert(s) ? (s.a.x + u.a.x) / 2 : (s.a.y + u.a.y) / 2;
      const lo = Math.min(s0, u0), hi = Math.max(s1, u1);
      const one = vert(s)
        ? { a: { x: mid, y: lo }, b: { x: mid, y: hi } }
        : { a: { x: lo, y: mid }, b: { x: hi, y: mid } };
      segs = segs.filter((_, k) => k !== i && k !== j).concat([one]);
      merged = true;
      break outer;
    }
  }
}
for (const { a, b } of segs) {
  objects.push({
    id: id('wall'), kind: 'wall', layer: 'walls',
    a: { ...a }, b: { ...b }, thickness: 15, finish: 'paint',
  });
}

// ---- the joinery ---------------------------------------------------------
//
// Cabinets, not walls. Telling them apart is the whole reason this pass exists:
// in this drawing a wall is a pair of lines 15–17 px apart (its two faces at
// 15 cm) and a cabinet is a pair 50–65 cm apart (its depth), drawn thin and
// dashed. Flood-filling the raw linework treats both as boundaries, so every
// wardrobe bit a notch out of its room — which is what the owner spotted: the
// 35/60/35/20 in Bruce's room and the 240s in the other two are wardrobe
// widths, and the rooms are square behind them.
//
// So the room outlines are flattened over any indentation shallower than 75 cm,
// and the cabinets go back in as furniture at the sizes the drawing states.
const CAB = [
  [959, 491, 240, 60, '系統開放衣櫃 4抽'],     // 老媽房間
  [949, 799, 240, 60, '系統開放衣櫃 4抽'],     // Bruce 房間
  [1189, 799, 53, 60, '汙衣櫃'],
  [16, 484, 369, 60, '木作強化吊頂＋鋁框拉門'], // Peter 房間
  [143, 549, 240, 60, '系統開放衣櫃 4抽'],
  [234, 1155, 307, 60, '廚具（水槽＋爐）'],     // 廚房，307.2
  [240, 1000, 60, 89, '冰箱 R.E.F.'],
];
for (const [x, y, w, h, label] of CAB) {
  objects.push({
    id: id('furniture'), kind: 'furniture', layer: 'furniture',
    item: 'cabinet', label, x, y, w, h, angle: 0,
  });
}

// ---- the curved window, and no wall behind it ----------------------------
//
// The arc across the north of Peter's room is glazing. Measured off the drawing
// by scanning down each column of pixels for the first ink: it runs from
// (9, 32) to (446, 98) and stands 37 cm off its own chord. The previous guess
// used the room's bounding box and was in the wrong place with the wrong
// curvature.
//
// And there is no wall behind it — the arc *is* the boundary. A straight wall
// along the room's north edge would be a second, invisible skin behind the
// window, which is what was there.
const ARC = { ax: 9, ay: 32, bx: 446, by: 98, bulge: -37 };
{
  const dx = ARC.bx - ARC.ax, dy = ARC.by - ARC.ay;
  objects.push({
    id: id('window'), kind: 'window', layer: 'openings',
    x: (ARC.ax + ARC.bx) / 2, y: (ARC.ay + ARC.by) / 2,
    width: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI,
    bulge: ARC.bulge,
  });
  // The straight wall the tracer put along the room's north edge is the skin
  // behind the glazing. It has to go — but a window in this model is cut into a
  // wall, so it cannot simply be deleted: the wall itself follows the arc, and
  // the window sits in it. Straight everywhere else, curved only here, which is
  // what the drawing shows.
  const peter = objects.find((o) => o.kind === 'room' && o.name.includes('Peter'));
  const northY = Math.min(...peter.poly.map((q) => q.y));
  const xs = peter.poly.filter((q) => q.y === northY).map((q) => q.x);
  const lo = Math.min(...xs) - 5, hi = Math.max(...xs) + 5;
  let dropped = 0;
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.kind !== 'wall' || o.a.y !== o.b.y || Math.abs(o.a.y - northY) > 8) continue;
    if (Math.min(o.a.x, o.b.x) >= lo && Math.max(o.a.x, o.b.x) <= hi) { objects.splice(i, 1); dropped++; }
  }
  objects.push({
    id: id('wall'), kind: 'wall', layer: 'walls',
    a: { x: ARC.ax, y: ARC.ay }, b: { x: ARC.bx, y: ARC.by },
    thickness: 15, bulge: ARC.bulge, finish: 'paint',
  });
  console.log(`  弧形窗：換掉 ${dropped} 道直牆，改成沿弧的牆`);
}

// ---- the columns ---------------------------------------------------------
//
// The solid black squares. Found by eroding the darkest ink — that removes
// every line and leaves only what is filled in — and then requiring the block
// to be at least 55 % solid, so hatching does not qualify. Four of them.
//
// Drawn as four walls around the perimeter, which is how the owner draws a
// column. A single thick short wall was the earlier attempt and it read as one
// stubby wall rather than as structure.
const COLS = [
  [-1, 32, 39, 111], [777, 136, 85, 53], [794, 697, 69, 99], [215, 701, 65, 98],
];
for (const [x, y, w, h] of COLS) {
  const c = [
    [x, y, x + w, y], [x + w, y, x + w, y + h],
    [x + w, y + h, x, y + h], [x, y + h, x, y],
  ];
  for (const [ax, ay, bx, by] of c) {
    objects.push({
      id: id('wall'), kind: 'wall', layer: 'walls',
      a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 15, finish: 'paint',
    });
  }
}

// ---- doors and openings --------------------------------------------------
//
// Found the same way as everything else here: by measuring, not by placing them
// where a room's middle happens to be. Each wall is walked along its own line in
// the original image and the stretches with no ink are its openings. Anything up
// to 130 cm is a door; wider is an opening or a window run.
//
// This is why an earlier pass had the master bedroom's door opening into a
// bathroom — it was positioned from the room's centre rather than from where
// the drawing actually breaks the wall.
const OPENINGS = [
  [35, 266, 248, 90, 'window'],
  [1019, 480, 100, 0, 'door'],
  [1152, 480, 102, 0, 'door'],
  [400, 481, 66, 90, 'door'],
  [116, 720, 198, 0, 'window'],
  [1001, 910, 92, 0, 'door'],
  [1175, 910, 79, 0, 'door'],
  [1215, 1062, 304, 90, 'window'],
  [442, 1140, 198, 0, 'window'],
];
for (const [x, y, width, angle, kind] of OPENINGS) {
  objects.push({ id: id(kind), kind, layer: 'openings', x, y, width, angle });
}

// ---- the drawing, at the scale the rooms were measured with --------------
objects.unshift({
  id: id('image'), kind: 'image', layer: 'underlay',
  src: `data:image/jpeg;base64,${readFileSync(UNDERLAY).toString('base64')}`,
  x: -195.1, y: -113.9, w: 1879.6, h: 1485.5, opacity: 0.35,
});

const plan = {
  schemaVersion: 1,
  name: 'A1 單元（IMG_0199 成品）',
  activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', elevation: 0, height: CEIL, objects }],
  layers: [
    { id: 'underlay', name: '底圖', visible: true, locked: false, color: '#8b93a3' },
    { id: 'walls', name: '牆體', visible: true, locked: false, color: '#c9cfdb' },
    { id: 'rooms', name: '房間', visible: true, locked: false, color: '#6d7890' },
    { id: 'openings', name: '門窗', visible: true, locked: false, color: '#7bc6ff' },
    { id: 'furniture', name: '家具', visible: true, locked: false, color: '#e0b45a' },
    { id: 'dims', name: '尺寸標註', visible: true, locked: false, color: '#8bffb0' },
  ],
};

console.log(`天花板 ${CEIL} cm，${regions.length} 個空間，${segs.length} 道牆（合併前 ${seen.size}）`);
for (const [i, r] of regions.entries()) {
  console.log(`  ${(NAMES[i]?.[0] ?? '?').padEnd(8)} ${r.m2.toFixed(1)} m²`);
}

if (process.argv.includes('--save')) {
  const r = await fetch('http://127.0.0.1:8791/api/projects/img0199', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: plan.name, data: plan }),
  });
  console.log('PUT /api/projects/img0199 →', r.status);
}
if (process.argv.includes('--out')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[process.argv.indexOf('--out') + 1], JSON.stringify(plan));
}
