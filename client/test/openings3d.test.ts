import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// 3D 建模會去要貼圖：沒有網路就安靜地退回純色，測試不該等真的連線。
(globalThis as any).document ??= { baseURI: 'http://localhost/' };
(globalThis as any).fetch = async () => { throw new Error('offline'); };

const { buildDoor3D, buildWindow3D } = await import('../src/core/openings3d');

// 一塊 transmission 玻璃就讓 three.js 每幀把所有不透明物件多畫一次（A1：1906 → 1280 次繪製），
// 而且曾經讓玻璃門後面整片變黑、全景圖黑掉四分之一。門窗玻璃一律用一般的半透明。
test('門窗的玻璃不用 transmission', () => {
  const groups = [
    ...['single', 'double', 'sliding', 'glass'].map(s => buildDoor3D(90, 210, 0, s)),
    ...['single', 'casement', 'sliding', 'picture'].map(s => buildWindow3D(120, 120, 90, s)),
  ];
  let glassy = 0;
  for (const g of groups) g.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
    if (!m) return;
    assert.ok(!(m.transmission > 0), `${o.parent?.type} 有一塊 transmission ${m.transmission} 的材質`);
    if (m.transparent && m.opacity < 1) glassy++;
  });
  assert.ok(glassy >= 4, `玻璃還在（半透明的面 ${glassy} 塊）`);
});

test('整個 client 沒有 transmission 材質（弧牆的窗、障子紙也是）', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../src/core/', import.meta.url);
  const hits = readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'panorama.ts')
    .filter(f => /transmission\s*:/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(hits, [], '用 paneGlass() 或 transparent＋opacity');
});
