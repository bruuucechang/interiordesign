import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGHTING, sunPose, wallJoins, straightWallBoxes, sweptBand, occluder, cullFrame, cutsAway,
  objectExtent, sceneFrame, flyAxes, panAxes, lightMeshSpec, EDGE_BAND,
} from '../src/core/view3dMath';
import { lightParts } from '../src/core/lights3d';
import { isTextField } from '../src/core/keys3d';
import type { Obj, Electrical } from '../src/model/schema';
import type { Wall, Opening } from '../src/core/wallGeometry';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const wall = (a: [number, number], b: [number, number], over: Partial<Wall> = {}): Wall => ({
  id: 'w' + a + b, kind: 'wall', layer: 'walls', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 12, ...over,
});

// ---- sun ----

test('the sun sits span × 1.6 out along its elevation and azimuth, aimed at the centre', () => {
  const s = sunPose('noon', { x: 100, z: 200 }, 500);
  const P = LIGHTING.noon, el = P.elev * Math.PI / 180, az = P.azim * Math.PI / 180, d = 800;
  assert.ok(near(s.position[0], 100 + Math.cos(el) * Math.cos(az) * d));
  assert.ok(near(s.position[1], Math.sin(el) * d));
  assert.ok(near(s.position[2], 200 + Math.cos(el) * Math.sin(az) * d));
  assert.deepEqual(s.target, [100, 0, 200]);
});

test('a low sun on a small plan is held at least 80 cm up', () => {
  // dusk is 12° — on a 100 cm span that would be 33 cm, under the walls
  assert.equal(sunPose('dusk', { x: 0, z: 0 }, 100).position[1], 80);
});

// ---- straight walls ----

test('a free-standing wall is one box exactly its drawn length', () => {
  const [b] = straightWallBoxes(wall([0, 0], [500, 0]), [], 280, 0);
  assert.equal(b.len, 500);
  assert.equal(b.height, 280);
  assert.equal(b.depth, 12);
  assert.deepEqual(b.position, [250, 140, 0]);
});

test('a wall runs half a thickness past each end that meets another wall', () => {
  const w = wall([0, 0], [500, 0]);
  const both = straightWallBoxes(w, [], 280, 0, wallJoins([w, wall([0, 0], [0, 400]), wall([500, 0], [500, 400])]));
  assert.equal(both[0].len, 512);
  assert.equal(both[0].position[0], 250);
  const one = straightWallBoxes(w, [], 280, 0, wallJoins([w, wall([0, 0], [0, 400])]));
  assert.equal(one[0].len, 506);
  assert.equal(one[0].position[0], 247);   // grows only towards the joined end
  const end = straightWallBoxes(w, [], 280, 0, wallJoins([w, wall([500, 0], [500, 400])]));
  assert.equal(end[0].len, 506);
  assert.equal(end[0].position[0], 253);   // a free start does not grow
});

test('a wall drawn down the plan turns -90° and stands on its own floor', () => {
  const [b] = straightWallBoxes(wall([0, 0], [0, 400]), [], 280, 300);
  assert.ok(near(b.rotationY, -Math.PI / 2));
  assert.deepEqual(b.position, [0, 300 + 140, 200]);
});

test('a door cuts the wall into two sides and a lintel', () => {
  const door: Opening = { id: 'd', kind: 'door', layer: 'openings', x: 250, y: 0, width: 90, angle: 0 };
  const boxes = straightWallBoxes(wall([0, 0], [500, 0]), [door], 280, 0);
  assert.equal(boxes.length, 3);
  const full = boxes.filter((b) => b.height === 280).reduce((s, b) => s + b.len, 0);
  assert.equal(full, 500 - 90);
});

test('a wall shorter than a centimetre draws nothing', () => {
  assert.deepEqual(straightWallBoxes(wall([0, 0], [0.5, 0]), [], 280, 0), []);
});

// ---- swept (curved) bands ----

test('a swept band needs two points and some height', () => {
  assert.equal(sweptBand([{ x: 0, y: 0 }], 0, 100, 10, 0), null);
  assert.equal(sweptBand([{ x: 0, y: 0 }, { x: 100, y: 0 }], 50, 50.4, 10, 0), null);
});

test('a two-point band is two sides, a top and two caps, offset half a thickness either side', () => {
  const b = sweptBand([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10, 110, 10, 300)!;
  assert.equal(b.pos.length / 3, 20);           // 8 side + 4 top + 8 cap vertices
  assert.equal(b.idx.length / 3, 10);           // 4 side + 2 top + 4 cap triangles
  // first vertex: outer side, bottom, at the start — +z is the left of a +x run
  assert.deepEqual(b.pos.slice(0, 3), [0, 310, 5]);
  const ys = b.pos.filter((_, i) => i % 3 === 1);
  assert.equal(Math.min(...ys), 310);
  assert.equal(Math.max(...ys), 410);
});

// ---- the doll's-house cut ----

test('a run of wall blocks the axis across it, at its midpoint', () => {
  assert.deepEqual(occluder(wall([0, 0], [400, 0])), { at: { x: 200, z: 0 }, blocks: 'z' });
  assert.deepEqual(occluder(wall([0, 0], [0, 400])), { at: { x: 0, z: 200 }, blocks: 'x' });
  const win: Obj = { id: 'n', kind: 'window', layer: 'openings', x: 50, y: 60, width: 100, angle: 90 };
  assert.deepEqual(occluder(win), { at: { x: 50, z: 60 }, blocks: 'x' });
  const sofa: Obj = { id: 'f', kind: 'furniture', layer: 'furniture', item: 'sofa', label: '沙發', x: 0, y: 0, w: 200, h: 90, angle: 0 };
  assert.equal(occluder(sofa), null);
});

const box = { min: { x: 0, z: 0 }, max: { x: 1000, z: 600 } };

test('the camera side only flips once it is clearly past the centre line', () => {
  // centre 500; dead zone ±15% of the 500 half width = ±75
  assert.equal(cullFrame(box, { x: 560, z: 300 }, { sx: -1, sz: 1 }).sx, -1);
  assert.equal(cullFrame(box, { x: 580, z: 300 }, { sx: -1, sz: 1 }).sx, 1);
  assert.equal(cullFrame(box, { x: 440, z: 300 }, { sx: 1, sz: 1 }).sx, 1);
  assert.equal(cullFrame(box, { x: 0, z: 300 }, { sx: 1, sz: 1 }).sx, -1);
});

test('a zero-size plan does not divide by zero', () => {
  const f = cullFrame({ min: { x: 5, z: 5 }, max: { x: 5, z: 5 } }, { x: 100, z: 100 }, { sx: 1, sz: 1 });
  assert.equal(f.halfX, 1);
  assert.equal(f.halfZ, 1);
});

test('only the outside wall facing the camera is cut away', () => {
  const south = cullFrame(box, { x: 500, z: 2000 }, { sx: 1, sz: 1 });   // camera below the plan (+z)
  const north = cullFrame(box, { x: 500, z: -2000 }, { sx: 1, sz: 1 });
  const southWall = { at: { x: 500, z: 600 }, blocks: 'z' as const };
  assert.equal(cutsAway(southWall, south), true);
  assert.equal(cutsAway(southWall, north), false);
  // a partition through the middle never goes, from either side
  const mid = { at: { x: 500, z: 300 + 300 * EDGE_BAND - 1 }, blocks: 'z' as const };
  assert.equal(cutsAway(mid, south), false);
  // the east wall goes only while the camera counts as east of the centre
  const eastWall = { at: { x: 1000, z: 300 }, blocks: 'x' as const };
  assert.equal(cutsAway(eastWall, cullFrame(box, { x: 3000, z: 300 }, { sx: -1, sz: 1 })), true);
  assert.equal(cutsAway(eastWall, cullFrame(box, { x: -3000, z: 300 }, { sx: 1, sz: 1 })), false);
});

// ---- framing ----

test('each kind of object reports the plan points it occupies', () => {
  assert.deepEqual(objectExtent(wall([1, 2], [3, 4])), [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  const room: Obj = { id: 'r', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 10, h: 10, poly: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 5, y: 9 }] } as Obj;
  assert.equal(objectExtent(room).length, 3);
  const sofa: Obj = { id: 'f', kind: 'furniture', layer: 'furniture', item: 'sofa', label: '沙發', x: 10, y: 20, w: 200, h: 90, angle: 0 };
  assert.deepEqual(objectExtent(sofa), [{ x: 10, y: 20 }, { x: 210, y: 110 }]);
});

test('an empty plan frames a 4 m square around the origin', () => {
  const f = sceneFrame({ minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  assert.equal(f.cx, 0);
  assert.equal(f.span, 600);
  assert.deepEqual(f.target, [0, 40, 0]);
  assert.deepEqual(f.eye, [420, 480, 540]);
});

test('a small plan still frames at least 3 m', () => {
  assert.equal(sceneFrame({ minX: 0, maxX: 50, minZ: 0, maxZ: 50 }).span, 500);
  assert.equal(sceneFrame({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 }).span, 500);
});

// ---- input ----

test('opposite keys cancel, and each axis is its own', () => {
  assert.deepEqual(flyAxes(new Set(['w', 's', 'd', 'up'])), { fwd: 0, strafe: 1, vert: 1 });
  assert.deepEqual(panAxes(new Set(['panLeft', 'panUp'])), { x: -1, y: 1 });
  assert.deepEqual(panAxes(new Set(['panLeft', 'panRight'])), { x: 0, y: 0 });
});

test('number fields give the fly keys back; text fields keep them', () => {
  assert.equal(isTextField({ tagName: 'INPUT', type: 'number' }), false);
  assert.equal(isTextField({ tagName: 'INPUT', type: 'range' }), false);
  assert.equal(isTextField({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTextField({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTextField({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTextField({ tagName: 'BUTTON' }), false);
  assert.equal(isTextField(null), false);
});

// ---- light fittings (B10 left lightMesh untested) ----

const el = (item: Electrical['item'], over: Partial<Electrical> = {}): Electrical => ({
  id: 'e', kind: 'electrical', layer: 'electrical', item, x: 100, y: 200, angle: 0, ...over,
});

/** Where a mesh's local +x ends up in plan coords after rotation.y = r. */
const localXInPlan = (r: number) => ({ x: Math.cos(r), y: -Math.sin(r) });

test('a box fitting is scaled to its size and placed at plan (x, y), height z', () => {
  const s = lightMeshSpec({ shape: 'box', x: 10, y: 20, z: 250, w: 60, d: 3, h: 2.5, angle: 0, glow: true }, 300);
  assert.equal(s.unit, 'box');
  assert.equal(s.glow, true);
  assert.deepEqual(s.scale, [60, 2.5, 3]);
  assert.deepEqual(s.position, [10, 550, 20]);
});

test('a cylinder is scaled radius–height–radius and never turned', () => {
  const s = lightMeshSpec({ shape: 'cylinder', x: 1, y: 2, z: 3, r: 4.5, h: 0.6, glow: false }, 0);
  assert.equal(s.unit, 'cyl');
  assert.deepEqual(s.scale, [4.5, 0.6, 4.5]);
  assert.equal(s.rotationY, 0);
});

test('a turned T5 runs along the direction it was drawn, at every angle', () => {
  for (const angle of [0, 30, 90, 180, 270]) {
    const [p] = lightParts(el('batten', { angle }), 280);
    const s = lightMeshSpec(p, 0);
    const d = localXInPlan(s.rotationY);
    const want = { x: Math.cos(angle * Math.PI / 180), y: Math.sin(angle * Math.PI / 180) };
    assert.ok(near(d.x, want.x, 1e-9) && near(d.y, want.y, 1e-9), `angle ${angle}: ${JSON.stringify(d)} vs ${JSON.stringify(want)}`);
  }
});

test('every downlight part lands on its symbol, flush under the ceiling', () => {
  for (const p of lightParts(el('downlight'), 280)) {
    const s = lightMeshSpec(p, 0);
    assert.equal(s.position[0], 100);
    assert.equal(s.position[2], 200);
    assert.ok(s.position[1] + s.scale[1] / 2 <= 280);
  }
});
