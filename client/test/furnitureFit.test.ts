import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archetypeFor, footprintScale, modelKey } from '../src/core/furnitureFit';

const scanOf = (name: string) => archetypeFor(name)?.scan;

test('wood takes the veneer, colour and all', () => {
  for (const n of ['wood', 'woodDark', 'DarkWood', 'Wood2']) {
    assert.equal(scanOf(n), 'veneer_oak', n);
    assert.equal(archetypeFor(n)?.colour, true, n);
  }
});

test('Quaternius names upholstery by the object, and it still gets the weave', () => {
  for (const n of ['Comforter', 'PillowCover', 'Mattress']) assert.equal(scanOf(n), 'weave', n);
});

test('a lamp shade named Light is fabric, LightMetal is metal, a bulb stays bare', () => {
  assert.equal(scanOf('Light'), 'linen');
  assert.equal(scanOf('LightMetal'), 'metal_brushed');
  assert.equal(archetypeFor('Bulb')?.scan, undefined);
  assert.equal(archetypeFor('Bulb')?.rough, 0.35);
});

test('a colour that starts with Light is not a light fitting', () => {
  // the 「LightOrange 撞上 /light/」 trap: it must not land on the untextured bulb row
  assert.equal(scanOf('LightOrange'), 'beige');
  assert.equal(scanOf('LightOrange') === 'linen', false);   // not a shade either
});

test('an unnamed glTF material falls to painted board; a truly empty name gets nothing', () => {
  assert.equal(scanOf('_defaultMat'), 'beige');
  assert.equal(archetypeFor(''), undefined);
  assert.equal(archetypeFor(undefined), undefined);
});

test('a model fills its footprint per axis, and stretching never makes it taller', () => {
  // Kenney's 54 cm kitchen run stretched to the catalogue's 180
  assert.deepEqual(footprintScale({ x: 54, z: 60 }, 180, 60), { x: 180 / 54, y: 1, z: 1 });
  assert.deepEqual(footprintScale({ x: 100, z: 50 }, 50, 50), { x: 0.5, y: 0.5, z: 1 });
});

test('a model with no measured width does not divide by zero', () => {
  assert.deepEqual(footprintScale({ x: 0, z: 0 }, 80, 40), { x: 80, y: 40, z: 40 });
});

test('the cache key rounds to whole centimetres and starts with the item', () => {
  assert.equal(modelKey('sofa', 199.6, 90.4), 'sofa|200|90');
  assert.ok(modelKey('sofa', 1, 1).startsWith('sofa|'));
});
