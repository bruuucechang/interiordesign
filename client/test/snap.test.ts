import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSnap, WallSeg } from '../src/core/snap';

const V = (x: number, y: number) => ({ x, y });
// One horizontal wall from (0,0) to (100,0): endpoints, midpoint (50,0), face along y=0.
const WALL: WallSeg[] = [{ id: 'w1', a: V(0, 0), b: V(100, 0) }];
const R = 14;   // world-cm radius

test('endpoint wins when the cursor is near a wall end', () => {
  const s = computeSnap(WALL, V(3, 4), R);
  assert.equal(s?.kind, 'end');
  assert.deepEqual(s?.point, V(0, 0));
});

test('midpoint snaps to the chord centre', () => {
  const s = computeSnap(WALL, V(52, 3), R);
  assert.equal(s?.kind, 'mid');
  assert.deepEqual(s?.point, V(50, 0));
});

test('a nearby endpoint beats an even-nearer face (bias)', () => {
  // cursor 2cm past the end along the wall: face dist ~0, endpoint dist ~2, but the
  // endpoint bias (0.45*14=6.3) keeps the intentful endpoint pick.
  const s = computeSnap(WALL, V(2, 0.5), R);
  assert.equal(s?.kind, 'end');
  assert.deepEqual(s?.point, V(0, 0));
});

test('a wall face snaps when no end/mid is in range', () => {
  const s = computeSnap(WALL, V(30, 5), R);
  assert.equal(s?.kind, 'seg');
  assert.deepEqual(s?.point, V(30, 0));
});

test('vertical alignment locks x to an endpoint and returns a guide', () => {
  const s = computeSnap(WALL, V(101, 200), R);   // lines up under the (100,0) end
  assert.equal(s?.kind, 'align');
  assert.equal(s?.point.x, 100);
  assert.equal(s?.point.y, 200);                 // free axis untouched
  assert.equal(s?.guides.length, 1);
});

test('horizontal alignment locks y to an endpoint', () => {
  const s = computeSnap(WALL, V(500, 3), R);     // level with y=0, far along x
  assert.equal(s?.kind, 'align');
  assert.equal(s?.point.y, 0);
  assert.equal(s?.point.x, 500);
});

test('two crossing alignments snap to their intersection with two guides', () => {
  // (0,0) gives a vertical guide (x=0); a second wall endpoint at (0,300) via y.
  const walls: WallSeg[] = [
    { id: 'w1', a: V(0, 0), b: V(100, 0) },
    { id: 'w2', a: V(400, 300), b: V(600, 300) },
  ];
  const s = computeSnap(walls, V(4, 296), R);
  assert.equal(s?.kind, 'align');
  assert.deepEqual(s?.point, V(0, 300));
  assert.equal(s?.guides.length, 2);
});

test('excludeId ignores the wall being edited', () => {
  const s = computeSnap(WALL, V(3, 4), R, { excludeId: 'w1' });
  assert.equal(s, null);
});

test('nothing within radius returns null', () => {
  assert.equal(computeSnap(WALL, V(300, 300), R), null);
});

test('midpoints can be disabled', () => {
  const s = computeSnap(WALL, V(50, 3), R, { midpoints: false });
  assert.equal(s?.kind, 'seg');                  // falls through to the face
});
