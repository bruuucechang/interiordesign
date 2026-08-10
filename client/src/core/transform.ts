// What a drag handle does to the object it is attached to.
//
// Split out of tools/select.ts for the same reason as arrange.ts: none of it
// can fail loudly. Anchor the resize on the wrong corner and the object still
// resizes, just from the wrong side; forget that furniture is stored axis-
// aligned with a separate angle and a rotated sofa grows along the screen axes
// instead of its own; drop the sign on a bulge and the wall curves the other
// way. All of it looks like a working drag until you know what it should have
// done.
//
// Pure: geometry in, new values out. The tool owns the pointer state, the
// document write and the undo entry.

import { Vec } from '../model/schema';
import { rotate, dist, angleDeg, snap, bulgeFrom } from './geometry';

/** Nothing usefully smaller than this — 10 cm is already a thin sliver on a plan. */
const MIN_SIZE = 10;

/** The corner diagonally opposite the one being dragged, in the box's own terms. */
export type Corner = 'nw' | 'ne' | 'se' | 'sw';

export interface Box { x: number; y: number; w: number; h: number; }

/**
 * A box resized by dragging `corner` to `q`.
 *
 * The opposite corner is the anchor and stays put. Taking min/abs rather than
 * `q - anchor` means dragging past the anchor flips the box instead of giving
 * it a negative width — a negative `w` draws nothing at all, and the object
 * simply disappears while the mouse is still down.
 */
export function resizeBox(g: Box, corner: Corner, q: Vec): Box {
  const anchor: Record<Corner, Vec> = {
    nw: { x: g.x + g.w, y: g.y + g.h },
    se: { x: g.x, y: g.y },
    ne: { x: g.x, y: g.y + g.h },
    sw: { x: g.x + g.w, y: g.y },
  };
  const f = anchor[corner];
  return {
    x: Math.min(f.x, q.x),
    y: Math.min(f.y, q.y),
    w: Math.max(MIN_SIZE, Math.abs(q.x - f.x)),
    h: Math.max(MIN_SIZE, Math.abs(q.y - f.y)),
  };
}

/**
 * Furniture resized by dragging a corner to `world`.
 *
 * Furniture is stored as an axis-aligned box plus an `angle`, so the pointer
 * has to be brought back into the object's own frame first — otherwise a sofa
 * turned 30° grows along the screen's axes and appears to shear. It resizes
 * about its centre (both sides move), which is why the half-extent is doubled.
 *
 * `grid` is the grid size, or 0 for no snapping. Snapping happens on the size,
 * not the pointer, so the result is a round number of centimetres.
 */
export function resizeFurniture(
  g: Box & { angle: number }, world: Vec, grid = 0,
): Box {
  const c = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
  const local = rotate(world, c, -g.angle);
  let w = Math.max(MIN_SIZE, Math.abs(local.x - c.x) * 2);
  let h = Math.max(MIN_SIZE, Math.abs(local.y - c.y) * 2);
  if (grid) {
    w = Math.max(MIN_SIZE, snap(w, grid));
    h = Math.max(MIN_SIZE, snap(h, grid));
  }
  return { w, h, x: c.x - w / 2, y: c.y - h / 2 };
}

/**
 * The bulge of a wall whose curve handle has been dragged to `world`.
 *
 * Rounded to the grid so arcs get tidy depths, and forced to exactly 0 within
 * one grid step so a wall the user meant to straighten really does become
 * straight. Without that last rule a wall left at a bulge of 0.4 renders as a
 * curve of one pixel: visually straight, but it is still an arc, and everything
 * downstream — room detection, the 3D sweep, DXF export — treats it as one.
 */
export function curveBulge(a: Vec, b: Vec, world: Vec, grid: number, snapEnabled: boolean): number {
  let bulge = bulgeFrom(a, b, world);
  if (snapEnabled) bulge = Math.round(bulge / grid) * grid;
  return Math.abs(bulge) < grid ? 0 : bulge;
}

/**
 * The angle for an object whose rotate handle has been dragged to `world`.
 *
 * The +90 is because the handle sticks out of the object's top, not its right,
 * so the raw pointer angle is a quarter turn behind what the object should read.
 *
 * Unmodified, it is magnetic to the four right angles — within 8° it snaps —
 * because "square to the wall" is the overwhelmingly common case and hitting it
 * by hand is fiddly. Shift gives fixed 15° steps instead, for everything else.
 */
export function rotateAngle(centre: Vec, world: Vec, shift: boolean): number {
  const ang = angleDeg(centre, world) + 90;
  if (shift) return Math.round(ang / 15) * 15;
  const near90 = Math.round(ang / 90) * 90;
  return Math.abs(ang - near90) <= 8 ? near90 : Math.round(ang);
}

/**
 * Where an opening's centre, width and angle land when one end is dragged.
 *
 * A door is stored by centre + width + angle, but it is dragged by its ends, so
 * the end that was *not* grabbed has to be reconstructed from the snapshot and
 * held fixed. Let it move and the door creeps along the wall while being
 * resized. `angle` is measured from the fixed end towards the dragged one so
 * that a door dragged past its own far end turns around rather than inverting
 * its width.
 *
 * This is only the geometry; the caller then refits the result onto its wall.
 */
export function openingEndpoint(
  g: { x: number; y: number; width: number; angle: number },
  end: 'a' | 'b',
  world: Vec,
): { centre: Vec; width: number; angle: number; fixed: Vec } {
  const c = { x: g.x, y: g.y };
  const half = g.width / 2;
  const fixed = rotate(
    end === 'a' ? { x: g.x + half, y: g.y } : { x: g.x - half, y: g.y },
    c, g.angle,
  );
  return {
    fixed,
    centre: { x: (fixed.x + world.x) / 2, y: (fixed.y + world.y) / 2 },
    width: Math.max(MIN_SIZE, dist(fixed, world)),
    angle: end === 'b' ? angleDeg(fixed, world) : angleDeg(world, fixed),
  };
}
