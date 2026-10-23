import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightParts, CEILING_GAP, LIGHT_SIZE } from '../src/core/lights3d';
import { T5_SIZES } from '../src/model/catalogue';
import type { Electrical, ElectricalId } from '../src/model/schema';

const C = 280;
const el = (item: ElectricalId, over: Partial<Electrical> = {}): Electrical => ({
  id: 'e', kind: 'electrical', layer: 'electrical', item, x: 100, y: 200, angle: 0, ...over,
});

const topOf = (p: ReturnType<typeof lightParts>[number]) => p.z + p.h / 2;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('sockets and switches draw nothing', () => {
  for (const item of ['socket', 'socket2', 'switch1', 'tv', 'network'] as ElectricalId[]) {
    assert.deepEqual(lightParts(el(item), C), [], item);
  }
});

test('every fitting stays under the ceiling and has something that glows', () => {
  for (const item of ['downlight', 'spotlight', 'ceilingLight', 'pendant', 'wallLight', 'batten'] as ElectricalId[]) {
    // A stored elevation from a taller ceiling must not push it through this one.
    const parts = lightParts(el(item, { elevation: 400 }), C);
    assert.ok(parts.length > 0, item);
    for (const p of parts) assert.ok(topOf(p) <= C - CEILING_GAP + 1e-9, `${item} pokes through: ${topOf(p)}`);
    assert.ok(parts.some(p => p.glow), item);
  }
});

test('a downlight is flush with the ceiling, centred on its symbol, lens below the trim', () => {
  const [trim, lens] = lightParts(el('downlight'), C);
  assert.equal(trim.shape, 'cylinder');
  assert.equal(lens.shape, 'cylinder');
  assert.ok(near(topOf(trim), C - CEILING_GAP));
  assert.deepEqual([lens.x, lens.y], [100, 200]);
  assert.ok(topOf(lens) < trim.z - trim.h / 2 + 1e-9, 'lens must sit below the trim, not inside it');
  assert.ok(!trim.glow && lens.glow);
});

test('the ceiling is the one passed in, not the catalogue elevation', () => {
  const [trim] = lightParts(el('downlight', { elevation: 270 }), 300);
  assert.ok(near(topOf(trim), 300 - CEILING_GAP));
});

test('a pendant hangs at its elevation on a cord that reaches the ceiling', () => {
  const parts = lightParts(el('pendant', { elevation: 200 }), C);
  const cord = parts.find(p => p.shape === 'cylinder' && p.r === LIGHT_SIZE.pendant.cord)!;
  const shade = parts[0];
  assert.ok(near(topOf(cord), C - CEILING_GAP));
  assert.ok(near(cord.z - cord.h / 2, topOf(shade)), 'the cord ends on the shade');
  assert.equal(shade.z, 200);
});

test('a T5 runs along the symbol, is as long as its size, and stands off the wall on its lit side', () => {
  // angle 0: the tube runs along +x and lights local -y (into the room above a bottom wall).
  const [b] = lightParts(el('batten', { size: 2 }), C);
  assert.equal(b.shape, 'box');
  if (b.shape !== 'box') return;
  assert.equal(b.w, T5_SIZES[2].length);
  assert.equal(b.angle, 0);
  assert.ok(near(b.x, 100));
  assert.ok(near(b.y, 200 - LIGHT_SIZE.batten.d / 2), `y ${b.y}`);
  // Default height: just under the ceiling, like the maths assumes.
  assert.ok(b.z < C && b.z > C - 30);

  // Turned 90°: runs along y and lights +x.
  const [r] = lightParts(el('batten', { angle: 90 }), C);
  if (r.shape !== 'box') return assert.fail();
  assert.ok(near(r.x, 100 + LIGHT_SIZE.batten.d / 2), `x ${r.x}`);
  assert.ok(near(r.y, 200));
  assert.equal(r.angle, 90);
  assert.equal(r.w, T5_SIZES[4].length);   // default size
});

test('a wall light sits at its elevation, off the wall', () => {
  const [w] = lightParts(el('wallLight', { elevation: 170, angle: 180 }), C);
  if (w.shape !== 'box') return assert.fail();
  assert.equal(w.z, 170);
  assert.ok(near(w.y, 200 + LIGHT_SIZE.wallLight.d / 2), `faces +y when turned 180°: ${w.y}`);
});

test('an exhaust fan is a flat panel on the ceiling that does not glow', () => {
  const [p] = lightParts(el('exhaust'), C);
  assert.equal(p.glow, false);
  assert.ok(near(topOf(p), C - CEILING_GAP));
});

test('an elevation of 0 does not bury a fitting in the floor', () => {
  // The properties panel allows 0 for a pendant, a wall light and a T5.
  for (const item of ['pendant', 'wallLight', 'batten'] as ElectricalId[]) {
    for (const p of lightParts(el(item, { elevation: 0 }), C)) {
      assert.ok(p.z - p.h / 2 >= -1e-9, `${item} part bottom at ${p.z - p.h / 2}`);
    }
  }
});
