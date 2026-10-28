// Illuminance on a horizontal work plane, room by room.
//
// The maths is the bedroom-lighting prototype's (docs/lighting-prototype.html,
// `sources`/`lux`/`grid`), kept line for line so its numbers are the acceptance
// check: direct light from every luminaire, plus one flat inter-reflected term
// for the whole room, all times a maintenance factor.
//
//   · downward lights (downlight, ceiling light, spotlight, pendant): a cosⁿ
//     source pointing at the floor, n from the beam angle (120° → n = 1, which
//     is Lambertian), normalised so the lower hemisphere carries the flux
//   · tubes (T5 batten, wall light): cut into SEG segments, each a half
//     cylinder against its wall that lights the side it faces and fades towards
//     the tube's ends; I₀ = 2Φ / π² / SEG
//   · inter-reflection: Φ·ρ / (total surface · (1 − ρ)), the same everywhere
//
// Walls cast shadows (B17, docs/spec-game-mode.md §2): when a room's LightRoom
// carries `shade`, a source's direct light reaches a point only if the line
// between them crosses no wall — or crosses it inside a door or window opening,
// below the head and above the sill. Lights in other rooms then count too,
// through the doorway; the reflected term stays the room's own lights.
//
// Not modelled, and the panel has to say so: daylight, dimming, furniture
// casting shadows. Full-height cabinets only remove grid points — nobody reads
// a book inside a wardrobe.
//
// Pure: no DOM, no canvas, no doc. Plans go in as objects, numbers come out.

import type { Electrical, Opening, Room, Vec, Wall } from '../model/schema';
import { quadPoints, wallControl } from './geometry';
import { openingSpan, openingsOnWall } from './wallGeometry';
import { ELECTRICAL_BY_ID, LIGHT_DEFAULTS, T5_SIZES, T5_DEFAULT_SIZE, T5_BELOW_CEILING } from '../model/catalogue';
import type { Box } from './clearance';

export const MAINTENANCE = 0.8;
export const SEG = 16;
/** Work-plane heights (cm): desk, bed, floor. */
export const PLANES = { desk: 75, bed: 55, floor: 0 } as const;
/** Mean reflectance: light, medium, dark finishes. */
export const REFLECTANCE = { light: 0.55, medium: 0.45, dark: 0.3 } as const;
/** A light with no switch group is on group 1. */
export const DEFAULT_CIRCUIT = 1;

/** A placed fitting resolved to the numbers the maths needs. */
export interface Luminaire {
  id: string;
  x: number; y: number; z: number;
  lumens: number; watts: number;
  circuit: number;
  /** n of cosⁿ for a downward light; absent for a tube. */
  exponent?: number;
  /** For a tube: its length, the unit vector along it, and the unit vector it lights. */
  tube?: { length: number; axis: [number, number]; face: [number, number] };
}

/** cosⁿ exponent whose intensity halves at half the beam angle. */
export const beamExponent = (beam: number) => {
  const half = Math.min(89, Math.max(0.5, beam / 2)) * Math.PI / 180;
  return Math.log(0.5) / Math.log(Math.cos(half));
};

/**
 * What a fitting does to a room with this ceiling height, or null if it gives
 * no light (a socket, a switch, an exhaust fan).
 *
 * Ceiling-mounted lights sit at the ceiling whatever their stored elevation —
 * that field was written from a catalogue that assumed one ceiling height. A
 * pendant hangs at its own elevation; a batten defaults to just under the
 * ceiling, a wall light to its catalogue height.
 */
export function luminaire(e: Electrical, ceiling: number): Luminaire | null {
  const base = { id: e.id, x: e.x, y: e.y, circuit: e.circuit ?? DEFAULT_CIRCUIT };
  const rad = e.angle * Math.PI / 180;
  // cos(90°) is 6e-17, not 0, and that is enough to light the points lying in a
  // tube's own wall plane (the `ca <= 0` cut-off in `lux`) — the grid samples
  // exactly that line whenever the tube sits on a wall or a cabinet face.
  const c = Math.abs(Math.cos(rad)) < 1e-12 ? 0 : Math.cos(rad);
  const s = Math.abs(Math.sin(rad)) < 1e-12 ? 0 : Math.sin(rad);
  // The symbol's "up" is local -y; on a y-down canvas rotated by `angle` that is (sin, -cos).
  const face: [number, number] = [s, -c];
  const axis: [number, number] = [c, s];
  if (e.item === 'batten') {
    const t5 = T5_SIZES[e.size ?? T5_DEFAULT_SIZE];
    return {
      // Never above the ceiling, whatever elevation was stored against another ceiling height.
      ...base, z: Math.min(e.elevation ?? Infinity, ceiling - T5_BELOW_CEILING),
      lumens: e.lumens ?? t5.lumens, watts: t5.watts,
      tube: { length: t5.length, axis, face },
    };
  }
  const spec = LIGHT_DEFAULTS[e.item];
  if (!spec) return null;
  const lumens = e.lumens ?? spec.lumens;
  if (spec.dist.type === 'tube') {
    return {
      ...base, z: e.elevation ?? ELECTRICAL_BY_ID[e.item].elevation,
      lumens, watts: spec.watts, tube: { length: spec.dist.length, axis, face },
    };
  }
  const z = e.item === 'pendant' ? (e.elevation ?? ELECTRICAL_BY_ID[e.item].elevation) : ceiling;
  return { ...base, z, lumens, watts: spec.watts, exponent: beamExponent(e.beam ?? spec.dist.beam) };
}

/** The luminaires among a floor's objects whose switch group is on (all of them when `on` is omitted). */
export function luminaires(objs: readonly { kind: string }[], ceiling: number, on?: ReadonlySet<number>): Luminaire[] {
  const out: Luminaire[] = [];
  for (const o of objs) {
    if (o.kind !== 'electrical') continue;
    const L = luminaire(o as Electrical, ceiling);
    if (L && (!on || on.has(L.circuit))) out.push(L);
  }
  return out;
}

/**
 * The luminaires that light this room: a downward light inside it (its outline
 * included), a tube or wall light whose lit side is inside it. A fitting on a
 * shared wall sits on both rooms' outlines; which way it faces decides.
 *
 * `grid` does not filter — pass it this, or a neighbour's lights shine through
 * the wall and add their lumens to this room's reflected term.
 */
export function roomLuminaires(r: LightRoom, lums: readonly Luminaire[]): Luminaire[] {
  return lums.filter(L => L.tube
    ? inside(r.poly, L.x + L.tube.face[0] * reachAt(r, L.x, L.y), L.y + L.tube.face[1] * reachAt(r, L.x, L.y))
    : inside(r.poly, L.x, L.y));
}

export interface Source {
  x: number; y: number; z: number;
  /** Direction the source faces. */
  n: [number, number, number];
  /** Tube axis, for the fall-off towards its ends. */
  ax?: [number, number];
  /** cosⁿ exponent of a downward source. */
  exp: number;
  I: number;
  /** The walls that can stand between this source and the room it is lighting; absent = nothing blocks. */
  shade?: ShadeSeg[];
}

/**
 * The luminaires as point sources. With a room that carries `shade`, each
 * source keeps only the wall pieces inside the box spanning it and the room —
 * the only ones a line from it to the room can cross.
 */
export function sources(lums: readonly Luminaire[], r?: LightRoom): Source[] {
  const s = rawSources(lums);
  if (!r?.shade) return s;
  const xs = r.poly.map(p => p.x), ys = r.poly.map(p => p.y);
  const rx0 = Math.min(...xs), rx1 = Math.max(...xs), ry0 = Math.min(...ys), ry1 = Math.max(...ys);
  for (const src of s) {
    const x0 = Math.min(rx0, src.x), x1 = Math.max(rx1, src.x), y0 = Math.min(ry0, src.y), y1 = Math.max(ry1, src.y);
    src.shade = r.shade.filter(w => Math.max(w.ax, w.bx) >= x0 && Math.min(w.ax, w.bx) <= x1
      && Math.max(w.ay, w.by) >= y0 && Math.min(w.ay, w.by) <= y1);
  }
  return s;
}

function rawSources(lums: readonly Luminaire[]): Source[] {
  const s: Source[] = [];
  for (const L of lums) {
    if (!L.tube) {
      const n = L.exponent ?? 1;
      s.push({ x: L.x, y: L.y, z: L.z, n: [0, 0, -1], exp: n, I: L.lumens * (n + 1) / (2 * Math.PI) });
      continue;
    }
    const { length, axis, face } = L.tube;
    for (let i = 0; i < SEG; i++) {
      const t = (i + 0.5) / SEG - 0.5;
      s.push({
        x: L.x + axis[0] * length * t, y: L.y + axis[1] * length * t, z: L.z,
        n: [face[0], face[1], 0], ax: axis, exp: 1,
        I: 2 * L.lumens / SEG / (Math.PI * Math.PI),
      });
    }
  }
  return s;
}

/** The flat inter-reflected term (lux) for `lumens` in a room of `surface` m² total. */
export const indirect = (lumens: number, surface: number, rho: number) =>
  surface > 0 ? MAINTENANCE * lumens * rho / (surface * (1 - rho)) : 0;

/** Illuminance (lux) on a horizontal plane at height h (cm), point (x, y) in cm. */
export function lux(src: readonly Source[], x: number, y: number, h: number, ind: number): number {
  let e = 0;
  for (const s of src) {
    const vx = (x - s.x) / 100, vy = (y - s.y) / 100, vz = (h - s.z) / 100;
    const d2 = vx * vx + vy * vy + vz * vz, d = Math.sqrt(d2);
    const ca = (vx * s.n[0] + vy * s.n[1] + vz * s.n[2]) / d;
    if (ca <= 0) continue;
    const cb = -vz / d;
    if (cb <= 0) continue;
    if (s.shade && wallBetween(s.shade, s.x, s.y, s.z, x, y, h)) continue;
    let k: number;
    if (s.ax) { const u = (vx * s.ax[0] + vy * s.ax[1]) / d; k = Math.sqrt(Math.max(0, 1 - u * u)); }
    else k = s.exp === 1 ? ca : Math.pow(ca, s.exp);
    e += s.I * k * cb / d2;
  }
  return e * MAINTENANCE + ind;
}

// ------------------------------------------------------------------ walls in the way

/**
 * A wall as light sees it: its centre line, solid from the floor to `top`,
 * with a hole wherever a door or window is — `t0`–`t1` along it (0 at a, 1 at
 * b), `z0`–`z1` off the floor. A door is open; a window is glass.
 */
export interface ShadeSeg {
  ax: number; ay: number; bx: number; by: number;
  top: number;
  holes: { t0: number; t1: number; z0: number; z1: number }[];
}

/** Pieces a curved wall is cut into; its openings land on whichever piece their centre is on. */
const ARC_PIECES = 12;

/** Every wall on a floor as segments with their openings punched through. Partitions are lines on paper, not walls. */
export function shadeSegs(walls: readonly Wall[], openings: readonly Opening[]): ShadeSeg[] {
  const out: ShadeSeg[] = [];
  const ops = [...openings];
  for (const w of walls) {
    const pts = w.bulge ? quadPoints(w.a, wallControl(w.a, w.b, w.bulge), w.b, ARC_PIECES) : [w.a, w.b];
    for (let i = 0; i + 1 < pts.length; i++) {
      const piece = { ...w, a: pts[i], b: pts[i + 1], bulge: 0 };
      const len = Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y);
      if (len < 1e-6) continue;
      out.push({
        ax: piece.a.x, ay: piece.a.y, bx: piece.b.x, by: piece.b.y,
        top: w.height ?? Infinity,
        holes: openingsOnWall(piece, ops).map(h => {
          const { elev, height } = openingSpan(h.op);
          return { t0: h.s / len, t1: h.e / len, z0: elev, z1: elev + height };
        }),
      });
    }
  }
  return out;
}

/**
 * Does a wall stand between (sx, sy, sz) and (px, py, pz)? Only a crossing
 * strictly between the two ends counts — a fitting mounted on a wall sits on
 * its line and must not shade itself — and only where the ray is below the
 * wall's top and outside every hole at the height it passes.
 */
export function wallBetween(segs: readonly ShadeSeg[], sx: number, sy: number, sz: number, px: number, py: number, pz: number): boolean {
  const rx = px - sx, ry = py - sy;
  for (const w of segs) {
    const wx = w.bx - w.ax, wy = w.by - w.ay;
    const den = rx * wy - ry * wx;
    if (Math.abs(den) < 1e-9) continue;   // parallel: grazing along a wall, not through it
    const qx = w.ax - sx, qy = w.ay - sy;
    const u = (qx * wy - qy * wx) / den;   // along the ray
    if (u <= 1e-6 || u >= 1 - 1e-6) continue;
    const t = (qx * ry - qy * rx) / den;   // along the wall
    if (t < 0 || t > 1) continue;
    const z = sz + (pz - sz) * u;
    if (z >= w.top) continue;
    if (w.holes.some(h => t >= h.t0 && t <= h.t1 && z >= h.z0 && z <= h.z1)) continue;
    return true;
  }
  return false;
}

/** Below this the brightest a neighbour's light could make any point of a room, it is left out (lux). */
export const REACH_LUX = 1;

/**
 * The luminaires whose direct light can reach this room: its own, and — when
 * walls cast shadows — any other light on the floor bright enough at the
 * room's nearest edge to matter (an upper bound: straight on, nothing in the
 * way). Whether a wall actually blocks it is `lux`'s per-point test.
 */
export function reaching(r: LightRoom, all: readonly Luminaire[]): Luminaire[] {
  const own = roomLuminaires(r, all);
  if (!r.shade) return own;
  const mine = new Set(own);
  const xs = r.poly.map(p => p.x), ys = r.poly.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const out = [...own];
  for (const L of all) {
    if (mine.has(L)) continue;
    const half = L.tube ? L.tube.length / 2 : 0;
    const dx = Math.max(0, x0 - L.x - half, L.x - x1 - half), dy = Math.max(0, y0 - L.y - half, L.y - y1 - half);
    const d2 = (dx * dx + dy * dy) / 1e4;
    const peak = L.tube ? 2 * L.lumens / (Math.PI * Math.PI) : L.lumens * ((L.exponent ?? 1) + 1) / (2 * Math.PI);
    if (d2 > 0 && MAINTENANCE * peak / d2 < REACH_LUX) continue;
    if (!seesRoom(r, L)) continue;
    out.push(L);
  }
  return out;
}

/** Spacing of the coarse probe `seesRoom` uses, cm. */
const PROBE_STEP = 40;

/**
 * Does any straight line from this light reach the room's floor or desk
 * height? A coarse probe — every 40 cm — so a neighbour sealed off by walls
 * drops out of `reaching`, and moving it does not recompute this room.
 */
function seesRoom(r: LightRoom, L: Luminaire): boolean {
  const xs = r.poly.map(p => p.x), ys = r.poly.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const [src] = sources([L], r);
  const pts = L.tube ? sources([L], r).filter((_, i) => i % 5 === 0 || i === SEG - 1) : [src];
  for (let y = y0 + PROBE_STEP / 2; y < y1; y += PROBE_STEP) for (let x = x0 + PROBE_STEP / 2; x < x1; x += PROBE_STEP) {
    if (!inside(r.poly, x, y)) continue;
    for (const s of pts) for (const h of [PLANES.floor, PLANES.desk]) if (!wallBetween(s.shade ?? [], s.x, s.y, s.z, x, y, h)) return true;
  }
  return false;
}

// ------------------------------------------------------------------ rooms

/** A room as the maths sees it: its outline, its ceiling, and the cabinets that fill it to the top. */
export interface LightRoom {
  poly: Vec[];
  ceiling: number;
  blocked: Box[];
  /** The walls the outline was pulled in from; `reachAt` asks them how thick the wall under a point is. */
  walls: readonly Wall[];
  /** The floor's walls as light blockers; absent = the old per-room model where nothing blocks. */
  shade?: ShadeSeg[];
}

/** `reachAt` off any wall, or on one no thicker than 24 cm. */
export const MIN_REACH = 20;

/**
 * How far from the outline something standing on a wall can be — a tube on
 * it, a door in it — and how far to step past that wall to tell which room it
 * belongs to (cm): past half of *that* wall. Not the floor's thickest: a 65 cm
 * column would otherwise let a room reach through its 12 cm wall into a duct
 * next door and claim its door.
 */
export function reachAt(r: LightRoom, x: number, y: number): number {
  let reach = MIN_REACH;
  for (const w of r.walls) {
    if (w.bulge) continue;
    const wx = w.b.x - w.a.x, wy = w.b.y - w.a.y, l2 = wx * wx + wy * wy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - w.a.x) * wx + (y - w.a.y) * wy) / l2)) : 0;
    if (Math.hypot(w.a.x + wx * t - x, w.a.y + wy * t - y) <= w.thickness / 2 + 1) reach = Math.max(reach, w.thickness / 2 + 8);
  }
  return reach;
}

/**
 * `walls` pulls the outline in to the walls' room-side faces: the detector
 * draws a room along wall centre lines, the prototype measures the clear
 * floor. Without it a bedroom gains a strip half a wall thick all round — dark
 * points against the wall that drag the average down by 7 % (B5, notebook).
 */
export function lightRoom(room: Room, ceiling: number, blocked: Box[] = [], walls: readonly Wall[] = [],
                          openings?: readonly Opening[]): LightRoom {
  const poly = room.poly && room.poly.length >= 3 ? room.poly
    : [{ x: room.x, y: room.y }, { x: room.x + room.w, y: room.y }, { x: room.x + room.w, y: room.y + room.h }, { x: room.x, y: room.y + room.h }];
  const r: LightRoom = { poly: walls.length ? innerOutline(poly, walls) : poly, ceiling, blocked, walls };
  // `openings` given = walls cast shadows (B17). Without it, the per-room model of the prototype.
  if (openings) r.shade = shadeSegs(walls, openings);
  return r;
}

/** How far off a wall's centre line an outline edge may lie and still be on that wall (cm). */
const ON_WALL = 0.5;

/** Drop repeated points and spikes — an edge that goes out and straight back, which the detector leaves at a column. */
function tidy(poly: readonly Vec[]): Vec[] {
  let p = [...poly];
  for (let changed = true; changed && p.length > 3;) {
    changed = false;
    for (let i = 0; i < p.length && p.length > 3; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < 1e-6 || (lv > 1e-6 && Math.abs(ux * vy - uy * vx) < 1e-3 * lu * lv && ux * vx + uy * vy < 0)) {
        p.splice(i, 1); changed = true; i--;
      }
    }
  }
  return p;
}

/**
 * The outline moved in, edge by edge, by half the thickness of the straight
 * wall it runs along. An edge on no wall (an open side between two rooms, an
 * arc's chord) stays where it is.
 */
export function innerOutline(poly: readonly Vec[], walls: readonly Wall[]): Vec[] {
  const p = tidy(poly);
  if (p.length < 3) return [...poly];
  const straight = walls.filter(w => !w.bulge && w.thickness > 0);
  const edges = p.map((a, i) => {
    const b = p[(i + 1) % p.length], len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // Inward: whichever side of the edge's middle is inside the room.
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const n = inside(p, m.x - u.y * 0.5, m.y + u.x * 0.5) ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
    // The wall that covers most of the edge. An edge the detector drew never
    // spans two walls (it splits at every joint); a hand-drawn room can.
    let d = 0, best = 0;
    for (const w of straight) {
      const wx = w.b.x - w.a.x, wy = w.b.y - w.a.y, wl = Math.hypot(wx, wy);
      if (wl < 1e-6) continue;
      const off = (q: Vec) => Math.abs((q.x - w.a.x) * wy - (q.y - w.a.y) * wx) / wl;
      if (off(a) >= ON_WALL || off(b) >= ON_WALL) continue;
      const t = (q: Vec) => ((q.x - w.a.x) * wx + (q.y - w.a.y) * wy) / (wl * wl);
      const ta = t(a), tb = t(b);
      const ov = (Math.min(1, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb))) * wl;
      if (ov > best + 1e-6 || (ov > 0 && Math.abs(ov - best) <= 1e-6 && w.thickness / 2 > d)) { best = ov; d = w.thickness / 2; }
    }
    return { a, u, n, d };
  });
  const out: Vec[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e0 = edges[(i + edges.length - 1) % edges.length], e1 = edges[i], v = e1.a;
    const p0 = { x: v.x + e0.n.x * e0.d, y: v.y + e0.n.y * e0.d };
    const p1 = { x: v.x + e1.n.x * e1.d, y: v.y + e1.n.y * e1.d };
    const cross = e0.u.x * e1.u.y - e0.u.y * e1.u.x;
    if (Math.abs(cross) < 1e-6) {
      // Straight on, from one wall to a thicker or thinner one: a step.
      out.push(p0);
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1e-6) out.push(p1);
      continue;
    }
    // Where the two moved edges meet — unless the corner is all but straight
    // and the edges move by different amounts: then they meet metres away (a
    // chord leaving a wall at 3°, two walls 0.3 cm out of line), so it is a step.
    const s = ((p1.x - p0.x) * e1.u.y - (p1.y - p0.y) * e1.u.x) / cross;
    const q = { x: p0.x + e0.u.x * s, y: p0.y + e0.u.y * s };
    if (e0.u.x * e1.u.x + e0.u.y * e1.u.y > 0 && Math.hypot(q.x - v.x, q.y - v.y) > 2 * Math.max(e0.d, e1.d) + 1e-6) {
      out.push(p0, p1);
      continue;
    }
    out.push(q);
  }
  return out;
}

const polyArea = (p: Vec[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
  return Math.abs(a) / 2;
};
const polyPerimeter = (p: Vec[]) => {
  let l = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; l += Math.hypot(q.x - p[i].x, q.y - p[i].y); }
  return l;
};

/** Floor + ceiling + walls, in m². */
export const surfaceArea = (r: LightRoom) =>
  2 * polyArea(r.poly) / 1e4 + polyPerimeter(r.poly) * r.ceiling / 1e4;

/** Inside or on the outline — the prototype samples the walls' own line too. */
export function inside(p: Vec[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    if (Math.hypot(a.x + dx * t - x, a.y + dy * t - y) < 1e-6) return true;
    if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * dx / dy) hit = !hit;
  }
  return hit;
}

/** Strictly inside a box: a point on a cabinet's face is still lit floor. */
export function isBlocked(r: LightRoom, x: number, y: number): boolean {
  for (const b of r.blocked) {
    const a = -b.angle * Math.PI / 180, dx = x - b.cx, dy = y - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) < b.w / 2 && Math.abs(ly) < b.h / 2) return true;
  }
  return false;
}

export interface LuxGrid {
  /** World position of sample (0, 0) and the spacing, all cm. */
  x0: number; y0: number; step: number;
  nx: number; ny: number;
  /** Row-major lux; NaN outside the room or inside a full-height cabinet. */
  v: Float32Array;
  indirect: number;
  avg: number; min: number; max: number;
  /** Share of sampled points at or above 100 / 300 lux. */
  p100: number; p300: number;
  /** min ÷ avg. */
  uniformity: number;
}

export interface GridOptions { height: number; rho: number; step: number; }

/** Sample the room on a square grid anchored at its bounding box's corner. */
/**
 * `lums` are the room's own lights — they fill the reflected term. `near` are
 * the ones whose direct light is counted (`reaching`: its own plus neighbours'
 * through the doors); by default the same.
 */
export function grid(r: LightRoom, lums: readonly Luminaire[], o: GridOptions, near: readonly Luminaire[] = lums): LuxGrid {
  const src = sources(near, r);
  const ind = indirect(lums.reduce((a, L) => a + L.lumens, 0), surfaceArea(r), o.rho);
  const xs = r.poly.map(p => p.x), ys = r.poly.map(p => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const nx = Math.floor((Math.max(...xs) - x0) / o.step + 1e-9) + 1;
  const ny = Math.floor((Math.max(...ys) - y0) / o.step + 1e-9) + 1;
  const v = new Float32Array(nx * ny);
  let sum = 0, cnt = 0, mn = Infinity, mx = 0, c100 = 0, c300 = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * o.step, y = y0 + j * o.step;
    if (!inside(r.poly, x, y) || isBlocked(r, x, y)) { v[j * nx + i] = NaN; continue; }
    const e = lux(src, x, y, o.height, ind);
    v[j * nx + i] = e; sum += e; cnt++;
    if (e < mn) mn = e;
    if (e > mx) mx = e;
    if (e >= 100) c100++;
    if (e >= 300) c300++;
  }
  const avg = cnt ? sum / cnt : 0;
  return {
    x0, y0, step: o.step, nx, ny, v, indirect: ind,
    avg, min: cnt ? mn : 0, max: mx,
    p100: cnt ? c100 / cnt : 0, p300: cnt ? c300 / cnt : 0,
    uniformity: avg ? (cnt ? mn : 0) / avg : 0,
  };
}
