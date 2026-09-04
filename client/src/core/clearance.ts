// Keeping furniture out of the walls.
//
// A wall is a solid and a sofa is a solid, and the plan is the only place in
// this program where two solids are allowed to be in the same cubic metre. In
// 2D the sofa is simply drawn on top of the wall and looks like a decision; in
// 3D it is a sofa with a wall through it. Nothing throws, nothing warns, and
// the plan gets built.
//
// Both boxes are oriented — furniture has an `angle`, a wall runs whichever way
// it was drawn — so this is the separating-axis test for two OBBs, and the
// answer we want from it is not "do they overlap" but "what is the shortest
// push that ends the overlap". That vector is the minimum-translation vector:
// the axis with the least overlap, signed away from the wall.
//
// Pure: boxes in, offset out. The tools apply it and own undo.

import { Vec } from '../model/schema';

/** A rectangle that knows which way it is facing. */
export interface Box {
  cx: number; cy: number;
  w: number; h: number;
  /** Degrees, clockwise, same convention as `Furniture.angle`. */
  angle: number;
}

/** The two edge directions of `b`, as unit vectors. */
function axes(b: Box): [Vec, Vec] {
  const r = b.angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [{ x: c, y: s }, { x: -s, y: c }];
}

/** Half-extent of `b` along `ax` — how far it reaches from its own centre. */
function reach(b: Box, ax: Vec): number {
  const [u, v] = axes(b);
  return Math.abs(u.x * ax.x + u.y * ax.y) * b.w / 2
       + Math.abs(v.x * ax.x + v.y * ax.y) * b.h / 2;
}

/**
 * The shortest move that takes `mover` clear of `fixed`, or null if it already
 * is.
 *
 * Four candidate axes — both edge directions of both boxes — because two
 * rectangles at an angle to each other can be separated along an edge of either
 * one, and the shortest way out is not always the mover's own. Testing only the
 * mover's axes gets a sofa out of a wall it is square to and quietly fails on a
 * wall drawn at 30°, which is exactly the case nobody checks.
 *
 * `gap` is extra clearance, in cm: 0 leaves the sofa touching the wall face,
 * which is where a sofa against a wall belongs.
 */
export function separation(mover: Box, fixed: Box, gap = 0): Vec | null {
  const cand = [...axes(mover), ...axes(fixed)];
  const dx = fixed.cx - mover.cx, dy = fixed.cy - mover.cy;

  let best: Vec | null = null, bestDepth = Infinity;
  for (const ax of cand) {
    const centres = Math.abs(dx * ax.x + dy * ax.y);
    const depth = reach(mover, ax) + reach(fixed, ax) + gap - centres;
    // One axis with clear air on it is a proof of separation, so stop.
    if (depth <= 0) return null;
    if (depth < bestDepth) {
      bestDepth = depth;
      // Away from the wall: the sign is taken from where the wall's centre is,
      // not from the axis's arbitrary direction.
      const away = (dx * ax.x + dy * ax.y) > 0 ? -1 : 1;
      best = { x: ax.x * away, y: ax.y * away };
    }
  }
  return best ? { x: best.x * bestDepth, y: best.y * bestDepth } : null;
}

/** A wall as a box: its centreline is the long axis, its thickness the short one. */
export function wallBox(a: Vec, b: Vec, thickness: number): Box | null {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (L < 1e-6) return null;
  return {
    cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
    w: L, h: thickness,
    angle: Math.atan2(dy, dx) * 180 / Math.PI,
  };
}

/**
 * Push `mover` out of every box in `fixed`, and return where it ends up.
 *
 * Iterated, because clearing one wall can push a piece into the next: in a
 * corner the first move slides it along one wall and straight into the other.
 * Each pass takes the single deepest overlap rather than summing all of them —
 * adding two corner pushes overshoots diagonally, past both walls and into the
 * room, and the piece jumps instead of sliding.
 *
 * It gives up after `passes` rather than looping: a piece wider than the gap
 * between two walls has nowhere legal to be, and the honest answer there is the
 * last position tried, not a hang. Callers get a position that may still
 * overlap in that case, which is correct — a 3 m sofa does not fit a 2 m alcove
 * and no amount of nudging will change that.
 */
/**
 * One offset that moves a whole group clear, without changing its shape.
 *
 * A selection is an arrangement — a sofa, a coffee table and a rug that were
 * placed relative to each other. Pushing each member out on its own is the
 * obvious implementation and it silently takes that apart: three pieces get
 * three different corrections and arrive spread out. So the group gets a single
 * translation and the relative layout survives by construction.
 *
 * Iterated, taking the deepest remaining overlap each pass, because one offset
 * can push a different member into something else. Taking the deepest *once* is
 * not enough and the failing case is not exotic: two pieces on opposite sides of
 * the same wall need pushes in opposite directions, and the larger one leaves
 * the other still buried.
 *
 * **A group straddling a wall has no solution** — no rigid translation clears
 * both sides — so this gives up after `passes` and returns the best offset it
 * reached rather than oscillating. Callers get a position that may still
 * overlap, which is the honest answer to an impossible request.
 */
export function groupPushOut(movers: Box[], fixed: Box[], gap = 0, passes = 6): Vec {
  const total = { x: 0, y: 0 };
  for (let i = 0; i < passes; i++) {
    let best: Vec | null = null, bestLen = 0;
    for (const m of movers) {
      const at = { ...m, cx: m.cx + total.x, cy: m.cy + total.y };
      for (const f of fixed) {
        const s = separation(at, f, gap);
        if (!s) continue;
        const len = Math.hypot(s.x, s.y);
        if (len > bestLen) { bestLen = len; best = s; }
      }
    }
    if (!best) break;
    total.x += best.x; total.y += best.y;
  }
  return total;
}

export function pushOut(mover: Box, fixed: Box[], gap = 0, passes = 6): Box {
  let cur = mover;
  for (let i = 0; i < passes; i++) {
    let worst: Vec | null = null, worstLen = 0;
    for (const f of fixed) {
      const s = separation(cur, f, gap);
      if (!s) continue;
      const len = Math.hypot(s.x, s.y);
      if (len > worstLen) { worstLen = len; worst = s; }
    }
    if (!worst) break;
    cur = { ...cur, cx: cur.cx + worst.x, cy: cur.cy + worst.y };
  }
  return cur;
}
