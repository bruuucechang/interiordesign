// The owner's two rules about walls, as a check that runs.
//
//   node scripts/trace-0199.mjs --out /tmp/p.json && node scripts/check-0199.mjs /tmp/p.json
//
//   1. 牆壁不會無緣無故的伸一根出來 — every wall endpoint touches another wall.
//   2. 牆壁會形成房間               — the walls close exactly ROOMS regions.
//
// Both found real errors the first time they ran, which is the only reason to
// keep them. Rule 1 caught the arc being joined on with two diagonal stubs (and
// this flat has no diagonal walls) and a balcony wall running 238 cm past the
// balcony. Rule 2 is what caught the room count being wrong twice before —
// counting by eye off a rendering does not work, and neither does trusting the
// room objects, because those are derived from the walls and so agree with them
// by construction. This rasterises the walls and floods the space between.

import { readFileSync } from 'node:fs';

const ROOMS = 8;
const TOL = 1.5;          // cm — endpoints closer than this count as touching
const MIN_AREA = 1.0;     // m² — below this is a construction pocket, not a room
const RES = 4;            // cm per cell

const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const walls = plan.floors[0].objects.filter((o) => o.kind === 'wall');

// ---- rule 1: no dangling endpoints ---------------------------------------
// A curved wall only offers its two ends, so `touches` treats a bulged wall as
// its endpoints rather than as a segment. That is deliberate: nothing in this
// flat is meant to land in the middle of the curve.
const touches = (p, w) => {
  const { a, b } = w;
  const near = (q) => Math.abs(p.x - q.x) < TOL && Math.abs(p.y - q.y) < TOL;
  if (w.bulge) return near(a) || near(b);
  if (Math.abs(a.x - b.x) < TOL) {
    return Math.abs(p.x - a.x) < TOL
      && p.y >= Math.min(a.y, b.y) - TOL && p.y <= Math.max(a.y, b.y) + TOL;
  }
  if (Math.abs(a.y - b.y) < TOL) {
    return Math.abs(p.y - a.y) < TOL
      && p.x >= Math.min(a.x, b.x) - TOL && p.x <= Math.max(a.x, b.x) + TOL;
  }
  return near(a) || near(b);
};

const dangling = [];
walls.forEach((w, i) => {
  for (const p of [w.a, w.b]) {
    if (!walls.some((o, j) => j !== i && touches(p, o))) dangling.push({ i, p, w });
  }
});

// ---- rule 2: the walls close exactly ROOMS regions ------------------------
const pts = walls.flatMap((w) => [w.a, w.b]);
const pad = 40;
const minX = Math.min(...pts.map((p) => p.x)) - pad;
const minY = Math.min(...pts.map((p) => p.y)) - pad;
const cw = Math.ceil((Math.max(...pts.map((p) => p.x)) + pad - minX) / RES);
const ch = Math.ceil((Math.max(...pts.map((p) => p.y)) + pad - minY) / RES);
const grid = new Uint8Array(cw * ch);
const cx = (x) => Math.round((x - minX) / RES);
const cy = (y) => Math.round((y - minY) / RES);

const stamp = (x, y, r) => {
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const px = x + i, py = y + j;
      if (px >= 0 && px < cw && py >= 0 && py < ch) grid[py * cw + px] = 1;
    }
  }
};
for (const w of walls) {
  const r = Math.max(1, Math.round(w.thickness / 2 / RES));
  const steps = Math.ceil(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) / RES) * 2 + 2;
  // A bulged wall is a quadratic through a control point offset along the
  // chord's normal by 2×bulge — the same convention the renderer uses.
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, L = Math.hypot(dx, dy) || 1;
  const kx = (w.a.x + w.b.x) / 2 + (-dy / L) * 2 * (w.bulge ?? 0);
  const ky = (w.a.y + w.b.y) / 2 + (dx / L) * 2 * (w.bulge ?? 0);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, u = 1 - t;
    stamp(cx(u * u * w.a.x + 2 * u * t * kx + t * t * w.b.x),
          cy(u * u * w.a.y + 2 * u * t * ky + t * t * w.b.y), r);
  }
}

const seen = new Uint8Array(cw * ch);
const regions = [];
for (let start = 0; start < grid.length; start++) {
  if (grid[start] || seen[start]) continue;
  const stack = [start];
  seen[start] = 1;
  let area = 0, sx = 0, sy = 0, open = false;
  while (stack.length) {
    const k = stack.pop();
    const x = k % cw, y = (k - x) / cw;
    area++; sx += x; sy += y;
    if (x === 0 || y === 0 || x === cw - 1 || y === ch - 1) open = true;
    for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + i, ny = y + j;
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const n = ny * cw + nx;
      if (grid[n] || seen[n]) continue;
      seen[n] = 1; stack.push(n);
    }
  }
  const m2 = area * RES * RES / 10000;
  if (!open && m2 >= MIN_AREA) {
    regions.push({ m2, x: Math.round(sx / area * RES + minX), y: Math.round(sy / area * RES + minY) });
  }
}
regions.sort((a, b) => b.m2 - a.m2);

// ---- report ---------------------------------------------------------------
const rooms = plan.floors[0].objects.filter((o) => o.kind === 'room');
const nameAt = (r) => rooms
  .map((o) => [Math.hypot(o.x + o.w / 2 - r.x, o.y + o.h / 2 - r.y), o.name])
  .sort((a, b) => a[0] - b[0])[0]?.[1] ?? '（無名）';

console.log(`規則一・牆不無故伸出：${walls.length} 道牆，懸空端點 ${dangling.length} 個`);
for (const d of dangling) {
  const { a, b } = d.w;
  console.log(`   #${d.i} (${d.p.x.toFixed(0)},${d.p.y.toFixed(0)})`
    + `  屬於 (${a.x.toFixed(0)},${a.y.toFixed(0)}) → (${b.x.toFixed(0)},${b.y.toFixed(0)})`);
}
console.log(`規則二・牆圍成房間：${regions.length} 個封閉區域（應為 ${ROOMS}）`);
for (const r of regions) {
  console.log(`   ${nameAt(r).padEnd(12)} ${r.m2.toFixed(1).padStart(6)} m²   中心(${r.x}, ${r.y})`);
}

const bad = dangling.length > 0 || regions.length !== ROOMS;
console.log(bad ? '\n不合格。' : '\n兩條規則都通過。');
process.exit(bad ? 1 : 0);
