import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRoomPolygons } from '../src/core/rooms';
import { polygonArea } from '../src/core/geometry';

const wall = (id: string, ax: number, ay: number, bx: number, by: number) =>
  ({ id, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 12 }) as any;

const square = (p: string, x: number, y: number, s: number) => [
  wall(p + '1', x, y, x + s, y),
  wall(p + '2', x + s, y, x + s, y + s),
  wall(p + '3', x + s, y + s, x, y + s),
  wall(p + '4', x, y + s, x, y),
];

test('a closed square of walls yields exactly one room', () => {
  const polys = detectRoomPolygons(square('a', 0, 0, 400));
  assert.equal(polys.length, 1);
  assert.ok(Math.abs(polygonArea(polys[0]) - 400 * 400) < 1);
});

test('an open loop (3 walls) yields no room', () => {
  const walls = [wall('1', 0, 0, 400, 0), wall('2', 400, 0, 400, 400), wall('3', 400, 400, 0, 400)];
  assert.equal(detectRoomPolygons(walls).length, 0);
});

test('two separate squares yield two rooms', () => {
  const polys = detectRoomPolygons([...square('a', 0, 0, 300), ...square('b', 1000, 0, 300)]);
  assert.equal(polys.length, 2);
});

test('nearly-touching endpoints (within merge epsilon) still close the loop', () => {
  const walls = [
    wall('1', 0, 0, 400, 0),
    wall('2', 400, 0, 400, 400),
    wall('3', 400, 400, 0, 400),
    wall('4', 0, 400, 1, 1),   // ends ~1.4cm from the start — under the 2cm merge epsilon
  ];
  assert.equal(detectRoomPolygons(walls).length, 1);
});

test('slivers below the minimum area are ignored', () => {
  const polys = detectRoomPolygons(square('a', 0, 0, 30));   // 30×30 = 900 cm² < 2500 min
  assert.equal(polys.length, 0);
});
