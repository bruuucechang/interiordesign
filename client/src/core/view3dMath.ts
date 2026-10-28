// The parts of the 3D view that are arithmetic, not WebGL: where the sun goes,
// how a wall turns into boxes, which walls the doll's-house view cuts away, how
// a light fitting is scaled. Every one of them fails silently — a wrong sign
// draws a perfectly valid scene that is simply not the plan — so they live here,
// free of three.js, where a test can pin them. view3d.ts applies the answers.
import type { Obj, Vec } from '../model/schema';
import { dist, angleDeg, wallEndKey, wallEndCounts } from './geometry';
import { wallPieces, Wall, Opening } from './wallGeometry';
import type { LightPart } from './lights3d';

// Time-of-day lighting presets: sun colour/intensity/angle, sky fills, exposure.
export type TimeKey = 'morning' | 'noon' | 'dusk' | 'night';
export const LIGHTING: Record<TimeKey, { sun: number; intensity: number; hemi: number; amb: number; env: number; bg: number; exposure: number; elev: number; azim: number }> = {
  morning: { sun: 0xffe6c2, intensity: 2.0, hemi: 0.55, amb: 0.16, env: 0.50, bg: 0xdfe8f0, exposure: 1.00, elev: 20, azim: 100 },
  noon:    { sun: 0xfff4e2, intensity: 2.0, hemi: 0.48, amb: 0.12, env: 0.40, bg: 0xdbe2ea, exposure: 0.85, elev: 68, azim: 40 },
  dusk:    { sun: 0xff9e5e, intensity: 1.9, hemi: 0.40, amb: 0.14, env: 0.38, bg: 0xe9c9a8, exposure: 1.05, elev: 12, azim: -60 },
  night:   { sun: 0x9fb6ff, intensity: 0.5, hemi: 0.12, amb: 0.10, env: 0.10, bg: 0x161c28, exposure: 1.15, elev: 42, azim: 20 },
};

type V3 = [number, number, number];

/** The sun for a time of day, aimed at the plan's centre from `span` × 1.6 away. */
export function sunPose(time: TimeKey, center: { x: number; z: number }, span: number): { position: V3; target: V3 } {
  const P = LIGHTING[time];
  const el = P.elev * Math.PI / 180, az = P.azim * Math.PI / 180, d = span * 1.6;
  return {
    position: [center.x + Math.cos(el) * Math.cos(az) * d, Math.max(80, Math.sin(el) * d), center.z + Math.cos(el) * Math.sin(az) * d],
    target: [center.x, 0, center.z],
  };
}

// ---- walls ----

// Which wall ends meet another wall: geometry's wallEndCounts, the same count
// the 2D plan uses for its square caps. A wall is a box running from one
// centre-line endpoint to the other, so at a corner neither box covers the
// square where the two centre lines cross: two 15 cm walls meeting leave a
// 7.5 x 7.5 cm notch bitten out of the outside corner. Measured, not
// guessed — the boxes come out x ∈ [0,400] and z ∈ [0,400] and nothing
// covers x,z ∈ [-7.5,0].
//
// The 2D plan has never had this: it strokes walls with `lineCap:
// 'square'`, which is exactly the same half-thickness overhang.
export const wallJoins = (objects: Obj[]) => wallEndCounts(objects);

/** One box of a straight wall: its size, centre, and turn about the vertical. */
export interface WallBox { len: number; height: number; depth: number; position: V3; rotationY: number }

/** A straight wall as boxes, with real holes where its doors/windows sit. */
export function straightWallBoxes(
  o: Wall, openings: Opening[], wh: number, yBase: number, joins?: Map<string, number>,
): WallBox[] {
  const a = o.a, b = o.b, L = dist(a, b);
  if (L < 1) return [];
  const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, ang = -angleDeg(a, b) * Math.PI / 180;
  // Run half a thickness past each end that meets another wall, so the corner
  // square gets filled. Only at joined ends: doing it everywhere would leave a
  // free-standing wall poking 7.5 cm out of its own drawn length. The two
  // walls overlap inside the corner — they are the same material, and an
  // overlap is invisible where a hole is not.
  const half = o.thickness / 2;
  const extA = (joins?.get(wallEndKey(a)) ?? 0) > 1 ? half : 0;
  const extB = (joins?.get(wallEndKey(b)) ?? 0) > 1 ? half : 0;
  return wallPieces(o, openings, wh).map((piece) => {
    const p = {
      ...piece,
      s0: piece.s0 <= 0.01 ? piece.s0 - extA : piece.s0,
      s1: piece.s1 >= L - 0.01 ? piece.s1 + extB : piece.s1,
    };
    const mid = (p.s0 + p.s1) / 2;
    return {
      len: p.s1 - p.s0, height: p.yHi - p.yLo, depth: o.thickness,
      position: [a.x + dir.x * mid, yBase + (p.yLo + p.yHi) / 2, a.y + dir.y * mid],
      rotationY: ang,
    };
  });
}

// One continuous band swept along a plan polyline, from yLo..yHi with thickness
// T. The two side faces share vertices along the sweep, so computeVertexNormals
// shades the curve smoothly (no per-segment facets/seams); the top and end caps
// get their own vertices so those edges stay crisp. Returns the vertex positions
// and triangle indices, or null when there is nothing to draw.
export function sweptBand(pts: Vec[], yLo: number, yHi: number, T: number, yBase: number): { pos: number[]; idx: number[] } | null {
  const n = pts.length;
  if (n < 2 || yHi - yLo < 0.5) return null;
  const ht = T / 2, yb = yBase + yLo, yt = yBase + yHi;
  const nrm = pts.map((_, i) => {
    const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
    const tx = q.x - p.x, tz = q.y - p.y, L = Math.hypot(tx, tz) || 1;
    return { x: -tz / L, y: tx / L };   // unit perpendicular to the tangent (in plan)
  });
  const outer = pts.map((p, i) => ({ x: p.x + nrm[i].x * ht, z: p.y + nrm[i].y * ht }));
  const inner = pts.map((p, i) => ({ x: p.x - nrm[i].x * ht, z: p.y - nrm[i].y * ht }));
  const pos: number[] = [], idx: number[] = [];
  const V = (x: number, y: number, z: number) => (pos.push(x, y, z), pos.length / 3 - 1);
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  const oB: number[] = [], oT: number[] = [], iB: number[] = [], iT: number[] = [];
  for (let i = 0; i < n; i++) { oB.push(V(outer[i].x, yb, outer[i].z)); oT.push(V(outer[i].x, yt, outer[i].z)); }
  for (let i = 0; i < n; i++) { iB.push(V(inner[i].x, yb, inner[i].z)); iT.push(V(inner[i].x, yt, inner[i].z)); }
  for (let i = 0; i < n - 1; i++) { quad(oB[i], oB[i + 1], oT[i + 1], oT[i]); quad(iB[i + 1], iB[i], iT[i], iT[i + 1]); }  // outer + inner side faces
  const tO: number[] = [], tI: number[] = [];
  for (let i = 0; i < n; i++) { tO.push(V(outer[i].x, yt, outer[i].z)); tI.push(V(inner[i].x, yt, inner[i].z)); }
  for (let i = 0; i < n - 1; i++) quad(tO[i], tI[i], tI[i + 1], tO[i + 1]);                                              // crisp top face
  const cap = (i: number) => { const a = V(outer[i].x, yb, outer[i].z), b = V(outer[i].x, yt, outer[i].z), c = V(inner[i].x, yt, inner[i].z), d = V(inner[i].x, yb, inner[i].z); quad(a, b, c, d); };
  cap(0); cap(n - 1);
  return { pos, idx };
}

// ---- the doll's-house cut ----

/**
 * How far onto the camera's side a run of wall has to be before it is cut away,
 * as a fraction of the plan's half size on that axis.
 *
 * 0 cuts everything past the middle, including partitions that were not in the
 * way. Near 1 only the outermost wall goes and the second row of rooms stays
 * shut. 0.3 opens the front rooms and keeps the back of the building standing.
 */
export const NEAR_WALL_CUT = 0.3;

/**
 * How close to the plan's edge a run of wall has to be to count as an outside
 * wall. Anything nearer the middle than this is a partition and is never cut.
 */
export const EDGE_BAND = 0.7;

/** Where a wall-like object stands and which axis it blocks; null for everything else. */
export interface Occluder { at: { x: number; z: number }; blocks: 'x' | 'z' }

export function occluder(o: Obj): Occluder | null {
  if (o.kind !== 'wall' && o.kind !== 'beam' && o.kind !== 'door' && o.kind !== 'window') return null;
  // Which way the run of wall faces decides which direction it blocks:
  // one running east–west stands between the camera and the rooms when
  // the camera is north or south of it, and never when it is east.
  const c = 'a' in o
    ? { x: (o.a.x + o.b.x) / 2, z: (o.a.y + o.b.y) / 2 }
    : { x: o.x, z: o.y };
  const alongX = 'a' in o
    ? Math.abs(o.b.x - o.a.x) >= Math.abs(o.b.y - o.a.y)
    : Math.abs(Math.cos(o.angle * Math.PI / 180)) >= Math.abs(Math.sin(o.angle * Math.PI / 180));
  return { at: c, blocks: alongX ? 'z' : 'x' };
}

/** The plan's centre and half sizes, and which side of it the camera is on. */
export interface CullFrame { cx: number; cz: number; halfX: number; halfZ: number; sx: number; sz: number }

/**
 * Per axis, not projected onto one camera direction: a single cutting plane
 * works when the camera faces a side square-on and fails on the diagonal —
 * it opens the corner nearest the camera and leaves the other two rooms
 * shut. Each run of wall is tested against the axis it actually blocks.
 *
 * Which side the camera is on, with a dead zone around the centre line.
 *
 * Taking the sign directly means that as the camera swings through the
 * middle of the plan, a hair of movement flips it and a whole side of the
 * building appears or vanishes between one frame and the next. Near the
 * centre line the camera is edge-on to those walls anyway — they are not
 * blocking anything — so the last decision (`prev`) is kept until it is clearly past.
 */
export function cullFrame(
  box: { min: { x: number; z: number }; max: { x: number; z: number } },
  cam: { x: number; z: number }, prev: { sx: number; sz: number },
): CullFrame {
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const halfX = (box.max.x - box.min.x) / 2 || 1;
  const halfZ = (box.max.z - box.min.z) / 2 || 1;
  const sx = Math.abs(cam.x - cx) > halfX * 0.15 ? Math.sign(cam.x - cx) || 1 : prev.sx;
  const sz = Math.abs(cam.z - cz) > halfZ * 0.15 ? Math.sign(cam.z - cz) || 1 : prev.sz;
  return { cx, cz, halfX, halfZ, sx, sz };
}

/** True when this run of wall is the outside wall facing the camera, i.e. it comes off. */
export function cutsAway(w: Occluder, f: CullFrame): boolean {
  const { at } = w;
  // Only the outside wall facing the camera comes off. Cutting interior
  // partitions too is what a doll's house does *not* do, and it is what was
  // reported as 「牆壁有時會消失」: a wall in the middle of the plan has no
  // reason to vanish, so when it does it reads as the model breaking rather
  // than as a view being helpful.
  const onEdge = w.blocks === 'z'
    ? Math.abs(at.z - f.cz) > f.halfZ * EDGE_BAND
    : Math.abs(at.x - f.cx) > f.halfX * EDGE_BAND;
  return onEdge && (w.blocks === 'z'
    ? (at.z - f.cz) * f.sz > f.halfZ * NEAR_WALL_CUT
    : (at.x - f.cx) * f.sx > f.halfX * NEAR_WALL_CUT);
}

// ---- framing ----

/** The plan points an object occupies, for the scene's bounding box. */
export function objectExtent(o: Obj): Vec[] {
  if (o.kind === 'wall' || o.kind === 'beam' || o.kind === 'partition' || o.kind === 'dimension') return [o.a, o.b];
  if (o.kind === 'room' && o.poly?.length) return o.poly;
  if (o.kind === 'room' || o.kind === 'furniture') return [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y + o.h }];
  return [{ x: o.x, y: o.y }];
}

/** Centre, size and the reframed camera for a plan's bounds (Infinity when empty). */
export function sceneFrame(b: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  let { minX, maxX, minZ, maxZ } = b;
  if (!isFinite(minX)) { minX = -200; maxX = 200; minZ = -200; maxZ = 200; }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ, 300) + 200;
  return {
    cx, cz, span,
    target: [cx, 40, cz] as V3,
    eye: [cx + span * 0.7, span * 0.8, cz + span * 0.9] as V3,
  };
}

// ---- input ----

/** WASD + Shift/Space as fly axes: forward, strafe right, rise. */
export function flyAxes(P: Set<string>) {
  let fwd = 0, strafe = 0, vert = 0;
  if (P.has('w')) fwd += 1;
  if (P.has('s')) fwd -= 1;
  if (P.has('d')) strafe += 1;
  if (P.has('a')) strafe -= 1;
  if (P.has('up')) vert += 1;     // Shift → rise
  if (P.has('down')) vert -= 1;   // Space → descend
  return { fwd, strafe, vert };
}

/** Arrow keys as screen axes: right, up. */
export function panAxes(P: Set<string>) {
  let x = 0, y = 0;
  if (P.has('panRight')) x += 1;
  if (P.has('panLeft')) x -= 1;
  if (P.has('panUp')) y += 1;
  if (P.has('panDown')) y -= 1;
  return { x, y };
}

// ---- light fittings ----

/** How one LightPart becomes a scaled unit mesh: which unit, scale, position, turn. */
export interface LightMeshSpec { unit: 'box' | 'cyl'; glow: boolean; scale: V3; position: V3; rotationY: number }

/**
 * Plan (x, y) is world (X, Z) and the part's z is height above the floor. A box
 * turns with the fitting: a plan angle turns +x towards +y, which is world +X
 * towards +Z, while a positive three.js turn about +Y takes +X towards −Z —
 * hence the minus, the same one walls and furniture use. A cylinder is round
 * and does not turn.
 */
export function lightMeshSpec(p: LightPart, yBase: number): LightMeshSpec {
  const position: V3 = [p.x, yBase + p.z, p.y];
  return p.shape === 'box'
    ? { unit: 'box', glow: p.glow, scale: [p.w, p.h, p.d], position, rotationY: -p.angle * Math.PI / 180 }
    : { unit: 'cyl', glow: p.glow, scale: [p.r, p.h, p.r], position, rotationY: 0 };
}
