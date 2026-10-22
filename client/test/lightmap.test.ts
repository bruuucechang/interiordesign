import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightFloor, fullHeightBoxes, circuitsOf, contour, sample, luxColor, heatPixels, LUX_STOPS } from '../src/core/lightmap';
import { grid, lightRoom, luminaires, PLANES, REFLECTANCE } from '../src/core/lighting';
import type { LuxGrid } from '../src/core/lighting';
import type { Electrical, ElectricalId, Obj } from '../src/model/schema';
import { fitElectricalToWall } from '../src/tools/place';
import { electricalEnds } from '../src/core/hit';

let n = 0;
const elec = (item: ElectricalId, x: number, y: number, more: Partial<Electrical> = {}): Electrical =>
  ({ id: `e${n++}`, kind: 'electrical', layer: 'electrical', item, x, y, angle: 0, ...more });
const room = (id: string, x: number, y: number, w: number, h: number): Obj =>
  ({ id, kind: 'room', layer: 'rooms', x, y, w, h, name: id });
const CEIL = 280;
const view = { height: PLANES.desk, rho: REFLECTANCE.medium, on: null, step: 5 };

test('lightFloor 跟直接呼叫 grid 一位不差（它只是把房間跟燈配好）', () => {
  const objs: Obj[] = [room('a', 0, 0, 300, 300), elec('downlight', 150, 150)];
  const [r] = lightFloor(objs, CEIL, view);
  const g = grid(lightRoom(objs[0] as any, CEIL), luminaires(objs, CEIL), { height: 75, rho: 0.45, step: 5 });
  assert.equal(r.grid.avg, g.avg);
  assert.equal(r.lums.length, 1);
  assert.equal(r.area, 9);
});

test('隔壁房間的燈不算進來；關掉的迴路不算', () => {
  const objs: Obj[] = [room('a', 0, 0, 300, 300), room('b', 300, 0, 300, 300),
    elec('downlight', 150, 150, { circuit: 1 }), elec('downlight', 450, 150, { circuit: 2 })];
  const [a, b] = lightFloor(objs, CEIL, view);
  assert.equal(a.lums.length, 1); assert.equal(b.lums.length, 1);
  const off = lightFloor(objs, CEIL, { ...view, on: new Set([1]) });
  assert.equal(off[1].lums.length, 0);
  assert.equal(off[1].grid.avg, 0, '沒有燈就沒有反射光');
  assert.deepEqual(circuitsOf(objs, CEIL), [{ circuit: 1, count: 1 }, { circuit: 2, count: 1 }]);
});

test('快取：只動一間的燈，另一間的格點是同一個物件（沒有重算）', () => {
  const cache = new Map<string, LuxGrid>();
  const objs: Obj[] = [room('a', 0, 0, 300, 300), room('b', 300, 0, 300, 300),
    elec('downlight', 150, 150), elec('downlight', 450, 150)];
  const first = lightFloor(objs, CEIL, view, cache);
  (objs[3] as Electrical).x = 420;
  const second = lightFloor(objs, CEIL, view, cache);
  assert.equal(second[0].grid, first[0].grid);
  assert.notEqual(second[1].grid, first[1].grid);
  assert.equal(cache.size, 2, '舊的格點被清掉');
});

test('做到頂的櫃子才擋：220 的衣櫃在 280 的天花板下不算，270 的算', () => {
  const f = (h: number): Obj => ({ id: 'f' + h, kind: 'furniture', layer: 'furniture', item: 'wardrobe', x: 0, y: 0, w: 100, h: 60, angle: 0, label: '', height: h });
  assert.equal(fullHeightBoxes([f(220)], CEIL).length, 0);
  assert.equal(fullHeightBoxes([f(270)], CEIL).length, 1);
});

test('等照度線落在照度跨過那個值的地方', () => {
  const g: LuxGrid = { x0: 0, y0: 0, step: 10, nx: 3, ny: 2, v: Float32Array.from([50, 150, 250, 50, 150, 250]),
    indirect: 0, avg: 0, min: 0, max: 0, p100: 0, p300: 0, uniformity: 0 };
  const seg = contour(g, 100);
  assert.equal(seg.length, 4);
  assert.equal(seg[0], 5); assert.equal(seg[2], 5);
  assert.equal(contour(g, 300).length, 0);
  assert.equal(sample(g, 5, 0), 100, '兩格中間取平均');
  assert.ok(Number.isNaN(sample(g, -1, 0)));
});

test('色階：端點是原型的顏色，房外透明', () => {
  assert.deepEqual(luxColor(0), [0x0e, 0x12, 0x18]);
  assert.deepEqual(luxColor(300), [0xf5, 0xc4, 0x5c]);
  assert.deepEqual(luxColor(9999), [255, 255, 255]);
  assert.equal(LUX_STOPS.length, 8);
  const g = { nx: 2, ny: 1, v: Float32Array.from([NaN, 300]) } as LuxGrid;
  const px = heatPixels(g);
  assert.equal(px[3], 0); assert.equal(px[7], 255);
});

test('T5 貼牆吸到牆面，不是中心線：24 cm 的牆往房間那側推 12 cm', () => {
  const wall = { a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 24 };
  for (const side of [1, -1]) {
    const face = fitElectricalToWall({ x: 200, y: 30 * side }, [wall], true)!;
    assert.equal(face.pos.y, 12 * side);
    const centre = fitElectricalToWall({ x: 200, y: 30 * side }, [wall])!;
    assert.equal(centre.pos.y, 0, '插座照舊在中心線');
  }
});

test('T5 的兩端：120 cm 的 4 尺沿它的方向展開', () => {
  const [a, b] = electricalEnds(elec('batten', 100, 100, { angle: 90, size: 4 }) as any);
  assert.ok(Math.abs(a.x - 100) < 1e-9 && Math.abs(b.y - a.y - 119.4) < 1e-9);
  const [c, d] = electricalEnds(elec('downlight', 5, 5) as any);
  assert.deepEqual(c, d);
});
