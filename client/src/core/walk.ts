// Walking through the plan (B19, docs/spec-game-mode.md §3): a person-sized
// circle that walls stop and doorways let through, and stairs that carry it
// from one storey to the next.
//
// Pure: plan objects in, positions out — view3d moves the camera to where this
// says. Everything is in plan cm; `z` is the feet's height above ground.
//
//   · walls (and the windows in them) are solid; a door is a gap in its wall.
//     A wall is its centre line, `half` its thickness either side, so the
//     circle stays `RADIUS + half` from the line. A door narrower than the
//     circle cannot be walked through — the two jambs either side of it are
//     each a rounded end, and the gap between them is the door's width.
//   · furniture and partitions do not block (the user's call)
//   · moving is slide-along-the-wall: push the circle out of every wall it
//     overlaps, a few rounds, in sub-steps short enough never to jump a wall

import type { Floor, Furniture, Obj, Opening, Vec, Wall } from '../model/schema';
import { quadPoints, wallControl } from './geometry';
import { openingsOnWall } from './wallGeometry';

/** The walker's numbers (cm, cm/s). Not facts — tuned to feel right; see the spec. */
export const WALK = { radius: 25, eye: 160, speed: 140, run: 350 } as const;

/** One solid stretch of wall: a segment with a thickness. */
export interface Blocker { ax: number; ay: number; bx: number; by: number; half: number }

/** Matches the curved-wall tessellation everywhere else (lighting.ts, server/app/rooms.py). */
const ARC_PIECES = 14;

/** The solid parts of a storey's walls: each wall minus its doors. Windows stay solid. */
export function blockers(objs: readonly Obj[]): Blocker[] {
  const doors = objs.filter((o): o is Opening => o.kind === 'door');
  const out: Blocker[] = [];
  for (const w of objs) {
    if (w.kind !== 'wall') continue;
    const half = w.thickness / 2;
    const pts = w.bulge ? quadPoints(w.a, wallControl(w.a, w.b, w.bulge), w.b, ARC_PIECES) : [w.a, w.b];
    for (let i = 0; i + 1 < pts.length; i++) {
      const piece: Wall = { ...w, a: pts[i], b: pts[i + 1], bulge: 0 };
      const len = Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y);
      if (len < 1e-6) continue;
      const ux = (piece.b.x - piece.a.x) / len, uy = (piece.b.y - piece.a.y) / len;
      let s = 0;
      for (const h of openingsOnWall(piece, doors)) {
        if (h.s > s) out.push({ ax: piece.a.x + ux * s, ay: piece.a.y + uy * s, bx: piece.a.x + ux * h.s, by: piece.a.y + uy * h.s, half });
        s = Math.max(s, h.e);
      }
      if (len > s) out.push({ ax: piece.a.x + ux * s, ay: piece.a.y + uy * s, bx: piece.b.x, by: piece.b.y, half });
    }
  }
  return out;
}

/** Push a circle at p out of every blocker it overlaps; a few rounds settle corners. */
export function resolve(p: Vec, walls: readonly Blocker[], radius = WALK.radius): Vec {
  let { x, y } = p;
  for (let round = 0; round < 4; round++) {
    let moved = false;
    for (const w of walls) {
      const wx = w.bx - w.ax, wy = w.by - w.ay, l2 = wx * wx + wy * wy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - w.ax) * wx + (y - w.ay) * wy) / l2)) : 0;
      const cx = w.ax + wx * t, cy = w.ay + wy * t;
      let dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy), need = radius + w.half;
      if (d >= need) continue;
      if (d < 1e-9) { dx = -wy; dy = wx; }   // exactly on the line: out to one side
      const k = need / Math.hypot(dx, dy);
      x = cx + dx * k; y = cy + dy * k;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, y };
}

/** Longest single sub-step, cm: under the circle's radius, so no wall is thin enough to step over. */
const SUBSTEP = 10;

/** Walk from p by (dx, dy), sliding along whatever walls are in the way. */
export function move(p: Vec, dx: number, dy: number, walls: readonly Blocker[], radius = WALK.radius): Vec {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SUBSTEP));
  let q = p;
  for (let i = 0; i < n; i++) q = resolve({ x: q.x + dx / n, y: q.y + dy / n }, walls, radius);
  return q;
}

// ---- stairs ----

/**
 * A staircase: the catalogue's `stairs` piece. It climbs one storey along its
 * length, low at the symbol's bottom edge (local +y) and high at its top edge
 * (local −y) — the end the 3D steps rise to.
 */
export const isStair = (o: Obj): o is Furniture => o.kind === 'furniture' && o.item === 'stairs';

/** How far up the flight a plan point is, 0 at the foot to 1 at the head, or null if it is not on it. */
export function stairProgress(s: Furniture, p: Vec): number | null {
  const a = s.angle * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const dx = p.x - cx, dy = p.y - cy;
  const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;   // into the piece's own frame
  if (Math.abs(lx) > s.w / 2 || Math.abs(ly) > s.h / 2) return null;
  return 0.5 - ly / s.h;
}

export interface Walker { x: number; y: number; /** Storey index into project.floors. */ floor: number; /** Feet above ground, cm. */ z: number }

/**
 * Where the feet are after standing at (x, y) with the walker last on storey
 * `floor`: on a flight that starts on this storey (going up) or on the one
 * below (coming down), the height follows the flight and the storey becomes
 * whichever end is nearer; anywhere else, this storey's floor.
 */
export function settle(floors: readonly Floor[], floor: number, p: Vec): Walker {
  for (const f of [floor, floor - 1]) {
    const here = floors[f], up = floors[f + 1];
    if (!here || !up) continue;
    for (const s of here.objects) {
      if (!isStair(s)) continue;
      const t = stairProgress(s, p);
      if (t === null) continue;
      const z = here.elevation + (up.elevation - here.elevation) * t;
      return { x: p.x, y: p.y, floor: t >= 0.5 ? f + 1 : f, z };
    }
  }
  const f = floors[floor];
  return { x: p.x, y: p.y, floor, z: f ? f.elevation : 0 };
}

/**
 * One frame of walking: move by (dx, dy) against the walls of the storey the
 * walker is on, then settle onto the floor or the stairs.
 */
export function walkStep(floors: readonly Floor[], w: Walker, dx: number, dy: number,
                         wallsOf: (floor: number) => readonly Blocker[]): Walker {
  // Settle every sub-step: a long frame that crossed the middle of a flight
  // would otherwise never notice it changed storey on the way.
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SUBSTEP));
  for (let i = 0; i < n; i++) w = settle(floors, w.floor, move(w, dx / n, dy / n, wallsOf(w.floor)));
  return w;
}

/**
 * Where to put someone entering walk mode near a plan point: there if it is
 * clear of walls, else pushed out to the nearest clear spot.
 */
export function spawn(floors: readonly Floor[], floor: number, p: Vec, walls: readonly Blocker[]): Walker {
  return settle(floors, floor, resolve(p, walls));
}
