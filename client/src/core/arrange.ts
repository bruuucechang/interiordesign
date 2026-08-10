// Moving, copying, aligning and distributing objects.
//
// Split out of editor.ts because every one of these fails quietly. An object
// kind the offset does not know how to move simply stays where it was; a sign
// the wrong way round moves things the wrong way; a duplicated group that keeps
// its old group id drags the original along the next time you move the copy.
// None of it throws, and on a plan with a dozen objects none of it is obvious.
//
// Everything here is pure: objects in, new objects out. The editor applies them
// to the document and owns the undo entry.

import { Obj, Vec } from '../model/schema';
import { bounds, Bounds } from './hit';

export type Edge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type Axis = 'h' | 'v';

/** A changed object, ready to be written back under its own id. */
export interface Move { id: string; obj: Obj; }

const copy = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/**
 * The same object, moved by (dx, dy).
 *
 * Three shapes have to be handled and they are not exclusive: walls, beams and
 * dimensions carry `a`/`b`; rooms, furniture, openings, images and fittings
 * carry `x`/`y`; and a room drawn as a polygon carries `poly` *as well as* the
 * bounding `x`/`y` its handles use. Miss the polygon and the room's outline
 * stays behind while its label walks away.
 *
 * Moving an auto-detected room detaches it, which is the same rule the editor
 * uses when one is renamed: it has stopped tracking the walls that made it.
 */
export function offsetObject(o: Obj, dx: number, dy: number): Obj {
  const c = copy(o) as any;
  if (c.kind === 'room' && c.poly) {
    c.poly = c.poly.map((p: Vec) => ({ x: p.x + dx, y: p.y + dy }));
    c.auto = false;
  }
  if ('x' in c) { c.x += dx; c.y += dy; }
  if ('a' in c) {
    c.a = { x: c.a.x + dx, y: c.a.y + dy };
    c.b = { x: c.b.x + dx, y: c.b.y + dy };
  }
  return c as Obj;
}

/**
 * Copies of `objs`, offset, with fresh ids.
 *
 * Group ids are remapped rather than copied, and remapped *consistently*: two
 * objects that were in one group stay in one group, and it is a new one. Keep
 * the old id and moving the copy drags the original with it; give each object
 * its own new id and the copied group falls apart.
 */
export function cloneWithOffset(
  objs: Obj[], dx: number, dy: number, newId: (kind: string) => string,
): Obj[] {
  const remap = new Map<string, string>();
  return objs.map((o) => {
    const c = copy(o) as any;
    c.id = newId(o.kind);
    if (c.group) {
      if (!remap.has(c.group)) remap.set(c.group, newId('grp'));
      c.group = remap.get(c.group);
    }
    return offsetObject(c as Obj, dx, dy);
  });
}

/**
 * Where each object lands when aligned to `edge` of the selection as a whole.
 *
 * Objects already on the edge are left out of the result — the editor turns
 * each entry into a document write, and rewriting an object to its current
 * position would put an undo step on the stack that undoes nothing visible.
 */
export function alignMoves(objs: Obj[], edge: Edge): Move[] {
  if (objs.length < 2) return [];              // aligning one thing to itself

  const bs = objs.map(bounds);
  const minX = Math.min(...bs.map((b) => b.x));
  const maxX = Math.max(...bs.map((b) => b.x + b.w));
  const minY = Math.min(...bs.map((b) => b.y));
  const maxY = Math.max(...bs.map((b) => b.y + b.h));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

  const out: Move[] = [];
  objs.forEach((o, i) => {
    const b = bs[i];
    let dx = 0, dy = 0;
    if (edge === 'left') dx = minX - b.x;
    else if (edge === 'right') dx = maxX - (b.x + b.w);
    else if (edge === 'hcenter') dx = cx - (b.x + b.w / 2);
    else if (edge === 'top') dy = minY - b.y;
    else if (edge === 'bottom') dy = maxY - (b.y + b.h);
    else if (edge === 'vcenter') dy = cy - (b.y + b.h / 2);
    if (dx || dy) out.push({ id: o.id, obj: offsetObject(o, dx, dy) });
  });
  return out;
}

/**
 * Where each object lands when spread evenly between the outermost two.
 *
 * Spacing is by centre, not by gap, so objects of different sizes end up on an
 * even rhythm rather than with even air between them — that is what "distribute"
 * means on a plan, where the things being spread are rarely the same width.
 * The two on the ends define the span and never move.
 */
export function distributeMoves(objs: Obj[], axis: Axis): Move[] {
  if (objs.length < 3) return [];              // two objects are already even

  const centre = axis === 'h'
    ? (b: Bounds) => b.x + b.w / 2
    : (b: Bounds) => b.y + b.h / 2;

  const items = objs.map((o) => ({ o, c: centre(bounds(o)) }))
    .sort((a, z) => a.c - z.c);
  const first = items[0].c, last = items[items.length - 1].c;
  const step = (last - first) / (items.length - 1);

  const out: Move[] = [];
  items.forEach((it, i) => {
    const d = (first + step * i) - it.c;
    if (!d) return;
    out.push({
      id: it.o.id,
      obj: offsetObject(it.o, axis === 'h' ? d : 0, axis === 'h' ? 0 : d),
    });
  });
  return out;
}
