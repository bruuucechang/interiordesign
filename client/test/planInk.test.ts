import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quietInk, hatchShown, inkPitch } from '../src/core/planInk';
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

test('no catalogue pictogram keeps an amber stroke on the plan', () => {
  // Draw every real catalogue item into a recording context through quietInk.
  const amber = /^#(e0b45a|f0c869|ffd98a)/i;
  const seen = new Set<string>();
  const rec: any = new Proxy({}, {
    get: (t: any, k) => (k in t ? t[k] : () => rec),
    set: (t: any, k, v) => { if (k === 'strokeStyle' || k === 'fillStyle') { const q = quietInk(v); if (typeof q === 'string') seen.add(q); } t[k] = v; return true; },
  });
  for (const f of FURNITURE) { try { f.draw(rec, f.w, f.h); } catch { /* a pictogram needing real canvas API is not a colour question */ } }
  assert.ok(seen.size > 5, 'the recorder saw colours');
  assert.deepEqual([...seen].filter(c => amber.test(c)), []);
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
