import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polygonArea, polygonSignedArea, pointInPolygon, distToSegment, alignWallEnd, nearestWallSnap, arcOpening } from '../src/core/geometry';

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

test('nearestWallSnap prefers a wall endpoint', () => {
  const walls = [{ id: 'w1', a: V(0, 0), b: V(100, 0) }];
  const s = nearestWallSnap(walls, V(3, 3), 10);
  assert.ok(s && s.kind === 'end');
  assert.deepEqual(s!.point, V(0, 0));
});

test('nearestWallSnap falls back to the segment for a mid-wall point', () => {
  const walls = [{ id: 'w1', a: V(0, 0), b: V(100, 0) }];
  const s = nearestWallSnap(walls, V(50, 4), 10);
  assert.ok(s && s.kind === 'seg');
  assert.deepEqual(s!.point, V(50, 0));
});

test('nearestWallSnap returns null beyond the radius', () => {
  const walls = [{ id: 'w1', a: V(0, 0), b: V(100, 0) }];
  assert.equal(nearestWallSnap(walls, V(50, 40), 10), null);
});

test('arcOpening fits a window onto a curved wall (bulged apex)', () => {
  // wall arc a=(0,0) apex bulge=+50 b=(200,0); control = mid + 2*bulge
  const a = V(0, 0), b = V(200, 0), c = V(100, 100);        // control for bulge 50
  const r = arcOpening(a, c, b, V(100, 50), 60);            // 60cm window near the apex
  assert.ok(r.width > 0 && r.width <= 60);
  assert.ok(Math.abs(r.bulge) > 0);                         // it curves
  assert.ok(r.dist < 5);                                    // cursor is on the arc
});
