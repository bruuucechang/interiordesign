// B31：A1 → A1 豪宅版 的轉換（client/src/data/luxuryPlan.ts）。
//
// 真的 A1 在資料庫裡、不進 repo（這個 repo 是公開的），所以這裡用一份只有轉換會碰到的
// 物件的小方案驗規則；「A1 豪宅版每間房照明提醒為 0」由 bench/make-luxury.mjs（寫之前驗）
// 與 bench/verify-luxury.mjs 的 B31 段在真的資料上驗。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLuxury, LUXURY_ID, LUXURY_NAME, SOURCE_ID, WALL_COLOR, FLOOR_OAK } from '../src/data/luxuryPlan';
import { FURNITURE_BY_ID } from '../src/data/furniture';
import { ELECTRICAL_BY_ID } from '../src/model/catalogue';
import { MATERIALS } from '../src/core/materials';
import type { Furniture, Obj, Project } from '../src/model/schema';

const src = (): Project => ({
  schemaVersion: 1, id: SOURCE_ID, name: 'A1', activeFloorId: 'f1', layers: [],
  floors: [{
    id: 'f1', name: '1F', elevation: 0, height: 300, objects: [
      { id: 'w', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 15 },
      { id: 'r', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 100, h: 100, name: '房', floor: 'wood' },
      { id: 'rb', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 100, h: 100, name: '浴', floor: 'tile' },
      { id: 'dl', kind: 'electrical', layer: 'electrical', item: 'downlight', x: 10, y: 10, angle: 0 },
      { id: 't5', kind: 'electrical', layer: 'electrical', item: 'batten', x: 10, y: 10, angle: 0, size: 4 },
      { id: 'sk', kind: 'electrical', layer: 'electrical', item: 'socket', x: 10, y: 10, angle: 0 },
      { id: 'b', kind: 'furniture', layer: 'furniture', item: 'bed_double', label: '床', x: 0, y: 0, w: 152, h: 188, angle: 90 },
      { id: 'wn', kind: 'furniture', layer: 'furniture', item: 'wardrobe', label: '櫃子', x: 0, y: 0, w: 60, h: 60, angle: 0, height: 300, elevation: 0 },
      { id: 'ww', kind: 'furniture', layer: 'furniture', item: 'wardrobe', label: '衣櫃', x: 0, y: 0, w: 243, h: 64, angle: 0, height: 300, elevation: 0 },
      { id: 'b6_kit_counter_s', kind: 'furniture', layer: 'furniture', item: 'cabinet_kitchen', label: '流理台', x: 244.1, y: 1167, w: 307.1, h: 59.8, angle: 180 },
      { id: 'b5_fb7', kind: 'furniture', layer: 'furniture', item: 'wardrobe', label: '櫃子', x: 1148.5, y: 20, w: 60, h: 50, angle: 90, height: 300, elevation: 0 },
    ] as Obj[],
  }],
});

const objs = (p: Project) => p.floors[0].objects;
const byId = (p: Project, id: string) => objs(p).find(o => o.id === id)!;

test('另存成豪宅版的 id 與名字，A1 本身一個字都不變', () => {
  const a = src(), before = JSON.stringify(a);
  const lx = makeLuxury(a);
  assert.equal(JSON.stringify(a), before);
  assert.equal(lx.id, LUXURY_ID);
  assert.equal(lx.name, LUXURY_NAME);
  assert.notEqual(LUXURY_ID, SOURCE_ID);
});

test('舊的嵌燈與 T5 全拿掉，其他水電（插座）留著；新燈都是目錄裡的線燈或崁燈', () => {
  const lx = makeLuxury(src());
  const e = objs(lx).filter(o => o.kind === 'electrical');
  assert.ok(!e.some(o => o.item === 'downlight' || o.item === 'batten'));
  assert.ok(e.some(o => o.id === 'sk'));
  const lights = e.filter(o => o.id !== 'sk');
  assert.ok(lights.length > 30);
  for (const o of lights) {
    assert.ok(ELECTRICAL_BY_ID[o.item], `${o.id} ${o.item} 不在目錄裡`);
    assert.match(o.item, /^(linear|dl)/, `${o.id} 用了 ${o.item}`);
  }
  assert.equal(new Set(e.map(o => o.id)).size, e.length, '燈的 id 不能重複');
});

test('傢俱換成溫潤奢華款：位置尺寸照原樣，頂天櫃的高度留著', () => {
  const lx = makeLuxury(src());
  const bed = byId(lx, 'b') as Furniture;
  assert.equal(bed.item, 'bed_lx');
  assert.deepEqual([bed.x, bed.y, bed.w, bed.h, bed.angle], [0, 0, 152, 188, 90]);
  const narrow = byId(lx, 'wn'), wide = byId(lx, 'ww');
  assert.equal(narrow.kind === 'furniture' && narrow.item, 'wardrobe_lx');
  assert.equal(wide.kind === 'furniture' && wide.item, 'wardrobe_lx_slide');
  assert.equal(wide.kind === 'furniture' && wide.height, 300);
  for (const o of objs(lx)) if (o.kind === 'furniture') assert.ok(FURNITURE_BY_ID[o.item], `${o.id} 的 ${o.item} 不在目錄裡`);
});

test('南側流理台拆成下櫃｜水槽｜下櫃｜爐台，不跟新款水槽、爐台疊在一起', () => {
  const lx = makeLuxury(src());
  const s = byId(lx, 'b6_kit_counter_s'), mid = byId(lx, 'lx_kit_counter_mid');
  assert.ok(s.kind === 'furniture' && mid.kind === 'furniture');
  if (s.kind !== 'furniture' || mid.kind !== 'furniture') return;
  assert.equal(s.x + s.w, 295);         // 接到水槽（A1 的水槽 x 295～366）
  assert.equal(mid.x, 366);
  assert.equal(mid.x + mid.w, 454);     // 接到爐台（A1 的爐具 x 454～551.2）
});

test('補了客餐廳：L 型沙發、茶几、電視櫃、地毯、餐桌＋4 椅', () => {
  const items = objs(makeLuxury(src())).filter(o => o.kind === 'furniture').map(o => o.kind === 'furniture' ? o.item : '');
  for (const id of ['sofa_l_lx', 'coffee_lx', 'tv_lx', 'rug_lx', 'dining_lx']) assert.equal(items.filter(i => i === id).length, 1, id);
  assert.equal(items.filter(i => i === 'chair_lx').length, 4);
});

test('木地板換淡橡木、衛浴的磚照舊；牆面米白', () => {
  const lx = makeLuxury(src());
  const r = byId(lx, 'r'), rb = byId(lx, 'rb'), w = byId(lx, 'w');
  assert.equal(r.kind === 'room' && r.floor, FLOOR_OAK);
  assert.equal(rb.kind === 'room' && rb.floor, 'tile');
  assert.equal(w.kind === 'wall' && w.color, WALL_COLOR);
  assert.ok(MATERIALS.some(m => m.id === FLOOR_OAK && m.category === 'floor'), '淡橡木要是登記過的地板材質');
});
