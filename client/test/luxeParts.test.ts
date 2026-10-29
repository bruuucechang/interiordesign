import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// 3D 建模會去要貼圖：沒有網路就安靜地退回純色，測試不該等真的連線。
(globalThis as any).document ??= { baseURI: 'http://localhost/' };
(globalThis as any).fetch = async () => { throw new Error('offline'); };

const { LUXE_PARTS, partsBounds, doorCount, slideLeaves, GAP } = await import('../src/core/luxeParts');
const { FURNITURE, FURNITURE_BY_ID } = await import('../src/data/furniture');
const { BUILDERS } = await import('../src/core/furnitureBuilders');
const { needsFor } = await import('../src/core/health');
const { isBed, isDesk } = await import('../src/core/lightzones');
const { COUNTER_ITEMS, COUNTER_TOP, VANITY_ITEMS } = await import('../src/model/catalogue');

const ids = Object.keys(LUXE_PARTS);
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

test('溫潤奢華：零件表與目錄一對一', () => {
  const tagged = FURNITURE.filter(f => f.style === '溫潤奢華').map(f => f.id).sort();
  assert.deepEqual(tagged, [...ids].sort());
  assert.ok(ids.length >= 18, `規格列了 18 種，現在 ${ids.length}`);
  for (const id of ids) {
    const f = FURNITURE_BY_ID[id];
    assert.equal(f.proc, true, `${id} 沒有實掃模型，要標 proc（不然目錄會去要 thumb.png）`);
    assert.ok(f.height && f.height > 0, `${id} 要寫高度：3D 是照目錄高度拉伸的`);
  }
});

// 目錄尺寸、縮小放大各一次，再加上 A1 實際用到的長櫃（243、307cm）：
// 外框要剛好填滿寬×深×高，沒有零件伸出去。
const sizesOf = (w: number, h: number): [number, number][] =>
  [[w, h], [w * 0.75, h], [w * 1.6, h], [w, h * 0.8], [w, h * 1.25], [243, h], [307, h]].filter(([a]) => a >= 30) as [number, number][];

test('每一件的外框剛好是目錄的寬、深、高', () => {
  for (const id of ids) {
    const f = FURNITURE_BY_ID[id], H = f.height!;
    for (const [w, h] of sizesOf(f.w, f.h)) {
      const parts = LUXE_PARTS[id](w, h, H);
      const b = partsBounds(parts)!;
      const at = `${id} ${w}×${h}×${H}`;
      assert.ok(near(b.x[0], -w / 2) && near(b.x[1], w / 2), `${at}：x ${b.x}`);
      assert.ok(near(b.z[0], -h / 2) && near(b.z[1], h / 2), `${at}：z ${b.z}`);
      assert.ok(near(b.y[1], H), `${at}：最高 ${b.y[1]}`);
      // 3D 的高度是從最低點量到最高點（furniture3d getModelHeight）：懸空的會被拉長
      assert.ok(near(b.y[0], 0), `${at}：最低點在 ${b.y[0]}，不是地板`);
      for (const p of parts) {
        for (const k of ['x', 'y', 'z'] as const) assert.ok(p[k][1] > p[k][0], `${at}：${p.mat} 的 ${k} 是空的 ${p[k]}`);
      }
    }
  }
});

test('門片數：每扇 41～69cm，推拉至少兩片', () => {
  assert.equal(doorCount(120), 2);
  assert.equal(doorCount(243), 4);
  assert.equal(doorCount(300), 5);
  assert.equal(doorCount(30), 1);
  for (let w = 90; w <= 320; w += 5) {
    const leaf = w / doorCount(w);
    assert.ok(leaf >= 41 && leaf <= 69, `${w}cm 分 ${doorCount(w)} 扇，一扇 ${leaf.toFixed(1)}`);
  }
  assert.equal(slideLeaves(120), 2);
  assert.equal(slideLeaves(180), 2);
  assert.equal(slideLeaves(300), 3);
});

test('對開衣櫃的門片照寬度分，門縫 6mm', () => {
  for (const w of [120, 243, 300]) {
    const parts = LUXE_PARTS.wardrobe_lx(w, 60, 240);
    const doors = parts.filter(p => p.mat === 'oak' && p.z[0] > 0).sort((a, b) => a.x[0] - b.x[0]);
    assert.equal(doors.length, doorCount(w), `${w}cm`);
    for (let i = 1; i < doors.length; i++) assert.ok(near(doors[i].x[0] - doors[i - 1].x[1], GAP), `${w}cm 第 ${i} 條縫`);
    assert.equal(parts.filter(p => p.mat === 'champagne').length, doors.length, '每扇一條嵌入拉溝、沒有把手');
  }
});

// 拉溝是讀出「這是門」的那一條：被前面的零件整條擋住就等於沒有（推拉衣櫃的後軌門片曾經這樣）
test('香檳金屬拉溝沒有被前面的零件整條擋住', () => {
  for (const id of ids) {
    const f = FURNITURE_BY_ID[id];
    for (const [w, h] of sizesOf(f.w, f.h)) {
      const parts = LUXE_PARTS[id](w, h, f.height!);
      for (const c of parts.filter(p => p.mat === 'champagne')) {
        const cover = parts.find(p => p !== c && p.mat !== 'glass' && p.z[0] >= c.z[1] - 0.001
          && p.x[0] <= c.x[0] && p.x[1] >= c.x[1] && p.y[0] <= c.y[0] && p.y[1] >= c.y[1]);
        assert.ok(!cover, `${id} ${w}×${h}：x ${c.x} y ${c.y} 的金屬被 ${cover?.mat} x ${cover?.x} 擋住`);
      }
    }
  }
});

test('水槽流理台的檯面在 90，龍頭高出去的部分不算檯面', () => {
  const parts = LUXE_PARTS.cabinet_kitchen_lx_sink(120, 60, FURNITURE_BY_ID.cabinet_kitchen_lx_sink.height!);
  const top = parts.find(p => p.mat === 'stone')!;
  assert.equal(top.y[1], COUNTER_TOP.cabinet_kitchen_lx_sink);
  for (const id of ['cabinet_kitchen_lx', 'cabinet_kitchen_lx_hob', 'kitchen_island_lx']) {
    const H = FURNITURE_BY_ID[id].height!;
    const top = Math.max(...LUXE_PARTS[id](180, 60, H).filter(p => p.mat === 'stone' || p.mat === 'hob').map(p => p.y[1]));
    assert.equal(top, H, id);
  }
});

test('新款照舊被健檢與照明分區認得', () => {
  assert.ok(isBed('bed_lx') && needsFor('bed_lx'));
  assert.ok(isDesk('desk_lx'));
  for (const id of ['wardrobe_lx', 'wardrobe_lx_slide', 'toilet_lx', 'vanity_lx', 'fridge_lx', 'dining_lx']) assert.ok(needsFor(id), id);
  assert.match('shower_lx', /^shower(_|$)/);
  for (const id of ['cabinet_kitchen_lx', 'cabinet_kitchen_lx_sink', 'cabinet_kitchen_lx_hob', 'kitchen_island_lx']) assert.ok(COUNTER_ITEMS.has(id), id);
  assert.ok(VANITY_ITEMS.has('vanity_lx'));
});

test('3D 建得出來，外框跟目錄尺寸一樣', () => {
  for (const id of ids) {
    const f = FURNITURE_BY_ID[id];
    const g = BUILDERS[id](f.w, f.h);
    let meshes = 0;
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes++; });
    assert.ok(meshes >= 2, `${id} 只有 ${meshes} 塊`);
    const box = new THREE.Box3().setFromObject(g);
    const at = `${id}：${(box.max.x - box.min.x).toFixed(1)}×${(box.max.z - box.min.z).toFixed(1)}×${box.max.y.toFixed(1)}`;
    // 圓角盒子最小 1cm、圓柱最小 0.5cm：薄零件最多撐出去半公分
    assert.ok(near(box.max.x - box.min.x, f.w, 1), at);
    assert.ok(near(box.max.z - box.min.z, f.h, 1), at);
    assert.ok(near(box.max.y, f.height!, 1), at);
  }
});
