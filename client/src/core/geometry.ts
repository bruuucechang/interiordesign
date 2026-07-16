import { Vec } from '../model/types';

export const v = (x: number, y: number): Vec => ({ x, y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const angleDeg = (a: Vec, b: Vec): number => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;

export function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}
export function snapPoint(p: Vec, grid: number): Vec {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

// rotate point p around center c by angle (degrees)
export function rotate(p: Vec, c: Vec, deg: number): Vec {
  const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function pointInRect(p: Vec, x: number, y: number, w: number, h: number): boolean {
  return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
}

// ---- polygons ----
// signed area (shoelace) on raw coords; sign encodes winding
export function polygonSignedArea(pts: Vec[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
export function polygonArea(pts: Vec[]): number { return Math.abs(polygonSignedArea(pts)); }

export function polygonCentroid(pts: Vec[]): Vec {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a += cross; cx += (p.x + q.x) * cross; cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-6) {                                    // degenerate: fall back to vertex average
    const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / pts.length, y: s.y / pts.length };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// format an area (cm²) as m²
export function fmtArea(cm2: number): string { return (cm2 / 10000).toFixed(2) + ' m²'; }

// is point p within `tol` of segment a-b? returns distance
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * abx, y: a.y + t * aby });
}

// nearest point on segment a-b to p
export function closestOnSegment(p: Vec, a: Vec, b: Vec): { point: Vec; t: number } {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return { point: { x: a.x + t * abx, y: a.y + t * aby }, t };
}

// format cm as human string (meters when large)
export function fmtLen(cm: number): string {
  const a = Math.abs(cm);
  if (a >= 100) return (cm / 100).toFixed(2) + ' m';
  return Math.round(cm) + ' cm';
}

// ---- curved walls (quadratic-bezier arc; `bulge` = signed apex offset in cm) ----
function perpUnit(a: Vec, b: Vec): Vec {           // unit normal, left of a->b
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  return { x: -dy / L, y: dx / L };
}
// where the curvature handle sits (chord midpoint pushed out by `bulge`)
export function wallApex(a: Vec, b: Vec, bulge: number): Vec {
  const n = perpUnit(a, b);
  return { x: (a.x + b.x) / 2 + n.x * bulge, y: (a.y + b.y) / 2 + n.y * bulge };
}
// quadratic control so the curve's midpoint lands exactly on the apex
export function wallControl(a: Vec, b: Vec, bulge: number): Vec {
  const n = perpUnit(a, b);
  return { x: (a.x + b.x) / 2 + n.x * 2 * bulge, y: (a.y + b.y) / 2 + n.y * 2 * bulge };
}
export function quadAt(a: Vec, c: Vec, b: Vec, t: number): Vec {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}
export function quadPoints(a: Vec, c: Vec, b: Vec, n = 20): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) pts.push(quadAt(a, c, b, i / n));
  return pts;
}
export function distToQuad(p: Vec, a: Vec, c: Vec, b: Vec, n = 24): number {
  let best = Infinity, prev = a;
  for (let i = 1; i <= n; i++) { const cur = quadAt(a, c, b, i / n); best = Math.min(best, distToSegment(p, prev, cur)); prev = cur; }
  return best;
}
// signed bulge implied by dragging the handle to point p
export function bulgeFrom(a: Vec, b: Vec, p: Vec): number {
  const n = perpUnit(a, b), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (p.x - mid.x) * n.x + (p.y - mid.y) * n.y;
}

// Fit an opening of `width` onto a curved wall (quadratic bezier a-c-b): returns
// the chord midpoint, chord angle, signed sagitta (so the opening arcs like the
// wall), chord width, and the cursor's distance to the arc (for nearest-wall pick).
export function arcOpening(a: Vec, c: Vec, b: Vec, cursor: Vec, width: number):
  { pos: Vec; angle: number; bulge: number; width: number; dist: number } {
  const N = 48;
  const pts: Vec[] = [];
  for (let i = 0; i <= N; i++) pts.push(quadAt(a, c, b, i / N));
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) { const d = dist(cursor, pts[i]); if (d < bd) { bd = d; bi = i; } }
  const half = width / 2;
  const walk = (dir: number): Vec => {   // step `half` cm along the arc from the nearest point
    let acc = 0, i = bi;
    for (;;) {
      const ni = i + dir;
      if (ni < 0 || ni >= pts.length) return pts[i];
      const seg = dist(pts[i], pts[ni]);
      if (acc + seg >= half) { const t = (half - acc) / seg; return { x: pts[i].x + (pts[ni].x - pts[i].x) * t, y: pts[i].y + (pts[ni].y - pts[i].y) * t }; }
      acc += seg; i = ni;
    }
  };
  const e0 = walk(-1), e1 = walk(1);
  return { pos: { x: (e0.x + e1.x) / 2, y: (e0.y + e1.y) / 2 }, angle: angleDeg(e0, e1), bulge: bulgeFrom(e0, e1, pts[bi]), width: dist(e0, e1), dist: bd };
}

// Foolproof wall joining: snap a point to a nearby wall endpoint (preferred) or
// onto a wall segment (T-junction). `radius` is in world cm; pass excludeId to
// ignore the wall being edited. Returns the snapped point + which kind, or null.
export function nearestWallSnap(
  walls: { id: string; a: Vec; b: Vec }[], p: Vec, radius: number, excludeId?: string,
): { point: Vec; kind: 'end' | 'seg' } | null {
  let best: Vec | null = null, bestD = radius;
  for (const w of walls) {                       // endpoints win — they make clean corners
    if (w.id === excludeId) continue;
    for (const e of [w.a, w.b]) { const d = dist(p, e); if (d < bestD) { bestD = d; best = e; } }
  }
  if (best) return { point: { x: best.x, y: best.y }, kind: 'end' };
  for (const w of walls) {                        // otherwise snap onto the wall line
    if (w.id === excludeId) continue;
    const { point } = closestOnSegment(p, w.a, w.b);
    const d = dist(p, point); if (d < bestD) { bestD = d; best = point; }
  }
  return best ? { point: best, kind: 'seg' } : null;
}

// Snap a wall's end so the segment locks to 0/45/90° for easy grid alignment.
// `t` is the already grid-snapped cursor; `hard` forces the snap (Shift).
export function alignWallEnd(s: Vec, t: Vec, grid: number, hard: boolean): Vec {
  const dx = t.x - s.x, dy = t.y - s.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return t;
  const ang = Math.atan2(dy, dx), step = Math.PI / 4;
  const k = Math.round(ang / step);
  let diff = ang - k * step; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  if (!hard && Math.abs(diff) > 8 * Math.PI / 180) return t;   // >8° off an axis: leave free
  const m = ((k % 8) + 8) % 8;
  if (m === 0 || m === 4) return { x: t.x, y: s.y };           // horizontal
  if (m === 2 || m === 6) return { x: s.x, y: t.y };           // vertical
  let leg = Math.max(grid, Math.round((Math.abs(dx) + Math.abs(dy)) / 2 / grid) * grid);   // 45° diagonal on grid
  const sx = m === 1 || m === 7 ? 1 : -1, sy = m === 1 || m === 3 ? 1 : -1;
  return { x: s.x + sx * leg, y: s.y + sy * leg };
}
