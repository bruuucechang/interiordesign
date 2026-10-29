import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quietInk, hatchShown, inkPitch, keepsLampInk } from '../src/core/planInk';
import { FURNITURE } from '../src/data/furniture';

test('the pictograms\' amber becomes grey, alpha kept', () => {
  assert.equal(quietInk('#e0b45a'), '#a39d90');
  assert.equal(quietInk('#e0b45a88'), '#a39d9088');
  assert.equal(quietInk('#E0B45A'), '#a39d90');
  assert.equal(quietInk('#f0c869'), '#b3ad9f');
});

test('every other colour passes through: bodies, glass blue, plants, gradients', () => {
  for (const c of ['#3a4150', '#7bc6ff', '#47c479', 'rgba(1,2,3,0.5)', '#ffd166']) assert.equal(quietInk(c), c);
  const grad = {};
  assert.equal(quietInk(grad), grad);
});

test('no catalogue pictogram but the lamps keeps a yellow on the plan', () => {
  // Draw every real catalogue item into a recording context through quietInk.
  const yellow = /^#(e0b45a|f0c869|ffd98a|c9c07a|d9c49a)/i;
  const seen = new Map<string, Set<string>>(), thrown: string[] = [];
  for (const f of FURNITURE) {
    const mine = new Set<string>(); seen.set(f.id, mine);
    const rec: any = new Proxy({}, {
      get: (t: any, k) => (k in t ? t[k] : () => rec),
      set: (t: any, k, v) => { if (k === 'strokeStyle' || k === 'fillStyle') { const q = keepsLampInk(f) ? v : quietInk(v); if (typeof q === 'string') mine.add(q); } t[k] = v; return true; },
    });
    try { f.draw(rec, f.w, f.h); } catch { thrown.push(f.id); }
  }
  assert.deepEqual(thrown, [], 'every pictogram draws against the recorder');
  const bad = FURNITURE.filter(f => !keepsLampInk(f) && [...seen.get(f.id)!].some(c => yellow.test(c))).map(f => f.id);
  assert.deepEqual(bad, []);
  // And the lamps really are still yellow — a ceiling lamp and a floor lamp, by name.
  for (const name of ['吸頂燈', '立燈']) {
    const lamp = FURNITURE.find(f => f.name === name && f.cat === '燈具');
    assert.ok(lamp, name);
    assert.ok([...seen.get(lamp!.id)!].some(c => yellow.test(c)), `${name} keeps its yellow`);
  }
});

test('lamps keep their ink, ceiling fans do not', () => {
  assert.equal(keepsLampInk({ cat: '燈具', name: '吸頂燈' }), true);
  assert.equal(keepsLampInk({ cat: '燈具', name: '吊扇' }), false);
  assert.equal(keepsLampInk({ cat: '臥室', name: '衣櫃' }), false);
  const fans = FURNITURE.filter(f => f.cat === '燈具' && /扇/.test(f.name));
  assert.ok(fans.length >= 1, 'the catalogue has a ceiling fan under 燈具');
});

test('a hatch is drawn only once its marks are far enough apart on screen', () => {
  assert.equal(hatchShown(30, 0.5), false);    // A1's planks, whole flat in 2D: 15 px stripes
  assert.equal(hatchShown(30, 1.1), true);     // zoomed in: 33 px
  assert.equal(hatchShown(64, 0.5), true);     // 60 cm tiles at the same zoom: a 32 px grid
  assert.equal(hatchShown(25, 0.8), true);     // exactly 20 px
  assert.equal(hatchShown(0, 6), false);
  assert.equal(hatchShown(Infinity, 0.05), true);
});

const tile = (size: number, ink: (x: number, y: number) => boolean) => {
  const a = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) a[y * size + x] = ink(x, y) ? 255 : 0;
  return a;
};

test('pitch of parallel lines is their spacing, whichever way they run', () => {
  assert.equal(inkPitch(tile(64, (x) => x % 8 === 0), 64), 8);
  assert.equal(inkPitch(tile(64, (_, y) => y % 16 < 2), 64), 16);   // 2 px thick lines still count once
});

test('a grid takes its closer axis; an empty tile has no pitch', () => {
  // An average, so the rows a crossing line fills nudge it a little: about 16, not 32.
  const g = inkPitch(tile(64, (x, y) => x % 16 === 0 || y % 32 === 0), 64);
  assert.ok(Math.abs(g - 16) < 1.6, String(g));
  assert.equal(inkPitch(tile(64, () => false), 64), Infinity);
});
