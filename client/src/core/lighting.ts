// Illuminance on a horizontal work plane, room by room.
//
// The maths is the bedroom-lighting prototype's (docs/lighting-prototype.html,
// `sources`/`lux`/`grid`), kept line for line so its numbers are the acceptance
// check: direct light from every luminaire, plus one flat inter-reflected term
// for the whole room, all times a maintenance factor.
//
//   · downward lights (downlight, ceiling light, spotlight, pendant): a cosⁿ
//     source pointing at the floor, n from the beam angle (120° → n = 1, which
//     is Lambertian), normalised so the lower hemisphere carries the flux; a
//     ceiling linear light (B29) is SEG of them along its length, Φ/SEG each
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
import { ELECTRICAL_BY_ID, LIGHT_DEFAULTS, LINEAR_LIGHTS, T5_SIZES, T5_DEFAULT_SIZE, T5_BELOW_CEILING } from '../model/catalogue';
import { linearLength, linearOutput } from './linearLight';
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
  /** A downward light that is a line (a ceiling linear light, B29): its length and the unit vector along it. */
  line?: { length: number; axis: [number, number] };
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
  const lin = LINEAR_LIGHTS[e.item];
  if (lin) {
    // B29: as long as the object says, its flux that length's worth.
    const length = linearLength(e), out = linearOutput(e.item, length);
    const lumens = e.lumens ?? out.lumens;
    if (lin.dist.type === 'down') {
      return { ...base, z: ceiling, lumens, watts: out.watts, exponent: beamExponent(e.beam ?? lin.dist.beam), line: { length, axis } };
    }
    const below = lin.dist.belowCeiling;
    const z = below === undefined ? (e.elevation ?? ELECTRICAL_BY_ID[e.item].elevation)
      : Math.min(e.elevation ?? Infinity, ceiling - below);
    return { ...base, z, lumens, watts: out.watts, tube: { length, axis, face } };
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
  // In a convex room, a line between two points inside it stays inside it, so
  // for a source inside, only the walls that reach into the room can block it
  // — usually none. That is most sources, and it is where the time went.
  const convex = isConvex(r.poly);
  const intruding = convex ? r.shade.filter(w => segEntersPoly(w, r.poly)) : null;
  for (const src of s) {
    if (intruding && inside(r.poly, src.x, src.y)) { if (intruding.length) src.shade = intruding; continue; }
    const x0 = Math.min(rx0, src.x), x1 = Math.max(rx1, src.x), y0 = Math.min(ry0, src.y), y1 = Math.max(ry1, src.y);
    src.shade = r.shade.filter(w => Math.max(w.ax, w.bx) >= x0 && Math.min(w.ax, w.bx) <= x1
      && Math.max(w.ay, w.by) >= y0 && Math.min(w.ay, w.by) <= y1);
  }
  return s;
}

function isConvex(p: readonly Vec[]): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-6) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

/** Does any part of a wall's centre line lie strictly inside the polygon (an end inside, or crossing an edge)? */
function segEntersPoly(w: ShadeSeg, p: readonly Vec[]): boolean {
  if (inside(p as Vec[], w.ax, w.ay) || inside(p as Vec[], w.bx, w.by)) return true;
  const rx = w.bx - w.ax, ry = w.by - w.ay;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], ex = b.x - a.x, ey = b.y - a.y;
    const den = rx * ey - ry * ex;
    if (Math.abs(den) < 1e-9) continue;
    const qx = a.x - w.ax, qy = a.y - w.ay;
    const u = (qx * ey - qy * ex) / den, t = (qx * ry - qy * rx) / den;
    if (u > 1e-6 && u < 1 - 1e-6 && t > 1e-6 && t < 1 - 1e-6) return true;
  }
  return false;
}

/**
 * A source whose most it could add at a point (straight on, nothing in the
 * way) is under this is skipped before the wall test, lux. Far neighbours
 * through a door are most of the sources and nearly all of the wall tests.
 */
const NEGLIGIBLE_LUX = 0.05;

function rawSources(lums: readonly Luminaire[]): Source[] {
  const s: Source[] = [];
  for (const L of lums) {
    if (!L.tube) {
      const n = L.exponent ?? 1;
      // A line of downward light is SEG of the same cosⁿ source, each its share of the flux.
      const k = L.line ? SEG : 1;
      for (let i = 0; i < k; i++) {
        const t = L.line ? (i + 0.5) / SEG - 0.5 : 0, len = L.line?.length ?? 0, ax = L.line?.axis ?? [0, 0];
        s.push({ x: L.x + ax[0] * len * t, y: L.y + ax[1] * len * t, z: L.z, n: [0, 0, -1], exp: n, I: L.lumens / k * (n + 1) / (2 * Math.PI) });
      }
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
    if (s.shade && s.I * MAINTENANCE / d2 < NEGLIGIBLE_LUX) continue;
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
 * A wall as light sees it: its centre line, `half` its thickness either side,
 * solid from the floor to `top`, with a hole wherever a door or window is —
 * `t0`–`t1` along it (0 at a, 1 at b), `z0`–`z1` off the floor. A door is
 * open; a window is glass.
 */
export interface ShadeSeg {
  ax: number; ay: number; bx: number; by: number;
  half: number;
  top: number;
  holes: { t0: number; t1: number; z0: number; z1: number }[];
}

/**
 * Pieces a curved wall is cut into. The same as `ARC_SEG` in
 * server/app/rooms.py, which cuts the room outline along the arc: with fewer
 * pieces the chords cut inside the outline and a room's own curved wall
 * shades the strip of floor next to it. Change both together.
 */
const ARC_PIECES = 14;

/** Every wall on a floor as segments with their openings punched through. Partitions are lines on paper, not walls. */
export function shadeSegs(walls: readonly Wall[], openings: readonly Opening[]): ShadeSeg[] {
  const out: ShadeSeg[] = [];
  const ops = [...openings];
  for (const w of walls) {
    const top = w.height ?? Infinity, half = w.thickness / 2;
    if (!w.bulge) {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (len < 1e-6) continue;
      out.push({
        ax: w.a.x, ay: w.a.y, bx: w.b.x, by: w.b.y, half, top,
        holes: openingsOnWall(w, ops).map(h => {
          const { elev, height } = openingSpan(h.op);
          return { t0: h.s / len, t1: h.e / len, z0: elev, z1: elev + height };
        }),
      });
      continue;
    }
    // A curved wall: openings are placed by arc length along the whole wall,
    // then shared out to the pieces they overlap — an opening is wider than one piece.
    const pts = quadPoints(w.a, wallControl(w.a, w.b, w.bulge), w.b, ARC_PIECES);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const spans: { s: number; e: number; z0: number; z1: number }[] = [];
    for (const op of ops) {
      let best = { d: Infinity, at: 0 };
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], len = cum[i + 1] - cum[i];
        if (len < 1e-9) continue;
        const t = Math.max(0, Math.min(1, ((op.x - a.x) * (b.x - a.x) + (op.y - a.y) * (b.y - a.y)) / (len * len)));
        const d = Math.hypot(a.x + (b.x - a.x) * t - op.x, a.y + (b.y - a.y) * t - op.y);
        if (d < best.d) best = { d, at: cum[i] + t * len };
      }
      if (best.d > half + 10) continue;   // the same tolerance as openingsOnWall
      const { elev, height } = openingSpan(op);
      spans.push({ s: best.at - op.width / 2, e: best.at + op.width / 2, z0: elev, z1: elev + height });
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const len = cum[i + 1] - cum[i];
      if (len < 1e-6) continue;
      out.push({
        ax: pts[i].x, ay: pts[i].y, bx: pts[i + 1].x, by: pts[i + 1].y, half, top,
        holes: spans.filter(h => h.e > cum[i] && h.s < cum[i + 1]).map(h => ({
          t0: Math.max(0, (h.s - cum[i]) / len), t1: Math.min(1, (h.e - cum[i]) / len), z0: h.z0, z1: h.z1,
        })),
      });
    }
  }
  return out;
}

/** Slack at a wall's ends, so a ray through the joint of two walls cannot slip between them. */
const JOINT_EPS = 1e-9;

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
    if (t < -JOINT_EPS || t > 1 + JOINT_EPS) continue;
    const z = sz + (pz - sz) * u;
    if (z >= w.top) continue;
    if (w.holes.some(h => t >= h.t0 && t <= h.t1 && z >= h.z0 && z <= h.z1)) continue;
    return true;
  }
  return false;
}

/** Below this the brightest a neighbour's light could make the room through its nearest opening, it is left out (lux). */
export const REACH_LUX = 1;

/** A way into a room for light from outside: a point of a door or window in its wall, or of an open side. */
interface Portal { x: number; y: number; z0: number; z1: number }

/** Spacing of the points `portals` takes along the outline, cm. */
const PORTAL_STEP = 10;

/**
 * The room's ways in: walk its outline every 10 cm; a point against a wall is
 * a portal only where that wall has a hole (the point moved onto the wall's
 * centre line, at the hole's heights); a point against no wall is an open
 * side, floor to ceiling. A room closed by walls with no doors has none.
 */
export function portals(r: LightRoom, shade: readonly ShadeSeg[]): Portal[] {
  const out: Portal[] = [];
  const p = r.poly;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = PORTAL_STEP / 2; s < len; s += PORTAL_STEP) {
      const x = a.x + (b.x - a.x) * s / len, y = a.y + (b.y - a.y) * s / len;
      let wall: { w: ShadeSeg; t: number; d: number } | null = null;
      for (const w of shade) {
        const wx = w.bx - w.ax, wy = w.by - w.ay, l2 = wx * wx + wy * wy;
        const t = l2 ? ((x - w.ax) * wx + (y - w.ay) * wy) / l2 : 0;
        if (t < -JOINT_EPS || t > 1 + JOINT_EPS) continue;
        const d = Math.hypot(w.ax + wx * t - x, w.ay + wy * t - y);
        if (d <= w.half + 2 && (!wall || d < wall.d)) wall = { w, t, d };
      }
      if (!wall) { out.push({ x, y, z0: 0, z1: r.ceiling }); continue; }
      const { w, t } = wall;
      for (const h of w.holes) if (t >= h.t0 && t <= h.t1) {
        out.push({ x: w.ax + (w.bx - w.ax) * t, y: w.ay + (w.by - w.ay) * t, z0: h.z0, z1: h.z1 });
      }
    }
  }
  return out;
}

/**
 * The luminaires whose direct light can reach this room: its own, and — when
 * walls cast shadows — each other light on the floor that has a clear line to
 * one of the room's openings (`portals`, through doors or windows alike) and
 * would still be bright enough through the nearest one to matter. A neighbour
 * sealed off by walls drops out, so moving it does not recompute this room.
 * Whether a wall blocks a given point is `lux`'s test.
 */
export function reaching(r: LightRoom, all: readonly Luminaire[]): Luminaire[] {
  const own = roomLuminaires(r, all);
  if (!r.shade) return own;
  const mine = new Set(own);
  const ways = portals(r, r.shade);
  if (!ways.length) return own;
  // Each neighbour's upper bound through the nearest opening. The faintest are
  // left out only while together they stay under REACH_LUX: forty lights at
  // 0.9 lux each are not nothing.
  const cand: { L: Luminaire; bound: number }[] = [];
  for (const L of all) {
    if (mine.has(L)) continue;
    const half = L.tube ? L.tube.length / 2 : 0;
    let rho = Infinity;
    for (const q of ways) rho = Math.min(rho, Math.max(0, Math.hypot(q.x - L.x, q.y - L.y) - half));
    cand.push({ L, bound: reachBound(L, rho) });
  }
  cand.sort((p, q) => p.bound - q.bound);
  let dropped = 0, k = 0;
  while (k < cand.length && dropped + cand[k].bound < REACH_LUX) dropped += cand[k++].bound;
  const out = [...own];
  for (; k < cand.length; k++) if (seesWayIn(r.shade, cand[k].L, ways)) out.push(cand[k].L);
  return out;
}

/**
 * The most lux a light can put on any work plane (floor to 120 cm) at least
 * `rho` cm away in plan, using its own distribution, not straight-on
 * intensity: on a horizontal plane Δz below, a downward cosⁿ source gives
 * I·Δzⁿ⁺¹ / dⁿ⁺³ and a sideways tube at most I·Δz / d³ — far less than I/ρ²
 * once the point is off to the side, which is where a neighbour's room is.
 */
/** The highest work plane anything is measured on, cm — above the desk: counters and vanities. */
const HIGHEST_PLANE = 120;

export function reachBound(L: Luminaire, rho: number): number {
  const peak = L.tube ? 2 * L.lumens / (Math.PI * Math.PI) : L.lumens * ((L.exponent ?? 1) + 1) / (2 * Math.PI);
  const r = rho / 100;
  const n = L.tube ? 0 : (L.exponent ?? 1);   // a tube's cos(ca) towards the plane is ≤ 1: bound it by cb alone
  // Up to a worktop or a vanity top (zones go to ~110 cm), down to the floor.
  const lo = Math.max(0.01, (L.z - HIGHEST_PLANE) / 100), hi = Math.max(lo, L.z / 100);
  // f(Δz) = Δzⁿ⁺¹ / (ρ² + Δz²)^((n+3)/2) peaks at Δz = ρ·√((n+1)/2); clamp to the planes' range
  const best = Math.min(hi, Math.max(lo, r * Math.sqrt((n + 1) / 2)));
  const f = Math.pow(best, n + 1) / Math.pow(r * r + best * best, (n + 3) / 2);
  return MAINTENANCE * peak * f;
}

/** Does a straight line run from the light (its middle and ends, for a tube) to any opening, at a height inside it? */
function seesWayIn(shade: readonly ShadeSeg[], L: Luminaire, ways: readonly Portal[]): boolean {
  const from = L.tube
    ? [-0.45, 0, 0.45].map(k => ({ x: L.x + L.tube!.axis[0] * L.tube!.length * k, y: L.y + L.tube!.axis[1] * L.tube!.length * k }))
    : [{ x: L.x, y: L.y }];
  for (const q of ways) for (const f of from) for (const z of [q.z0 + 1, (q.z0 + q.z1) / 2, q.z1 - 1]) {
    if (!wallBetween(shade, f.x, f.y, L.z, q.x, q.y, z)) return true;
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
                          openings?: readonly Opening[], shade?: ShadeSeg[]): LightRoom {
  const poly = room.poly && room.poly.length >= 3 ? room.poly
    : [{ x: room.x, y: room.y }, { x: room.x + room.w, y: room.y }, { x: room.x + room.w, y: room.y + room.h }, { x: room.x, y: room.y + room.h }];
  const r: LightRoom = { poly: walls.length ? innerOutline(poly, walls) : poly, ceiling, blocked, walls };
  // `openings` given = walls cast shadows (B17). Without it, the per-room model of the prototype.
  // A floor's worth of rooms passes the floor's `shade` in, built once.
  if (openings) r.shade = shade ?? shadeSegs(walls, openings);
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

/** Where a room's grid samples sit: its bounding box's corner, every `step` cm. */
export function gridFrame(r: LightRoom, step: number) {
  const xs = r.poly.map(p => p.x), ys = r.poly.map(p => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const nx = Math.floor((Math.max(...xs) - x0) / step + 1e-9) + 1;
  const ny = Math.floor((Math.max(...ys) - y0) / step + 1e-9) + 1;
  return { x0, y0, nx, ny };
}

/**
 * One light's direct lux over a room's grid, nothing reflected, NaN where the
 * grid is not floor (outside, or inside a cabinet). A room's grid is the sum
 * of these over its `near` lights plus the reflected term — so a cache can
 * keep them per light, and dragging one light recomputes only its own.
 */
export function directGrid(r: LightRoom, L: Luminaire, height: number, step: number): Float32Array {
  const { x0, y0, nx } = gridFrame(r, step);
  const src = sources([L], r);
  const m = floorMask(r, step);
  const v = new Float32Array(m.length);
  for (let k = 0; k < m.length; k++) {
    v[k] = m[k] ? lux(src, x0 + (k % nx) * step, y0 + Math.floor(k / nx) * step, height, 0) : NaN;
  }
  return v;
}

/** Which grid samples are floor (inside, not in a cabinet) — once per room and spacing, not once per light. */
const masks = new WeakMap<LightRoom, Map<number, Uint8Array>>();
function floorMask(r: LightRoom, step: number): Uint8Array {
  let byStep = masks.get(r);
  if (!byStep) masks.set(r, byStep = new Map());
  let m = byStep.get(step);
  if (m) return m;
  const { x0, y0, nx, ny } = gridFrame(r, step);
  m = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, y = y0 + j * step;
    m[j * nx + i] = inside(r.poly, x, y) && !isBlocked(r, x, y) ? 1 : 0;
  }
  byStep.set(step, m);
  return m;
}

/**
 * `lums` are the room's own lights — they fill the reflected term. `near` are
 * the ones whose direct light is counted (`reaching`: its own plus neighbours'
 * through the doors); by default the same. `parts` gives a light's
 * `directGrid` (a cache); without it each is computed here.
 */
export function grid(r: LightRoom, lums: readonly Luminaire[], o: GridOptions, near: readonly Luminaire[] = lums,
                     parts: (L: Luminaire) => Float32Array = L => directGrid(r, L, o.height, o.step)): LuxGrid {
  const ind = indirect(lums.reduce((a, L) => a + L.lumens, 0), surfaceArea(r), o.rho);
  const { x0, y0, nx, ny } = gridFrame(r, o.step);
  const v = new Float32Array(nx * ny);
  if (near.length) {
    for (const L of near) { const p = parts(L); for (let k = 0; k < v.length; k++) v[k] += p[k]; }
  } else {
    const m = floorMask(r, o.step);
    for (let k = 0; k < v.length; k++) if (!m[k]) v[k] = NaN;
  }
  let sum = 0, cnt = 0, mn = Infinity, mx = 0, c100 = 0, c300 = 0;
  for (let k = 0; k < v.length; k++) {
    if (Number.isNaN(v[k])) continue;
    const e = v[k] + ind;
    v[k] = e; sum += e; cnt++;
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
