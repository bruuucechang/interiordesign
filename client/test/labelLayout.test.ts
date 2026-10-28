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
