import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitOpeningToWall } from '../src/tools/place';

// A strongly curved wall (bulged quadratic) from (0,0) to (400,0).
// Regression for "窗戶依然有長度/弧度上的限制…無法再拉伸以及無法貼合": resizing a
// window passes the span (fixed end + dragged end) so it is fit *between* those
// points along the arc, instead of centring on the chord midpoint and walking
// width/2 of arc-length (which shrank the window and capped it early).
const curvedWall = { id: 'w', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 12, bulge: 150 } as any;
const doc = { objects: [curvedWall], isLayerVisible: () => true } as any;

test('span fit keeps a widened window curved and glued to the wall', () => {
  const fit = fitOpeningToWall(doc, { x: 200, y: 75 }, 400, true, 400, { p0: { x: 0, y: 0 }, p1: { x: 400, y: 0 } });
  assert.ok(fit, 'the curved wall is found');
  assert.notEqual(fit!.bulge, 0, 'the window stays curved');
});

test('span fit anchors on the fixed endpoint so it always snaps, even with a tiny threshold', () => {
  // the fixed end (0,0) lies on the arc → its distance is ~0, so the wall is found
  const fit = fitOpeningToWall(doc, { x: 200, y: 0 }, 500, true, 5, { p0: { x: 0, y: 0 }, p1: { x: 500, y: 0 } });
  assert.ok(fit, 'a tiny threshold still snaps because the anchor sits on the arc');
});

test('a window can be stretched to the full curved-wall extent', () => {
  // drag well past the right end — it clamps to the wall, not to some earlier cap
  const fit = fitOpeningToWall(doc, { x: 250, y: 40 }, 600, true, 600, { p0: { x: 0, y: 0 }, p1: { x: 600, y: 0 } });
  assert.ok(fit);
  assert.ok(fit!.width > 350, `spans most of the 400cm-chord wall, got ${Math.round(fit!.width)}`);
});
