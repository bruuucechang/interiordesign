// Where a wall is solid once its doors and windows are taken out.
//
// Split out of view3d.ts because it is the one part of building a wall that can
// be wrong without looking wrong: get it slightly off and you still get a wall
// with a hole in it, just not where the plan says. Nothing throws, and the only
// way to notice is to look at the 3D view and know what it should have been.
// Here it is a pure function over plan data, so it can be checked directly.
//
// Lengths are along the wall from its `a` end, in cm. Heights are from the
// floor of the storey, also in cm — the caller adds the storey's base.

import { Obj, Vec } from '../model/schema';
import { dist, closestOnSegment } from './geometry';

export type Wall = Extract<Obj, { kind: 'wall' }>;
export type Opening = Extract<Obj, { kind: 'door' | 'window' }>;

/** A solid box of wall: `s0`–`s1` along its length, `yLo`–`yHi` off the floor. */
export interface WallPiece {
  s0: number;
  s1: number;
  yLo: number;
  yHi: number;
}

/** Nothing smaller than this is worth building — it would be a sliver, not a wall. */
const MIN_PIECE = 0.5;

/**
 * How tall an opening is and how far off the floor it sits, when the object
 * does not say.
 *
 * These defaults were written out four times across two branches of the wall
 * builder. Four copies of a pair of numbers is four chances for the curved
 * branch and the straight one to disagree about what a window is.
 */
export function openingSpan(op: Opening): { elev: number; height: number } {
  const isDoor = op.kind === 'door';
  return {
    elev: op.elevation ?? (isDoor ? 0 : 90),
    height: op.height ?? (isDoor ? 210 : 100),
  };
}

/**
 * Which of `openings` actually sit on this wall, as spans along its length.
 *
 * An opening belongs to a wall when its centre is within half the wall's
 * thickness of the centreline — plus a little, since the editor snaps openings
 * to the wall's face rather than its middle — and its foot falls between the
 * ends. A plan has openings on every wall; without this test each one would be
 * punched through all of them.
 */
export function openingsOnWall(
  wall: Wall, openings: Opening[],
): { op: Opening; s: number; e: number }[] {
  const { a, b } = wall;
  const length = dist(a, b);
  if (length < 1) return [];

  return openings
    .map((op) => {
      const foot = closestOnSegment({ x: op.x, y: op.y }, a, b);
      return { op, foot, gap: dist({ x: op.x, y: op.y }, foot.point) };
    })
    .filter((h) => h.gap <= wall.thickness / 2 + 10 && h.foot.t >= -0.001 && h.foot.t <= 1.001)
    .map((h) => {
      const centre = h.foot.t * length;
      return {
        op: h.op,
        s: Math.max(0, centre - h.op.width / 2),
        e: Math.min(length, centre + h.op.width / 2),
      };
    })
    .sort((x, y) => x.s - y.s);
}

/**
 * The solid pieces of a straight wall.
 *
 * Walking from one end: wall up to the opening, the sill under it (nothing for
 * a door, which starts at the floor), the header over it, then on to the next.
 * `cursor` never moves backwards, so two openings that overlap — which a plan
 * can hold, and which the editor does not prevent — produce one combined hole
 * instead of a negative-length piece.
 */
export function wallPieces(
  wall: Wall, openings: Opening[], wallHeight: number,
): WallPiece[] {
  const length = dist(wall.a, wall.b);
  if (length < 1) return [];

  const pieces: WallPiece[] = [];
  const add = (s0: number, s1: number, yLo: number, yHi: number) => {
    if (s1 - s0 > MIN_PIECE && yHi - yLo > MIN_PIECE) pieces.push({ s0, s1, yLo, yHi });
  };

  let cursor = 0;
  for (const hole of openingsOnWall(wall, openings)) {
    const { elev, height } = openingSpan(hole.op);
    add(cursor, hole.s, 0, wallHeight);           // wall before it
    add(hole.s, hole.e, 0, elev);                 // sill beneath
    add(hole.s, hole.e, elev + height, wallHeight); // header above
    cursor = Math.max(cursor, hole.e);
  }
  add(cursor, length, 0, wallHeight);             // whatever is left

  return pieces;
}

/**
 * The same thing for a curved wall, in terms of the sampled arc.
 *
 * A curve is swept as a band rather than stacked as boxes, so the answer is a
 * run of arc indices plus the heights that run should span. Consecutive
 * segments in the same state — inside the same opening, or solid — are grouped
 * so the sweep stays smooth instead of being cut at every sample.
 */
export interface ArcBand {
  from: number;
  to: number;
  yLo: number;
  yHi: number;
}

export function curvedWallBands(
  pts: Vec[], wall: Wall, openings: Opening[], wallHeight: number,
): ArcBand[] {
  const n = pts.length;
  if (n < 2) return [];

  const nearest = (p: Vec) => {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = dist(p, pts[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return { index: best, gap: bestDist };
  };

  type Hole = { lo: number; hi: number; elev: number; height: number };
  const holes: Hole[] = openings
    .map((op) => {
      const half = op.width / 2;
      const ca = Math.cos(op.angle * Math.PI / 180), sa = Math.sin(op.angle * Math.PI / 180);
      const r0 = nearest({ x: op.x - half * ca, y: op.y - half * sa });
      const r1 = nearest({ x: op.x + half * ca, y: op.y + half * sa });
      const { elev, height } = openingSpan(op);
      return {
        lo: Math.min(r0.index, r1.index),
        hi: Math.max(r0.index, r1.index),
        gap: Math.max(r0.gap, r1.gap),
        elev, height,
      };
    })
    .filter((h) => h.gap <= wall.thickness / 2 + 15 && h.hi > h.lo);

  const holeAt = (i: number) => holes.find((h) => i - 1 < h.hi && i > h.lo);

  const bands: ArcBand[] = [];
  const push = (from: number, to: number, yLo: number, yHi: number) => {
    // Same floor as the straight path. Without it a door — which starts at the
    // floor, so its sill is nothing — asked for a band of zero height on every
    // curved wall it sat in.
    if (yHi - yLo > MIN_PIECE) bands.push({ from, to, yLo, yHi });
  };
  const flush = (from: number, to: number, hole?: Hole) => {
    if (to <= from) return;
    if (!hole) push(from, to, 0, wallHeight);
    else {
      push(from, to, 0, hole.elev);
      push(from, to, hole.elev + hole.height, wallHeight);
    }
  };

  let from = 0, current = holeAt(1);
  for (let i = 2; i < n; i++) {
    const h = holeAt(i);
    if (h !== current) { flush(from, i - 1, current); from = i - 1; current = h; }
  }
  flush(from, n - 1, current);

  return bands;
}
