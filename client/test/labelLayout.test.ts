import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutLabels, LABEL_PRIORITY as P, LabelBox } from '../src/core/labelLayout';

const box = (x: number, y: number, priority: number, w = 60, h = 18): LabelBox => ({ x, y, w, h, priority });
const kept = (ls: LabelBox[], view?: { w: number; h: number }) => [...layoutLabels(ls, view)].sort((a, b) => a - b);

test('labels that do not touch are all kept', () => {
  assert.deepEqual(kept([box(0, 0, P.wall), box(100, 0, P.wall), box(0, 40, P.furniture)]), [0, 1, 2]);
});

test('the higher-priority label wins, whatever order they came in', () => {
  // A wall length drawn first and the room's missing-items line on top of it —
  // the A1 bathroom case. The missing line stays, the length goes.
  assert.deepEqual(kept([box(0, 0, P.wall), box(20, 5, P.missing)]), [1]);
  assert.deepEqual(kept([box(20, 5, P.missing), box(0, 0, P.wall)]), [0]);
});

test('the spec order holds from top to bottom', () => {
  const order = [P.selected, P.roomName, P.missing, P.area, P.measure, P.furniture, P.wall];
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `priority ${i - 1} before ${i}`);
  // Everything stacked on one spot: only the best survives.
  const ls = [...order].reverse().map(p => box(0, 0, p));
  assert.deepEqual(kept(ls), [ls.length - 1]);
});

test('a dropped label does not block: the next one down can still take a free spot', () => {
  // name at 0..60; wall overlaps the name (dropped); furniture overlaps only the
  // dropped wall, not the name — it must be kept.
  const ls = [box(0, 0, P.roomName), box(50, 0, P.wall), box(70, 0, P.furniture)];
  assert.deepEqual(kept(ls), [0, 2]);
});

test('boxes that only touch are not overlapping (a room\'s stacked lines)', () => {
  assert.deepEqual(kept([box(0, 0, P.roomName), box(0, 18, P.missing), box(0, 36, P.area)]), [0, 1, 2]);
  assert.deepEqual(kept([box(0, 0, P.wall), box(60, 0, P.wall)]), [0, 1]);
});

test('touching holds in every direction, whichever box has the better priority', () => {
  // The better label below or to the right of the worse one — catches a `<=` on either side.
  assert.deepEqual(kept([box(0, 18, P.roomName), box(0, 0, P.wall)]), [0, 1]);
  assert.deepEqual(kept([box(60, 0, P.roomName), box(0, 0, P.wall)]), [0, 1]);
});

test('a room\'s lines that come back from world units a hair under 18 px apart are both kept', () => {
  // c.y ± 18/scale through toScreen gives 17.999999999999943, not 18 (B24 review).
  assert.deepEqual(kept([box(0, 0, P.roomName), box(0, 17.999999999999943, P.missing), box(0, 35.99999999999989, P.area)]), [0, 1, 2]);
  // Exactly half a pixel is the edge of the slack: still kept, from either side.
  for (const [better, worse] of [[box(0, 17.5, P.roomName), box(0, 0, P.wall)], [box(0, 0, P.roomName), box(0, 17.5, P.wall)],
    [box(59.5, 0, P.roomName), box(0, 0, P.wall)], [box(0, 0, P.roomName), box(59.5, 0, P.wall)]]) {
    assert.deepEqual(kept([better, worse]), [0, 1], JSON.stringify([better, worse]));
  }
  // A real overlap of a pixel still counts.
  assert.deepEqual(kept([box(0, 0, P.roomName), box(0, 17, P.missing)]), [0]);
});

test('ties keep input order, so the same plan always shows the same labels', () => {
  assert.deepEqual(kept([box(0, 0, P.wall), box(10, 0, P.wall)]), [0]);
  assert.deepEqual(kept([box(10, 0, P.wall), box(0, 0, P.wall)]), [0]);
});

test('zooming in spreads the boxes and the dropped label comes back', () => {
  // Two labels anchored 100 cm apart: at 0.4 px/cm they are 40 px apart (overlap),
  // at 1 px/cm 100 px apart (clear).
  const at = (scale: number) => [box(0, 0, P.area), box(100 * scale, 0, P.furniture)];
  assert.deepEqual(kept(at(0.4)), [0]);
  assert.deepEqual(kept(at(1)), [0, 1]);
});

test('labels entirely off screen take no room from visible ones', () => {
  const ls = [box(-200, 0, P.roomName), box(-30, 0, P.wall)];   // first off screen, second straddles the edge
  assert.deepEqual(kept(ls, { w: 800, h: 600 }), [1]);
  // Without a view both are just boxes that do not touch.
  assert.deepEqual(kept(ls), [0, 1]);
  // An off-screen higher label sitting on a visible one must not knock it out.
  assert.deepEqual(kept([box(-70, 0, P.roomName), box(-30, 0, P.wall)], { w: 800, h: 600 }), [1]);
});

import { fitsInside, fitsAlong, turnedExtent } from '../src/core/labelLayout';

test('a name is drawn only when it fits inside its piece on screen (B26)', () => {
  // A 45 cm nightstand at the A1 full view (0.5 px/cm) is 22 px: 「床頭櫃」 (≈ 45 px box) does not fit.
  assert.equal(fitsInside({ w: 45, h: 18 }, { w: 22.5, h: 21 }), false);
  // A 180 cm wardrobe at the same zoom: 90 × 30 px, fits.
  assert.equal(fitsInside({ w: 45, h: 18 }, { w: 90, h: 30 }), true);
  // Height counts too: a long low shelf.
  assert.equal(fitsInside({ w: 45, h: 18 }, { w: 200, h: 19 }), false);
  // The padding is the edge: exactly label + 2 fits, one under does not.
  assert.equal(fitsInside({ w: 45, h: 18 }, { w: 47, h: 20 }), true);
  assert.equal(fitsInside({ w: 45, h: 18 }, { w: 46.9, h: 20 }), false);
});

test('a wall carries its length only when it is longer than the label on screen', () => {
  assert.equal(fitsAlong(50, 32), false);   // 65 cm at 0.5 px/cm
  assert.equal(fitsAlong(50, 81), true);    // 65 cm zoomed to 1.25
  assert.equal(fitsAlong(50, 62), true);    // exactly label + margin
  assert.equal(fitsAlong(50, 61.9), false);
});

test('a turned piece is measured along the screen axes', () => {
  const e = turnedExtent(200, 60, 90);
  assert.ok(Math.abs(e.w - 60) < 1e-9 && Math.abs(e.h - 200) < 1e-9);
  const f = turnedExtent(200, 60, 0);
  assert.ok(Math.abs(f.w - 200) < 1e-9 && Math.abs(f.h - 60) < 1e-9);
  const g = turnedExtent(100, 100, 45);
  assert.ok(Math.abs(g.w - 141.42) < 0.01);
  // How the renderer uses it: the label turned into the piece's frame. A 200×15
  // shelf at 45° cannot carry a 30×18 label even though its bounding box could.
  assert.equal(fitsInside(turnedExtent(30, 18, 45), { w: 200, h: 15 }), false);
  assert.equal(fitsInside(turnedExtent(30, 18, 0), { w: 200, h: 40 }), true);
  assert.equal(fitsInside(turnedExtent(30, 18, 90), { w: 40, h: 200 }), true);   // a tall cabinet turned on its side
});
