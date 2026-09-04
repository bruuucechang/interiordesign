// Editing walls as walls, rather than as two points that happen to be thick.
//
// A wall on a plan is a solid with two faces, and every one of these operations
// is about a face rather than the centreline the file actually stores. That gap
// is where the mistakes live, and they are all quiet ones: an offset applied to
// the wrong side puts the wall half a thickness into the room and the drawing
// still looks like a drawing; an alignment that silently drops the walls it
// could not handle leaves a jog exactly where you thought you had removed one.
//
// Pure: walls in, new walls or moves out. The tools apply them and own undo.

import { Obj, Vec } from '../model/schema';

export type Wall = Extract<Obj, { kind: 'wall' }>;

/** Which line of the wall the numbers refer to. */
export type Reference = 'center' | 'left' | 'right';

/** A changed wall, ready to be written back under its own id. */
export interface WallMove { id: string; a: Vec; b: Vec; }

/** Unit normal to the left of a→b. Same convention as geometry.ts. */
function leftNormal(a: Vec, b: Vec): Vec {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  return { x: -dy / L, y: dx / L };
}

/**
 * Where the centreline goes when the line you drew was a face.
 *
 * On site nobody measures to the middle of a wall — the tape goes against a
 * face, usually the inside of the room. Drawing that measurement as a
 * centreline puts every wall half a thickness out, which on a 12 cm wall is
 * 6 cm per wall and a room that comes out 12 cm too big in each direction. The
 * plan looks perfectly correct; it is just not the building.
 *
 * `left` and `right` are relative to the direction of travel, which is the only
 * thing that is defined for a single segment — a lone wall has no inside.
 */
export function referenceShift(ref: Reference, thickness: number): number {
  if (ref === 'center') return 0;
  return ref === 'left' ? thickness / 2 : -thickness / 2;
}

/** The centreline for a segment drawn against `ref`. */
export function applyReference(a: Vec, b: Vec, ref: Reference, thickness: number): { a: Vec; b: Vec } {
  const d = referenceShift(ref, thickness);
  if (!d) return { a, b };
  const n = leftNormal(a, b);
  return {
    a: { x: a.x - n.x * d, y: a.y - n.y * d },
    b: { x: b.x - n.x * d, y: b.y - n.y * d },
  };
}

/**
 * Split a wall at `atCm` from its `a` end.
 *
 * Returns null when the split would leave a stub shorter than `min`, and — the
 * part worth stating — when the wall is curved. Splitting an arc means
 * splitting the Bézier and deriving two new bulges; doing it by chopping the
 * chord instead produces two straight walls where an arc was, and the only
 * sign is that the drawing quietly loses its curve. Refusing is the honest
 * answer until the arc case is actually implemented.
 */
export function splitWallAt(
  w: Wall, atCm: number, min = 1,
): [Wall, Wall] | null {
  if (w.bulge) return null;
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
  const L = Math.hypot(dx, dy);
  if (atCm < min || atCm > L - min) return null;

  const t = atCm / L;
  const mid = { x: w.a.x + dx * t, y: w.a.y + dy * t };
  // Both halves keep every other property — thickness, height, finish, layer —
  // because a split is one wall becoming two, not two new walls appearing.
  return [
    { ...w, b: mid },
    { ...w, id: '', a: mid },   // the caller gives the second half a fresh id
  ];
}

/** How far apart two directions are, in degrees, ignoring which way round. */
function angleBetween(a: Vec, b: Vec, c: Vec, d: Vec): number {
  const t1 = Math.atan2(b.y - a.y, b.x - a.x);
  const t2 = Math.atan2(d.y - c.y, d.x - c.x);
  let deg = Math.abs((t1 - t2) * 180 / Math.PI) % 180;
  if (deg > 90) deg = 180 - deg;
  return deg;
}

export interface AlignResult {
  moves: WallMove[];
  /** Walls left alone because they are not parallel to the reference wall. */
  skipped: string[];
}

/**
 * Bring the chosen face of every selected wall onto one line.
 *
 * The longest wall in the selection is the reference and does not move. That is
 * a choice, and it is the predictable one: on a real plan the long run is the
 * wall that is right and the short jogs are the ones that drifted, and a rule
 * like "align to the average" moves everything including the piece you were
 * sure about.
 *
 * Walls more than `tolDeg` off the reference direction are returned in
 * `skipped` rather than being moved onto a line they were never on. Silently
 * leaving them out is worse than either moving or refusing: the selection would
 * come back looking aligned everywhere the eye happens to check.
 */
export function alignWalls(walls: Wall[], ref: Reference, tolDeg = 5): AlignResult {
  const straight = walls.filter((w) => !w.bulge);
  if (straight.length < 2) return { moves: [], skipped: [] };

  const len = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  const base = straight.reduce((a, b) => (len(b) > len(a) ? b : a));
  const n = leftNormal(base.a, base.b);

  // Signed distance from the reference wall's own line, measured along its
  // normal, of the face being aligned.
  const face = (w: Wall) => {
    const d = referenceShift(ref, w.thickness);
    const mx = (w.a.x + w.b.x) / 2 - base.a.x;
    const my = (w.a.y + w.b.y) / 2 - base.a.y;
    return (mx * n.x + my * n.y) + d;
  };
  const target = face(base);

  const moves: WallMove[] = [];
  const skipped: string[] = [];
  for (const w of straight) {
    if (w.id === base.id) continue;
    if (angleBetween(base.a, base.b, w.a, w.b) > tolDeg) { skipped.push(w.id); continue; }
    const shift = target - face(w);
    if (Math.abs(shift) < 1e-9) continue;
    moves.push({
      id: w.id,
      a: { x: w.a.x + n.x * shift, y: w.a.y + n.y * shift },
      b: { x: w.b.x + n.x * shift, y: w.b.y + n.y * shift },
    });
  }
  // Curved walls were never candidates; say so rather than dropping them.
  for (const w of walls) if (w.bulge) skipped.push(w.id);
  return { moves, skipped };
}
