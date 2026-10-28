import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockers, move, resolve, settle, stairProgress, walkStep, WALK } from '../src/core/walk';
import type { Floor, Obj } from '../src/model/schema';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} ±${tol}`);
const wall = (id: string, ax: number, ay: number, bx: number, by: number, more = {}): Obj =>
  ({ id, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 12, ...more } as Obj);
const door = (x: number, y: number, width: number, angle = 90): Obj =>
  ({ id: 'd' + x + y, kind: 'door', layer: 'openings', x, y, width, angle } as Obj);
const win = (x: number, y: number, width: number, angle = 90): Obj =>
  ({ id: 'w' + x + y, kind: 'window', layer: 'openings', x, y, width, angle } as Obj);
const clear = WALK.radius + 6;   // centre to wall line when touching a 12 cm wall

test('walking straight at a wall stops a radius and half a wall short of it', () => {
  const ws = blockers([wall('w', 300, -500, 300, 500)]);
  const p = move({ x: 0, y: 0 }, 1000, 0, ws);
  near(p.x, 300 - clear, 1e-6);
  near(p.y, 0, 1e-6);
});

test('walking at a wall at an angle slides along it instead of stopping', () => {
  const ws = blockers([wall('w', 300, -500, 300, 500)]);
  const p = move({ x: 200, y: 0 }, 400, 300, ws);
  near(p.x, 300 - clear, 1e-6);
  near(p.y, 300, 1e-6);
});

test('a long step never jumps a thin wall', () => {
  const ws = blockers([wall('w', 300, -500, 300, 500, { thickness: 2 })]);
  assert.ok(move({ x: 0, y: 0 }, 5000, 0, ws).x < 300);
});

test('a door is a gap you can walk through; the wall either side of it is not', () => {
  const objs = [wall('w', 300, -500, 300, 500), door(300, 0, 90)];
  const ws = blockers(objs);
  assert.ok(move({ x: 0, y: 0 }, 600, 0, ws).x > 500, 'through the door');
  assert.ok(move({ x: 0, y: 200 }, 600, 0, ws).x < 300, 'beside it: stopped');
});

test('a door narrower than you are cannot be walked through', () => {
  const ws = blockers([wall('w', 300, -500, 300, 500), door(300, 0, 45)]);
  assert.ok(move({ x: 0, y: 0 }, 600, 0, ws).x < 300);
  const ok = blockers([wall('w', 300, -500, 300, 500), door(300, 0, 55)]);
  assert.ok(move({ x: 0, y: 0 }, 600, 0, ok).x > 500);
});

test('a window is wall: you do not climb out of it', () => {
  const ws = blockers([wall('w', 300, -500, 300, 500), win(300, 0, 120)]);
  assert.ok(move({ x: 0, y: 0 }, 600, 0, ws).x < 300);
});

test('furniture and partitions do not block', () => {
  const objs: Obj[] = [
    { id: 'p', kind: 'partition', layer: 'walls', a: { x: 300, y: -500 }, b: { x: 300, y: 500 } } as Obj,
    { id: 'f', kind: 'furniture', layer: 'furniture', item: 'sofa', x: 100, y: -50, w: 200, h: 90, angle: 0, label: '' } as Obj,
  ];
  assert.equal(blockers(objs).length, 0);
});

test('a curved wall stops you too', () => {
  const ws = blockers([wall('c', 0, 300, 600, 300, { bulge: 80 })]);
  const p = move({ x: 300, y: 0 }, 0, 1000, ws);
  assert.ok(p.y < 300 + 80, `stopped before the arc: ${p.y}`);
});

test('standing in a corner pushes you out of both walls', () => {
  const ws = blockers([wall('a', 0, 0, 400, 0), wall('b', 0, 0, 0, 400)]);
  const p = resolve({ x: 5, y: 5 }, ws);
  near(p.x, clear, 1e-6); near(p.y, clear, 1e-6);
});

// ---- stairs ----

const stairs = (x: number, y: number, angle = 0): Obj =>
  ({ id: 's', kind: 'furniture', layer: 'furniture', item: 'stairs', x, y, w: 100, h: 300, angle, label: '' } as Obj);
const floors = (objs0: Obj[], objs1: Obj[] = []): Floor[] => [
  { id: 'f1', name: '1F', elevation: 0, height: 300, objects: objs0 },
  { id: 'f2', name: '2F', elevation: 300, height: 300, objects: objs1 },
];

test('the flight rises from its bottom edge to its top edge, linearly', () => {
  const s = stairs(0, 0) as any;
  near(stairProgress(s, { x: 50, y: 300 })!, 0, 1e-9);
  near(stairProgress(s, { x: 50, y: 150 })!, 0.5, 1e-9);
  near(stairProgress(s, { x: 50, y: 0 })!, 1, 1e-9);
  assert.equal(stairProgress(s, { x: 150, y: 150 }), null);
});

test('a turned flight still climbs along its own length', () => {
  const s = stairs(0, 0, 90) as any;   // centre (50,150); its top edge now faces +x
  near(stairProgress(s, { x: 50 + 149, y: 150 })!, 1, 0.01);
  near(stairProgress(s, { x: 50 - 149, y: 150 })!, 0, 0.01);
});

test('walking up the stairs lifts you to the next storey, and down again', () => {
  const fs = floors([stairs(0, 0)]);
  const none = () => [];
  let w = settle(fs, 0, { x: 50, y: 320 });
  assert.equal(w.floor, 0); assert.equal(w.z, 0);
  w = walkStep(fs, w, 0, -170, none);   // half way up
  near(w.z, 150, 1e-6);
  w = walkStep(fs, w, 0, -150, none);   // to the head
  assert.equal(w.floor, 1); near(w.z, 300, 1e-6);
  w = walkStep(fs, w, 0, -100, none);   // off the top onto 2F
  assert.equal(w.floor, 1); assert.equal(w.z, 300);
  w = walkStep(fs, w, 0, 200, none);    // back down onto the flight from above
  assert.ok(w.z < 300 && w.z > 0, `on the way down: ${w.z}`);
  w = walkStep(fs, w, 0, 300, none);
  assert.equal(w.floor, 0); assert.equal(w.z, 0);
});

test('the top storey has no flight to climb: stairs there are just floor', () => {
  const fs = floors([], [stairs(0, 0)]);
  const w = settle(fs, 1, { x: 50, y: 150 });
  assert.equal(w.floor, 1); assert.equal(w.z, 300);
});
