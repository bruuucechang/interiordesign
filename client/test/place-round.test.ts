import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placePoint } from '../src/tools/draw';
import { SnapResult } from '../src/core/snap';

const V = (x: number, y: number) => ({ x, y });
const snap = (kind: SnapResult['kind'], point = V(0, 0)): SnapResult => ({ point, kind, guides: [] });

// Rounding placed endpoints to the nearest cm keeps a "10.00 m" wall from
// secretly being 10.0015 m (which bloats a 10×10 room to 100.03 m²).
test('a free endpoint is rounded to the nearest cm', () => {
  assert.deepEqual(placePoint(V(1000.15, -3.4), null), V(1000, -3));
  assert.deepEqual(placePoint(V(999.5, 0.5), null), V(1000, 1));   // .5 rounds up
});

test('four rounded 10 m sides enclose exactly 100.00 m²', () => {
  const c = [V(0, 0), V(1000.15, 0.1), V(1000.2, 1000.15), V(-0.1, 999.9)]
    .map(p => placePoint(p, null));
  // shoelace on the cleaned corners
  let a = 0;
  for (let i = 0; i < c.length; i++) { const j = (i + 1) % c.length; a += c[i].x * c[j].y - c[j].x * c[i].y; }
  assert.equal(Math.abs(a) / 2, 1_000_000);   // cm² == 100.00 m²
});

test('an exact endpoint join is left untouched so rooms still close', () => {
  const node = V(1000.15, 500.15);                 // an existing (possibly legacy) node
  assert.deepEqual(placePoint(node, snap('end', node)), node);
});

test('mid / seg / align snaps are still rounded', () => {
  assert.deepEqual(placePoint(V(500.4, 0.6), snap('mid')), V(500, 1));
  assert.deepEqual(placePoint(V(30.7, 0.2), snap('seg')), V(31, 0));
  assert.deepEqual(placePoint(V(100.15, 200.8), snap('align')), V(100, 201));
});
