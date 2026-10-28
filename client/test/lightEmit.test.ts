import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitters, kelvinRGB, coneOf, pickEmitters, sightLines, threeIntensity, MAX_CONE, LUX_GAIN } from '../src/core/lightEmit';
import { luminaires, sources, lux, MAINTENANCE } from '../src/core/lighting';
import type { Electrical, ElectricalId, Obj } from '../src/model/schema';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} ±${tol}`);
let n = 0;
const elec = (item: ElectricalId, x: number, y: number, more: Partial<Electrical> = {}): Electrical =>
  ({ id: `e${n++}`, kind: 'electrical', layer: 'electrical', item, x, y, angle: 0, ...more });
const wall = (id: string, ax: number, ay: number, bx: number, by: number): Obj =>
  ({ id, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 12 } as Obj);
const CEIL = 280;

test('a downlight straight below gives the same lux in 3D as the 2D maths (inverse square, same candela)', () => {
  const objs = [elec('downlight', 0, 0)];
  const [e] = emitters(objs, CEIL);
  const d = (CEIL - 75) / 100;   // to the desk, m
  // 2D: direct only (no reflected term), maintenance applied
  const e2d = lux(sources(luminaires(objs, CEIL)), 0, 0, 75, 0);
  near(e.candela / (d * d), e2d, 1e-9);
  assert.deepEqual(e.dir, [0, 0, -1]);
});

test('three gets candela × 10⁴ (centimetres) × the display gain', () => {
  near(threeIntensity(100), 100 * 1e4 * LUX_GAIN, 1e-9);
});

test('a T5 shines sideways into the room it faces, with the summed-segment peak', () => {
  const [e] = emitters([elec('batten', 100, 0, { angle: 180, size: 4 })], CEIL);   // faces +y (south)
  near(e.dir[0], 0, 1e-12); near(e.dir[1], 1, 1e-12); assert.equal(e.dir[2], 0);
  near(e.candela, MAINTENANCE * 2 * 2000 / (Math.PI * Math.PI), 1e-9);
  assert.equal(e.cone, MAX_CONE);
});

test('a narrow spotlight has a narrow cone, a 120° downlight the widest three can draw', () => {
  const [spot] = emitters([elec('spotlight', 0, 0)], CEIL);
  const [down] = emitters([elec('downlight', 0, 0)], CEIL);
  assert.ok(spot.cone < 45 * Math.PI / 180, `spot ${spot.cone}`);
  assert.equal(down.cone, MAX_CONE);
  assert.ok(coneOf(50) < coneOf(5));
});

test('switched-off groups emit nothing; sockets never do', () => {
  const objs = [elec('downlight', 0, 0, { circuit: 1 }), elec('downlight', 0, 0, { circuit: 2 }), elec('socket' as ElectricalId, 0, 0)];
  assert.equal(emitters(objs, CEIL).length, 2);
  assert.equal(emitters(objs, CEIL, new Set([2])).length, 1);
});

test('colour temperature: 2700 K is warm, 6500 K is near white', () => {
  const [r, g, b] = kelvinRGB(2700);
  assert.ok(r === 1 && g < 0.8 && b < 0.6, `${r} ${g} ${b}`);
  const w = kelvinRGB(6500);
  assert.ok(w.every(c => c > 0.95), String(w));
  const [e] = emitters([elec('downlight', 0, 0, { cct: 4000 })], CEIL);
  assert.deepEqual(e.color, kelvinRGB(4000));
});

test('the pool fills with the lights you can see first, then the nearest behind walls', () => {
  // you at (100,100); a wall at x=300 with no door. Far light in your room, near light behind the wall.
  const objs: Obj[] = [wall('w', 300, -500, 300, 500), elec('downlight', -400, 100), elec('downlight', 320, 100), elec('downlight', 900, 100)];
  const list = emitters(objs, CEIL);
  const [far, behind, farther] = list;
  const picked = pickEmitters(list, { x: 100, y: 100, h: 160 }, sightLines(objs), 2);
  assert.deepEqual(picked.map(e => e.id), [far.id, behind.id], 'the one in your room wins though it is further');
  assert.ok(!picked.includes(farther));
});

test('a door in the wall makes the light behind it visible again', () => {
  const objs: Obj[] = [wall('w', 300, -500, 300, 500), { id: 'd', kind: 'door', layer: 'openings', x: 300, y: 100, width: 90, angle: 90 } as Obj,
    elec('downlight', -400, 100), elec('downlight', 320, 100)];
  const list = emitters(objs, CEIL);
  // the lamp itself is above the door head from here; the floor it lights is not
  const picked = pickEmitters(list, { x: 100, y: 100, h: 160 }, sightLines(objs), 1);
  assert.equal(picked[0].id, list[1].id);
  const shut = pickEmitters(emitters(objs.filter(o => o.kind !== 'door'), CEIL), { x: 100, y: 100, h: 160 }, sightLines(objs.filter(o => o.kind !== 'door')), 1);
  assert.equal(shut[0].id, list[0].id, 'no door: the far lamp in your own room wins');
});
