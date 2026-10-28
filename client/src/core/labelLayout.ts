// Which plan labels get drawn when they would land on top of each other (B24).
//
// Every label on the 2D plan is a small dark box with text in it, placed at a
// fixed point of the thing it names: a wall's length at its midpoint, a room's
// name at its centroid, a piece of furniture's name at its centre. Zoomed out,
// or in a small room, those boxes pile up — on the A1 plan the bathroom's
// 「缺：排風扇」 sat right across a wall's 「7.94 m」, and neither could be read.
//
// Labels are never moved: a length that drifts off its wall is worse than one
// that is missing, because it reads as belonging to the wrong wall. Instead,
// the most useful label wins its spot and anything lower that would overlap it
// is left out for this frame. Zoom in and the boxes spread apart, so the
// dropped ones come back on their own.

/** Lower draws first and wins. The order is the spec's (B24 §4.3). */
export const LABEL_PRIORITY = {
  selected: 0,
  roomName: 1,
  missing: 2,
  area: 3,
  measure: 4,     // door/window side lengths and drawn dimensions
  furniture: 5,
  wall: 6,
} as const;

export interface LabelBox {
  /** Screen px, top-left corner. */
  x: number; y: number; w: number; h: number;
  priority: number;
}

const overlaps = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Indices of the labels to draw: greedily, best priority first, each kept only
 * if it overlaps nothing already kept. Ties keep their input order, so the same
 * plan always shows the same labels. Boxes that only touch do not overlap — a
 * room's three stacked lines are exactly one box-height apart.
 *
 * A label entirely outside `view` is dropped without taking up room: it would
 * not be seen, and must not knock out a visible one at the edge.
 */
export function layoutLabels(labels: readonly LabelBox[], view?: { w: number; h: number }): Set<number> {
  const order = labels.map((_, i) => i)
    .filter(i => !view || overlaps(labels[i], { x: 0, y: 0, w: view.w, h: view.h, priority: 0 }))
    .sort((a, b) => labels[a].priority - labels[b].priority || a - b);
  const kept: LabelBox[] = [];
  const out = new Set<number>();
  for (const i of order) {
    const box = labels[i];
    if (kept.some(k => overlaps(k, box))) continue;
    kept.push(box);
    out.add(i);
  }
  return out;
}
