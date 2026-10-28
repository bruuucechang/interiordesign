import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placementIssues, nearestWallDistance, stacksFreely } from '../src/core/placement';
import type { Obj } from '../src/model/schema';

const furn = (id: string, x: number, y: number, w: number, h: number, item = 'bed', label = '雙人床'): Obj =>
  ({ id, kind: 'furniture', layer: 'furniture', item, x, y, w, h, angle: 0, label } as Obj);
const room = (x: number, y: number, w: number, h: number): Obj =>
  ({ id: 'r' + x, kind: 'room', layer: 'rooms', x, y, w, h, name: '房間' } as Obj);
const CAT: Record<string, { mount?: string; height?: number }> = { bed: { height: 45 }, rug: { height: 1 }, lamp: { mount: 'ceiling' } };
const itemOf = (o: Extract<Obj, { kind: 'furniture' }>) => CAT[o.item];
const bed = { height: 45 };
const box = (cx: number, cy: number, w = 160, h = 200) => ({ cx, cy, w, h, angle: 0 });

test('a bed dropped onto another bed says which one it overlaps', () => {
  const objs = [room(0, 0, 500, 400), furn('b', 0, 0, 160, 200)];
  const r = placementIssues(objs, box(120, 100), bed, itemOf);
  assert.equal(r.length, 1);
  assert.match(r[0], /雙人床/);
});

test('touching or overlapping by less than 5 cm is not an overlap', () => {
  const objs = [room(0, 0, 500, 400), furn('b', 0, 0, 160, 200)];
  assert.deepEqual(placementIssues(objs, box(160 + 80 - 4, 100), bed, itemOf), []);   // 4 cm into it
  assert.equal(placementIssues(objs, box(160 + 80 - 8, 100), bed, itemOf).length, 1);  // 8 cm into it
});

test('rugs and ceiling lights share floor area with anything, both ways', () => {
  const objs = [room(0, 0, 500, 400), furn('rug', 0, 0, 300, 300, 'rug', '地毯'), furn('lamp', 50, 50, 60, 60, 'lamp', '吊燈')];
  assert.deepEqual(placementIssues(objs, box(120, 120), bed, itemOf), []);              // a bed on the rug, under the lamp
  assert.deepEqual(placementIssues([furn('b', 0, 0, 160, 200)], box(80, 100), { height: 1 }, itemOf), []);   // a rug under the bed
  assert.ok(stacksFreely({ mount: 'wall' }) && !stacksFreely({ height: 45 }));
});

test('outside every room is a reason only when the storey has rooms', () => {
  assert.equal(placementIssues([room(0, 0, 400, 300)], box(800, 800), bed, itemOf).length, 1);
  assert.deepEqual(placementIssues([], box(800, 800), bed, itemOf), []);
  assert.deepEqual(placementIssues([room(0, 0, 400, 300)], box(200, 150), bed, itemOf), []);
});

test('a piece being moved does not overlap itself', () => {
  const objs = [room(0, 0, 500, 400), furn('b', 0, 0, 160, 200)];
  assert.deepEqual(placementIssues(objs, box(90, 100), bed, itemOf, 'b'), []);
});

test('nearest wall distance is to the centre line, Infinity with no walls', () => {
  const w = { id: 'w', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 12 } as Obj;
  assert.equal(nearestWallDistance([w], { x: 200, y: 150 }), 150);
  assert.equal(nearestWallDistance([], { x: 0, y: 0 }), Infinity);
});
