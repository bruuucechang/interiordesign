// What is wrong with putting a piece of furniture here (B22, docs/spec-game-polish.md §2).
//
// Pure: plan objects and a footprint in, reasons out. The tools turn the preview
// red and show the first reason; they still place it — the user's call was
// "warn, don't block", because a design is often roughed in first and tidied after.
//
// Walls are checked when the caller passes them: the 2D tool pushes footprints out
// of straight walls first, but a piece wider than the alcove it is pushed into
// stays in, and the 3D view's floor click does not push at all.
import type { Obj, Vec } from '../model/schema';
import { Box, separation } from './clearance';
import { pointInPolygon } from './geometry';
import { t } from './i18n';

/** Overlap shallower than this, cm, is two things touching, not one inside the other. */
export const OVERLAP_TOL = 5;

/** Wall intrusion deeper than this, cm, is "in the wall"; touching the face is not. */
export const WALL_TOL = 3;
/** Footprints smaller than this, cm², are things that sit on other things (a lamp, a microwave, a vase). */
export const SMALL_PIECE = 50 * 50;

/** What the piece is, as far as stacking goes — a catalogue entry has all of these. */
export interface Stackable { name?: string; w?: number; h?: number; mount?: string; height?: number; floorCover?: true }

/**
 * Things that are meant to share floor area with other things and so neither
 * collide nor get collided with: rugs, mats and platforms (`floorCover`, or
 * ≤ 5 cm tall), anything hung from the ceiling or on a wall, and small pieces
 * that stand on a counter or a cabinet.
 */
export const stacksFreely = (it: Stackable | undefined) =>
  !!it && (it.mount === 'ceiling' || it.mount === 'wall' || !!it.floorCover || (it.height ?? 999) <= 5
    || (it.w !== undefined && it.h !== undefined && it.w * it.h < SMALL_PIECE));

const SEAT = /椅|凳/, NOT_SEAT = /沙發|貴妃椅|躺椅/, TABLE = /桌|几|檯|吧台|中島/;
const isSeat = (it?: Stackable) => !!it?.name && SEAT.test(it.name) && !NOT_SEAT.test(it.name);
const isTable = (it?: Stackable) => !!it?.name && TABLE.test(it.name) && !SEAT.test(it.name);
/** A chair pushed in under a table or desk is how a dining set is drawn, not an overlap. */
export const tucksUnder = (a?: Stackable, b?: Stackable) => (isSeat(a) && isTable(b)) || (isSeat(b) && isTable(a));

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
  walls: readonly Box[] = [],
): string[] {
  const out: string[] = [];
  if (item?.mount !== 'wall' && item?.mount !== 'ceiling' && walls.some(w => separation(box, w, -WALL_TOL))) {
    out.push(t('卡進牆裡'));
  }
  if (!stacksFreely(item)) {
    for (const o of objs) {
      if (o.kind !== 'furniture' || o.id === self) continue;
      const cat = itemOf(o), it = cat && { ...cat, w: o.w, h: o.h };   // as resized on the plan
      if (stacksFreely(it) || tucksUnder(item, it)) continue;
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
