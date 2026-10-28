// What is wrong with putting a piece of furniture here (B22, docs/spec-game-polish.md §2).
//
// Pure: plan objects and a footprint in, reasons out. The tools turn the preview
// red and show the first reason; they still place it — the user's call was
// "warn, don't block", because a design is often roughed in first and tidied after.
//
// Walls are not checked here: the furniture tool already pushes every footprint
// clear of straight walls (`keepOutOfWalls`) before it gets this far.
import type { Obj, Vec } from '../model/schema';
import { Box, separation } from './clearance';
import { pointInPolygon } from './geometry';
import { t } from './i18n';

/** Overlap shallower than this, cm, is two things touching, not one inside the other. */
export const OVERLAP_TOL = 5;

/** What the piece is, as far as stacking goes. */
export interface Stackable { mount?: string; height?: number }

/**
 * Things that are meant to share floor area with other things and so neither
 * collide nor get collided with: rugs and mats (≤ 5 cm tall), and anything hung
 * from the ceiling or on a wall.
 */
export const stacksFreely = (it: Stackable | undefined) =>
  !!it && (it.mount === 'ceiling' || it.mount === 'wall' || (it.height ?? 999) <= 5);

const roomPoly = (r: Extract<Obj, { kind: 'room' }>): Vec[] =>
  r.poly?.length ? r.poly : [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

/**
 * Reasons, most useful first. `item` is the piece being placed; `itemOf` looks
 * up the catalogue entry of a furniture object already on the plan; `self` is
 * left out (a piece being moved does not overlap itself).
 */
export function placementIssues(
  objs: readonly Obj[], box: Box, item: Stackable | undefined,
  itemOf: (o: Extract<Obj, { kind: 'furniture' }>) => Stackable | undefined, self?: string,
): string[] {
  const out: string[] = [];
  if (!stacksFreely(item)) {
    for (const o of objs) {
      if (o.kind !== 'furniture' || o.id === self || stacksFreely(itemOf(o))) continue;
      const other: Box = { cx: o.x + o.w / 2, cy: o.y + o.h / 2, w: o.w, h: o.h, angle: o.angle ?? 0 };
      if (separation(box, other, -OVERLAP_TOL)) {
        out.push(t('跟{name}重疊').replace('{name}', () => o.label || t('別的家具')));
        break;
      }
    }
  }
  const rooms = objs.filter((o): o is Extract<Obj, { kind: 'room' }> => o.kind === 'room');
  if (rooms.length && !rooms.some(r => pointInPolygon({ x: box.cx, y: box.cy }, roomPoly(r)))) {
    out.push(t('不在任何房間裡'));
  }
  return out;
}

/** How far `p` is from the nearest wall's centre line, cm (Infinity with no walls). Curved walls by their chord. */
export function nearestWallDistance(objs: readonly Obj[], p: Vec): number {
  let best = Infinity;
  for (const o of objs) {
    if (o.kind !== 'wall') continue;
    const wx = o.b.x - o.a.x, wy = o.b.y - o.a.y, l2 = wx * wx + wy * wy;
    const k = l2 ? Math.max(0, Math.min(1, ((p.x - o.a.x) * wx + (p.y - o.a.y) * wy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - o.a.x - wx * k, p.y - o.a.y - wy * k));
  }
  return best;
}
