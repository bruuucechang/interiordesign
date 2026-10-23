import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// The module resolves its scan folder against the page at import time; tiled()
// itself never touches the DOM.
(globalThis as any).document ??= { baseURI: 'http://localhost/' };
const { tiled } = await import('../src/core/textures3d');

// A cached 512² image, as source() hands it out: already flagged for upload once.
const cached = () => {
  const t = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
};

test('a tiled copy shares the image and its own repeat', () => {
  const src = cached();
  const a = tiled(src, 3, 2), b = tiled(src, 0.5, 1);
  assert.equal(a.source, src.source);
  assert.equal(b.source, src.source);
  assert.deepEqual([a.repeat.x, a.repeat.y], [3, 2]);
  assert.deepEqual([b.repeat.x, b.repeat.y], [0.5, 1]);
  assert.deepEqual([src.repeat.x, src.repeat.y], [1, 1]);
});

// The GPU upload is kept per source and redone whenever source.version moves.
// Texture.clone() bumps it, so every rebuild re-sent every wall's image (B15).
test('tiling a cached image does not mark it for re-upload', () => {
  const src = cached();
  const before = src.source.version;
  for (let i = 0; i < 14; i++) tiled(src, i + 1, 1);
  assert.equal(src.source.version, before);
});

// The copy itself still has to go through the upload path once, to be bound to
// the shared GPU texture — that path is what skips the image when the source
// version already matches.
test('the copy is still a texture the renderer will set up', () => {
  assert.ok(tiled(cached(), 1, 1).version > 0);
});
