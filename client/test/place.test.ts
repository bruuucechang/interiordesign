import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitOpeningToWall } from '../src/tools/place';

// A curved wall (bulged quadratic). When a window on it is widened, the resize
// code fits using the chord midpoint, which sits off the arc by the sagitta —
// so the snap threshold has to scale with the width, or the widened window stops
// following the curve. (Regression for "窗戶拉長後無法吸附在曲線牆上".)
const curvedWall = { id: 'w', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 12, bulge: 150 } as any;
const doc = { objects: [curvedWall], isLayerVisible: () => true } as any;

test('a wide window fit onto a curved wall keeps a fixed 100cm threshold from snapping', () => {
  // chord midpoint of a wide window sits far off the strongly-curved arc
  const tight = fitOpeningToWall(doc, { x: 200, y: 0 }, 340, true, 100);
  assert.equal(tight, null);   // the old fixed threshold loses the wall — the bug
});

test('scaling the threshold with the width keeps a widened window curved', () => {
  const width = 340;
  const fit = fitOpeningToWall(doc, { x: 200, y: 0 }, width, true, Math.max(120, width));
  assert.ok(fit, 'a wall is found');
  assert.notEqual(fit!.bulge, 0, 'the window stays curved (bulge preserved)');
});
