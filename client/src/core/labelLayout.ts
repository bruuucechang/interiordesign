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

/**
 * Half a pixel of slack. A room's lines are placed in world units and come back
 * to the screen as 17.999999999999943 px apart, not 18 — without it a strict
 * comparison calls them overlapping and a room loses its 缺 or area line at
 * about four zoom levels in ten (B24 review).
 */
const EPS = 0.5;
const overlaps = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

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

// Whether a label has earned a place at all (B26), before the overlap pass.
// A piece's name belongs inside the piece and a wall's length along the wall:
// once zooming out shrinks the thing smaller than its own label, the label is
// covering other things rather than naming this one. Zoom in and it qualifies
// again. A selected object's labels skip this — selecting is asking.

/** Does a `label`-sized box fit inside `box` (both screen px), with `pad` to spare? */
export function fitsInside(label: { w: number; h: number }, box: { w: number; h: number }, pad = 2): boolean {
  return label.w + pad <= box.w && label.h + pad <= box.h;
}

/** Is a segment `segPx` long on screen long enough to carry a `labelW` label with `margin` to spare? */
export function fitsAlong(labelW: number, segPx: number, margin = 12): boolean {
  return segPx >= labelW + margin;
}

/** The screen-axis extent of a `w × h` rectangle turned by `deg`. */
export function turnedExtent(w: number, h: number, deg: number): { w: number; h: number } {
  const r = deg * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { w: w * c + h * s, h: w * s + h * c };
}
