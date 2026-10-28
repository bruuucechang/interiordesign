import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placementIssues, nearestWallDistance, stacksFreely, tucksUnder } from '../src/core/placement';
import { FURNITURE_BY_ID } from '../src/data/furniture';
import { wallBox } from '../src/core/clearance';
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

// ---- B22 review: the real catalogue, angles, walls ----
test('the real rugs, mats, platforms and hanging lights stack freely; a double bed does not', () => {
  for (const id of ['rug', 'rug_round', 'rug_square', 'doormat', 'jp_tatami', 'jp_tatami_high', 'jp_futon', 'lamp_pendant', 'lamp_ceiling']) {
    assert.ok(FURNITURE_BY_ID[id], `${id} in the catalogue`);
    assert.ok(stacksFreely(FURNITURE_BY_ID[id]), id);
  }
  assert.ok(!stacksFreely(FURNITURE_BY_ID.bed_double));
});

test('a coffee table on the real rug is fine', () => {
  const rug = FURNITURE_BY_ID.rug;
  const objs = [room(0, 0, 500, 400), furn('r', 100, 100, rug.w, rug.h, 'rug', '地毯')];
  const real = (o: Extract<Obj, { kind: 'furniture' }>) => FURNITURE_BY_ID[o.item];
  assert.deepEqual(placementIssues(objs, box(200, 170, 120, 60), { name: '茶几', w: 120, h: 60, height: 45 }, real), []);
});

test('a chair pushed under a table is not an overlap; a bed on the table is', () => {
  assert.ok(tucksUnder({ name: '餐椅' }, { name: '餐桌' }) && tucksUnder({ name: '書桌' }, { name: '辦公椅' }));
  assert.ok(!tucksUnder({ name: '雙人沙發' }, { name: '茶几' }) && !tucksUnder({ name: '雙人床' }, { name: '餐桌' }));
  const cat: Record<string, { name: string; w: number; h: number }> = { table: { name: '餐桌', w: 160, h: 90 } };
  const objs = [furn('t', 0, 0, 160, 90, 'table', '餐桌')];
  assert.deepEqual(placementIssues(objs, box(40, 100, 50, 55), { name: '餐椅', w: 50, h: 55 }, o => cat[o.item]), []);   // 18 cm under the table's edge
  assert.equal(placementIssues(objs, box(80, 45, 160, 200), { name: '雙人床', w: 160, h: 200 }, o => cat[o.item]).length, 1);
});

test('small pieces that stand on counters do not overlap anything; long thin ones still do', () => {
  assert.ok(stacksFreely({ name: '微波爐', w: 50, h: 38 }));
  assert.ok(!stacksFreely({ name: '餐桌', w: 160, h: 90 }));
  for (const id of ['jp_shoji', 'bookshelf_q', 'sh_toilet']) {
    assert.ok(FURNITURE_BY_ID[id], `${id} in the catalogue`);
    assert.ok(!stacksFreely(FURNITURE_BY_ID[id]), `${id} (${FURNITURE_BY_ID[id].w}×${FURNITURE_BY_ID[id].h}) is not small`);
  }
});

test('a chair sunk wholly into a table is an overlap; pushed in up to its middle is not', () => {
  const cat: Record<string, { name: string; w: number; h: number }> = { table: { name: '茶几', w: 120, h: 60 } };
  const objs = [furn('t', 0, 0, 120, 60, 'table', '茶几')];
  const arm = { name: '休閒單椅', w: 101, h: 119 };
  assert.equal(placementIssues(objs, box(60, 30, 101, 119), arm, o => cat[o.item]).length, 1);          // centre inside the table
  assert.deepEqual(placementIssues(objs, box(60, 60 + 20, 50, 55), { name: '餐椅', w: 50, h: 55 }, o => cat[o.item]), []);   // tucked from the side
});

test('turned 45°, 4 cm into a bed is touching, 10 cm is an overlap', () => {
  const objs = [furn('b', 0, 0, 100, 100)];
  const d = (k: number) => 50 + 50 * Math.SQRT2 - k;   // centre distance for a 100×100 square at 45° to touch the bed's right face, minus k
  assert.deepEqual(placementIssues(objs, { cx: 50 + d(4), cy: 50, w: 100, h: 100, angle: 45 }, bed, itemOf), []);
  assert.equal(placementIssues(objs, { cx: 50 + d(10), cy: 50, w: 100, h: 100, angle: 45 }, bed, itemOf).length, 1);
});

test('against a wall face is fine, 4 cm into the wall is not; hung things are exempt', () => {
  const w = wallBox({ x: 0, y: 0 }, { x: 400, y: 0 }, 12)!;   // faces at y = ±6
  assert.deepEqual(placementIssues([], box(200, 6 + 100, 160, 200), bed, itemOf, undefined, [w]), []);
  assert.deepEqual(placementIssues([], box(200, 6 + 100 - 4, 160, 200), bed, itemOf, undefined, [w]).length, 1);
  assert.deepEqual(placementIssues([], box(200, 0, 60, 20), { mount: 'wall' }, itemOf, undefined, [w]), []);
});
