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

const REGIONS = '/private/tmp/claude-501/-Users-bruuucemac/609650e9-c1d4-4d0d-9616-85360c42d5f7/scratchpad/regions.json';
const UNDERLAY = '/private/tmp/claude-501/-Users-bruuucemac/609650e9-c1d4-4d0d-9616-85360c42d5f7/scratchpad/ul0197.jpg';
const CEIL = 300;

// Names in the order the regions come out (largest first). The drawing labels
// only 廚房; the rest are placed by position and are the one thing here that is
// not measured — they are the bit to correct.
const NAMES = [
  ['廚房', 'tile'],           // 28.6 — labelled on the drawing, open plan
  ['房間 A', 'wood'],         // 16.5 — 右上，北面整排窗
  ['房間 B', 'wood'],         // 15.9 — 左上，弧牆
  ['房間 C', 'wood'],         // 13.8 — 中間
  ['房間 D', 'wood'],         // 12.7 — 右下（含原陽台）
  ['衛浴 A', 'tile'],         // 6.3  — 最右，窄
  ['陽台', 'terrazzo'],       // 4.3  — 廚房旁
  ['衛浴 B', 'tile'],         // 3.4  — 中間偏右的小間
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
for (const { a, b } of seen.values()) {
  objects.push({
    id: id('wall'), kind: 'wall', layer: 'walls',
    a: { ...a }, b: { ...b }, thickness: 15, finish: 'paint',
  });
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

console.log(`天花板 ${CEIL} cm，${regions.length} 個空間，${seen.size} 道牆`);
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
