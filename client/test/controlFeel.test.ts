import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wheelZoomFactor, loadFeel, saveFeel, orbitFeel, FEEL_DEFAULTS, FEEL_KEY, FEEL_MAX, WHEEL_STEP_MAX, FEEL_BASE } from '../src/core/controlFeel';
import { fitFurnitureToWall, FURN_SNAP } from '../src/tools/place';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- 2D wheel ----

test('a trackpad swipe zooms as much as one mouse notch of the same total, not forty times as much', () => {
  // 40 events of 2.5 px (trackpad) vs 1 event of 100 px (mouse notch)
  let swipe = 1;
  for (let i = 0; i < 40; i++) swipe *= wheelZoomFactor(2.5);
  assert.ok(near(swipe, wheelZoomFactor(100), 1e-9), `swipe ×${swipe} vs notch ×${wheelZoomFactor(100)}`);
  // the old ×1.1-per-event rule would have zoomed ×45 here
  assert.ok(swipe > 1 / 1.2 && swipe < 1, `swipe ${swipe}`);
});

test('a mouse notch is about ×1.08–1.1, and no single event zooms past the cap', () => {
  assert.ok(Math.abs(1 / wheelZoomFactor(100) - 1.083) < 0.01);
  assert.ok(Math.abs(1 / wheelZoomFactor(120) - 1.1) < 0.01);
  assert.equal(wheelZoomFactor(-5000), WHEEL_STEP_MAX);
  assert.equal(wheelZoomFactor(5000), 1 / WHEEL_STEP_MAX);
  assert.equal(wheelZoomFactor(0), 1);
});

test('scrolling up zooms in, and line-mode deltas are converted to pixels', () => {
  assert.ok(wheelZoomFactor(-50) > 1);
  assert.ok(near(wheelZoomFactor(1, 1), wheelZoomFactor(33)));
});

test('the wheel multiplier scales the zoom per pixel', () => {
  assert.ok(near(Math.log(wheelZoomFactor(20, 0, 2)), 2 * Math.log(wheelZoomFactor(20))));
});

// ---- settings ----

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

test('settings round-trip, and junk or out-of-range values fall back or clamp', () => {
  const s = mem();
  saveFeel({ rotate: 2, move: 0.5, wheel: 1, look: 1.5 }, s);
  assert.deepEqual(loadFeel(s), { rotate: 2, move: 0.5, wheel: 1, look: 1.5 });
  assert.deepEqual(loadFeel(mem({ [FEEL_KEY]: '{bad json' })), FEEL_DEFAULTS);
  assert.deepEqual(loadFeel(mem({ [FEEL_KEY]: JSON.stringify({ rotate: 99, move: 'x' }) })), { ...FEEL_DEFAULTS, rotate: FEEL_MAX });
  assert.deepEqual(loadFeel(null), FEEL_DEFAULTS);
});

test('blocked storage never throws', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadFeel(broken), FEEL_DEFAULTS);
  assert.doesNotThrow(() => saveFeel(FEEL_DEFAULTS, broken));
});

test('3D defaults are calmer than three.js defaults, and fly speed no longer depends on the scene', () => {
  const o = orbitFeel(FEEL_DEFAULTS);
  assert.ok(o.rotateSpeed < 1 && o.zoomSpeed < 1 && o.dampingFactor > 0.05);
  assert.equal(o.moveSpeed, FEEL_BASE.fly);
  assert.equal(orbitFeel({ ...FEEL_DEFAULTS, move: 2 }).moveSpeed, 2 * FEEL_BASE.fly);
});

// ---- furniture against a wall ----

// A wall along y = 0, 12 cm thick: its room-side face is y = 6.
const wall = { id: 'w', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 500, y: 0 }, thickness: 12 } as any;
const doc = { objects: [wall], isLayerVisible: () => true } as any;
const shelf = { w: 80, h: 30, height: 180 };
const bed = { w: 150, h: 200, height: 50 };

test('a shallow shelf 40 cm off the wall stays where it is', () => {
  // wall face y = 6, 40 cm gap, half the shelf's depth 15: centre at 61
  assert.equal(fitFurnitureToWall(doc, { x: 250, y: 61 }, shelf), null);
});

test('a shelf within the snap gap is pulled flush and turned to face the room', () => {
  const fit = fitFurnitureToWall(doc, { x: 250, y: 6 + FURN_SNAP - 5 + 15 }, shelf);
  assert.ok(fit);
  assert.ok(near(fit!.pos.y, 6 + 15));
  assert.ok(near(fit!.angle, 0) || near(fit!.angle, -0));
});

test('a deep bed snaps when its headboard is near the wall, without first being pushed into it', () => {
  // headboard 10 cm off the wall face: centre at 6 + 10 + 100 = 116 (the old 60 cm centre-line rule missed this)
  const fit = fitFurnitureToWall(doc, { x: 250, y: 116 }, bed);
  assert.ok(fit);
  assert.ok(near(fit!.pos.y, 106));
});

test('the nearest wall face wins in a corner', () => {
  const side = { id: 'v', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 0, y: 500 }, thickness: 12 } as any;
  const d2 = { objects: [wall, side], isLayerVisible: () => true } as any;
  // 5 cm from the side wall's face, 20 cm from the top wall's face
  const fit = fitFurnitureToWall(d2, { x: 6 + 5 + 15, y: 6 + 20 + 15 }, shelf);
  assert.ok(fit);
  assert.ok(near(fit!.pos.x, 6 + 15), `x ${fit!.pos.x}`);
});

test('cursor past the end of a wall: no snap, so a deep bed is never turned to a slant', () => {
  assert.equal(fitFurnitureToWall(doc, { x: 620, y: 30 }, bed), null);
  assert.equal(fitFurnitureToWall(doc, { x: 560, y: 90 }, bed), null);
});

test('curved walls are not measured along their chord', () => {
  const arc = { id: 'c', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, thickness: 12, bulge: 200 } as any;
  assert.equal(fitFurnitureToWall({ objects: [arc], isLayerVisible: () => true } as any, { x: 300, y: 100 }, bed), null);
});
