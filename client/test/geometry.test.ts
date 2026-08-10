import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polygonArea, polygonSignedArea, pointInPolygon, distToSegment, alignWallEnd, arcOpening, fmtLen, fmtArea } from '../src/core/geometry';

const V = (x: number, y: number) => ({ x, y });
const SQ = [V(0, 0), V(100, 0), V(100, 100), V(0, 100)];

test('polygonArea of a 100×100 square = 10000', () => {
  assert.equal(polygonArea(SQ), 10000);
});

test('polygonSignedArea flips sign with winding, same magnitude', () => {
  const a = polygonSignedArea(SQ), b = polygonSignedArea([...SQ].reverse());
  assert.equal(Math.abs(a), 10000);
  assert.equal(a, -b);                               // reversing winding negates it
});

test('pointInPolygon inside vs outside', () => {
  assert.ok(pointInPolygon(V(50, 50), SQ));
  assert.ok(!pointInPolygon(V(150, 50), SQ));
  assert.ok(!pointInPolygon(V(-1, 50), SQ));
});

test('distToSegment: perpendicular distance and clamped endpoints', () => {
  assert.equal(distToSegment(V(50, 10), V(0, 0), V(100, 0)), 10);
  assert.equal(distToSegment(V(-30, 0), V(0, 0), V(100, 0)), 30);   // clamps to endpoint
});

test('alignWallEnd snaps a near-horizontal wall flat', () => {
  const e = alignWallEnd(V(0, 0), V(300, 12), 10, false);   // ~2.3° off
  assert.equal(e.y, 0);
});

test('alignWallEnd leaves a clearly diagonal wall free', () => {
  const t = V(300, 200);                                    // ~34°, well past the 8° tolerance
  assert.deepEqual(alignWallEnd(V(0, 0), t, 10, false), t);
});

test('alignWallEnd with Shift forces the nearest 45° diagonal', () => {
  const e = alignWallEnd(V(0, 0), V(300, 200), 10, true);   // ~34° -> nearest step is 45°
  assert.equal(e.x, e.y);                                   // equal legs = 45° diagonal
  assert.equal(e.x, 250);                                   // snapped to grid
});

test('arcOpening fits a window onto a curved wall (bulged apex)', () => {
  // wall arc a=(0,0) apex bulge=+50 b=(200,0); control = mid + 2*bulge
  const a = V(0, 0), b = V(200, 0), c = V(100, 100);        // control for bulge 50
  const r = arcOpening(a, c, b, V(100, 50), 60);            // 60cm window near the apex
  assert.ok(r.width > 0 && r.width <= 60);
  assert.ok(Math.abs(r.bulge) > 0);                         // it curves
  assert.ok(r.dist < 5);                                    // cursor is on the arc
});

// ---------------------------------------------------------------- 畫布上的標示

test('畫布標示逐值挑單位——短的用公分，長的用公尺', () => {
  // 跟屬性面板的切換不同：一道 4 m 的牆旁邊有個 5 cm 的縫，兩者要同時讀得懂。
  assert.equal(fmtLen(5), '5 cm');
  assert.equal(fmtLen(420), '4.20 m');
});

test('切換點在 100 cm，兩側都要對', () => {
  assert.equal(fmtLen(99.4), '99 cm');
  assert.equal(fmtLen(100), '1.00 m');
});

test('負值看的是絕對值', () => {
  assert.equal(fmtLen(-250), '-2.50 m');
  assert.equal(fmtLen(-50), '-50 cm');
});

test('面積標示一律 m²，不跟著長度那套走', () => {
  assert.equal(fmtArea(10000), '1.00 m²');
  assert.equal(fmtArea(500), '0.05 m²');
});
