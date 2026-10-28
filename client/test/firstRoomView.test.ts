import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRoomView, SMALL_ROOM, FRAMED_ROOM } from '../src/core/firstRoomView';

const pane = (scale = 0.4) => ({ scale, origin: { x: 0, y: 0 }, width: 1000, height: 600 });
const share = (room: { w: number; h: number }, scale: number) => room.w * room.h * scale * scale / (1000 * 600);

test('a small first room is framed to about half the pane, centred', () => {
  const room = { x: 200, y: 300, w: 300, h: 300 };   // 3×3 m at 0.4 px/cm: 120×120 px, 2.4 % of the pane
  assert.ok(share(room, 0.4) < SMALL_ROOM);
  const v = firstRoomView(room, pane())!;
  assert.ok(v, 'framed');
  // Capped by fit (600 px tall pane, 90 %) before reaching 50 % by area.
  assert.ok(Math.abs(v.scale - 0.9 * 600 / 300) < 1e-9);
  assert.ok(share(room, v.scale) > SMALL_ROOM && share(room, v.scale) <= FRAMED_ROOM + 1e-9);
  // Centre of the room lands at the centre of the pane.
  assert.ok(Math.abs((room.x + room.w / 2 - v.x) * v.scale - 500) < 1e-6);
  assert.ok(Math.abs((room.y + room.h / 2 - v.y) * v.scale - 300) < 1e-6);
});

test('a wide room reaches half the pane by area when it fits', () => {
  const room = { x: 0, y: 0, w: 800, h: 300 };
  const v = firstRoomView(room, pane(0.2))!;
  assert.ok(Math.abs(share(room, v.scale) - FRAMED_ROOM) < 1e-9);
  assert.ok(room.w * v.scale <= 1000 && room.h * v.scale <= 600);
});

test('a room already big enough on screen leaves the camera alone', () => {
  const room = { x: 0, y: 0, w: 1200, h: 800 };   // at 0.4: 480×320 px = 25.6 %
  assert.ok(firstRoomView(room, pane(0.4)));
  assert.equal(firstRoomView(room, pane(0.5)), null);   // 600×400 = 40 %
});

test('never zooms out, and does nothing before the pane has a size', () => {
  // 50 m × 50 m at 0.4 px/cm is 2000 px square: fills the pane, nothing to do.
  assert.equal(firstRoomView({ x: 0, y: 0, w: 5000, h: 5000 }, pane(0.4)), null);
  // Small share but already zoomed past the framing scale (max zoom clamp): no zoom-out.
  assert.equal(firstRoomView({ x: 0, y: 0, w: 300, h: 300 }, pane(0.5), 0.05, 0.4), null);
  assert.equal(firstRoomView({ x: 0, y: 0, w: 300, h: 300 }, { ...pane(), width: 0, height: 0 }), null);
});
