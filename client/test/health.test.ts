import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlan, visible, needsFor } from '../src/core/health';
import { CLEARANCE } from '../src/model/locale-defaults';
import { Obj } from '../src/model/schema';

// 空間健檢。
//
// 這一組測試最重要的一半是**誤報**，不是漏抓。一個會唸對的東西的清單，使用者會學會
// 忽略整個清單——之後真的抓到問題的那一次也一起被忽略掉。所以每一條「該抓到」的
// 旁邊都有一條「不該抓到」。

const wall = (id: string, ax: number, ay: number, bx: number, by: number, thickness = 12): Obj =>
  ({ id, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness }) as Obj;

const furn = (id: string, item: string, x: number, y: number, w: number, h: number, angle = 0): Obj =>
  ({ id, kind: 'furniture', layer: 'furniture', item, x, y, w, h, angle, label: item }) as Obj;

const room = (id: string, x: number, y: number, w: number, h: number): Obj =>
  ({ id, kind: 'room', layer: 'rooms', x, y, w, h, name: '房間' }) as Obj;

/** 一個 6×4 公尺的封閉房間，牆端點都真的接在一起。 */
const BOX = [
  wall('w1', 0, 0, 600, 0),
  wall('w2', 600, 0, 600, 400),
  wall('w3', 600, 400, 0, 400),
  wall('w4', 0, 400, 0, 0),
  room('r1', 0, 0, 600, 400),
];

const rulesIn = (f: ReturnType<typeof checkPlan>) => [...new Set(f.map(x => x.rule))].sort();

// ---- 甲：牆端點沒接上（design-rules.md 1.6） ----

test('牆端差幾公分沒接上，要抓出來並說出差多少', () => {
  const f = checkPlan([wall('a', 0, 0, 300, 0), wall('b', 305, 0, 305, 200)]);
  const join = f.filter(x => x.rule === 'wall-join');
  assert.ok(join.length >= 1, '沒抓到');
  assert.match(join[0].detail, /5cm/);
  assert.equal(join[0].fix?.kind, 'joinWall', '這一條要能一鍵修正');
});

test('端點真的接在一起就不該唸', () => {
  assert.deepEqual(checkPlan(BOX).filter(x => x.rule === 'wall-join'), []);
});

test('一道離所有東西都很遠的牆不算沒接上', () => {
  // 量一段長度、標一個尺寸用的獨立牆體，離誰都遠——唸它就是誤報
  const f = checkPlan([wall('a', 0, 0, 300, 0), wall('b', 2000, 2000, 2300, 2000)]);
  assert.deepEqual(f.filter(x => x.rule === 'wall-join'), []);
});

test('一鍵修正指向的是它本來要接的那個點', () => {
  const f = checkPlan([wall('a', 0, 0, 300, 0), wall('b', 306, 0, 306, 200)]);
  const fix = f.find(x => x.rule === 'wall-join')?.fix;
  assert.ok(fix && fix.kind === 'joinWall');
  if (fix.kind === 'joinWall') {
    assert.equal(fix.wallId, 'a');
    assert.equal(fix.end, 'b');
    assert.ok(Math.abs(fix.to.x - 306) < 0.01 && Math.abs(fix.to.y - 0) < 0.01, JSON.stringify(fix.to));
  }
});

test('畫了牆卻一個房間都沒有，要說一聲', () => {
  const f = checkPlan([wall('a', 0, 0, 600, 0), wall('b', 600, 0, 600, 400), wall('c', 600, 400, 0, 400)]);
  assert.ok(f.some(x => x.rule === 'no-rooms'));
});

test('有房間就不該再唸這一條', () => {
  assert.ok(!checkPlan(BOX).some(x => x.rule === 'no-rooms'));
});

// ---- 乙：淨距 ----

test('床兩側都貼牆，要抓', () => {
  // 房間 600 寬，床 152 寬，貼左牆放：左側 0、右側還有 448
  const tight = [...BOX, furn('bed', 'bed_double', 6, 100, 152, 188)];
  const loose = checkPlan(tight).filter(x => x.rule === 'clearance-any');
  assert.equal(loose.length, 0, '右側還有幾百公分，這樣不該唸');

  // 塞進一個 170 寬的凹室：兩側都不到 70
  const alcove: Obj[] = [
    wall('n1', 0, 0, 170, 0), wall('n2', 170, 0, 170, 300),
    wall('n3', 170, 300, 0, 300), wall('n4', 0, 300, 0, 0),
    room('nr', 0, 0, 170, 300),
    furn('bed', 'bed_double', 9, 50, 152, 188),
  ];
  const f = checkPlan(alcove).filter(x => x.rule === 'clearance-any');
  assert.equal(f.length, 1, JSON.stringify(f.map(x => x.detail)));
  assert.match(f[0].title, /床邊/);
  assert.match(f[0].detail, new RegExp(`${CLEARANCE.bedSide}`));
});

test('馬桶兩側是「每一側都要」，不是「至少一側」', () => {
  const n = needsFor('toilet');
  assert.ok(n?.allOf, '馬桶要用 allOf');
  assert.ok(!needsFor('toilet')?.anyOf);
  assert.ok(needsFor('bed_double')?.anyOf, '床要用 anyOf');
});

test('目錄上沒有標需求的品項完全不檢查', () => {
  assert.equal(needsFor('sofa'), null);
  assert.equal(needsFor('lamp_table'), null);
  // 沙發貼著茶几是對的，任何唸它的規則都是誤報
  const f = checkPlan([...BOX, furn('s', 'sofa', 100, 100, 210, 90), furn('t', 'cn_teatable', 100, 200, 90, 60)]);
  assert.deepEqual(f.filter(x => x.rule.startsWith('clearance')), []);
});

test('同系列的 id 共用一條規則', () => {
  for (const id of ['bed_double', 'bed_single', 'bed_kids']) assert.ok(needsFor(id), id);
  for (const id of ['toilet', 'toilet_square']) assert.ok(needsFor(id), id);
});

// ---- 門前、迷路的家具 ----

test('門前被矮櫃擋住要抓，門前空著不抓', () => {
  const door: Obj = { id: 'd', kind: 'door', layer: 'openings', x: 300, y: 0, width: 90, angle: 0 } as Obj;
  const clear = checkPlan([...BOX, door]);
  assert.deepEqual(clear.filter(x => x.rule === 'door-swing'), []);
  const blocked = checkPlan([...BOX, door, furn('c', 'shoe_cabinet', 260, 30, 130, 35)]);
  assert.equal(blocked.filter(x => x.rule === 'door-swing').length, 1);
});

test('家具掉在所有房間外面要抓', () => {
  const f = checkPlan([...BOX, furn('x', 'sofa', 2000, 2000, 210, 90)]);
  assert.equal(f.filter(x => x.rule === 'stray').length, 1);
});

test('沒有任何房間的時候不要每一件家具都唸一次', () => {
  const f = checkPlan([furn('x', 'sofa', 0, 0, 210, 90)]);
  assert.deepEqual(f.filter(x => x.rule === 'stray'), []);
});

// ---- 空白與忽略 ----

test('空白的圖一條提醒都沒有', () => {
  assert.deepEqual(checkPlan([]), []);
});

test('只放了一件家具、還沒畫牆，不該被唸', () => {
  assert.deepEqual(rulesIn(checkPlan([furn('a', 'bed_double', 0, 0, 152, 188)])), []);
});

test('忽略過的不再出現', () => {
  const f = checkPlan([wall('a', 0, 0, 300, 0), wall('b', 305, 0, 305, 200)]);
  assert.ok(f.length > 0);
  assert.deepEqual(visible(f, new Set(f.map(x => x.id))), []);
});

test('finding 的 id 在無關的編輯之後保持不變', () => {
  const base = [wall('a', 0, 0, 300, 0), wall('b', 305, 0, 305, 200)];
  const before = checkPlan(base).find(x => x.rule === 'wall-join')!.id;
  // 在完全不相干的地方加一件家具
  const after = checkPlan([...base, furn('s', 'sofa', 1000, 1000, 210, 90)]).find(x => x.rule === 'wall-join')!.id;
  assert.equal(after, before, 'id 變了的話，忽略就會自己失效');
});

test('真的動到那個問題本身，id 就變了（忽略自然失效）', () => {
  const a = checkPlan([wall('a', 0, 0, 300, 0), wall('b', 305, 0, 305, 200)]).find(x => x.rule === 'wall-join')!.id;
  const b = checkPlan([wall('a', 0, 0, 300, 0), wall('b', 320, 0, 320, 200)]).find(x => x.rule === 'wall-join')!.id;
  assert.notEqual(a, b);
});

test('每一條都帶得走：標題、數字、原因、可以跳過去的物件', () => {
  const f = checkPlan([wall('a', 0, 0, 300, 0), wall('b', 305, 0, 305, 200)]);
  for (const x of f) {
    assert.ok(x.title.length > 0, 'title');
    assert.match(x.detail, /\d/, `${x.rule} 的 detail 要有數字：${x.detail}`);
    assert.ok(x.why.length > 10, `${x.rule} 要說為什麼`);
    assert.ok(x.targets.length > 0, `${x.rule} 要指得到物件`);
  }
});

test('同一道縫只報一次，不是兩端各報一次', () => {
  // 一條 5cm 的縫：a 的端點在找 b，b 的端點也在找 a
  const f = checkPlan([wall('a', 0, 0, 300, 0), wall('b', 0, 5, 0, 300)]);
  const join = f.filter(x => x.rule === 'wall-join');
  assert.equal(join.length, 1, `報了 ${join.length} 次：${join.map(x => x.detail).join(' / ')}`);
});

test('兩道不同的縫仍然各報一次', () => {
  const f = checkPlan([
    wall('a', 0, 0, 300, 0),
    wall('b', 0, 5, 0, 300),      // 左下角差 5cm
    wall('c', 308, 0, 308, 300),  // 右上角差 8cm
  ]);
  assert.equal(f.filter(x => x.rule === 'wall-join').length, 2);
});

// ---- 門窗掉在牆外面（2026-08-13 真的發生過） ----
//
// 柱子合併那一輪把 58 道牆變成 40 道，掛在被移走的 18 道牆上的 9 個門窗原地留下。
// 沒有任何東西報錯，使用者三個星期後才發現「門都跑掉了」。

test('門離最近的牆很遠，要抓出來', () => {
  const door: Obj = { id: 'd', kind: 'door', layer: 'openings', x: 300, y: 200, width: 90, angle: 0 } as Obj;
  const f = checkPlan([...BOX, door]).filter(x => x.rule === 'orphan-opening');
  assert.equal(f.length, 1);
  assert.match(f[0].title, /門不在任何牆上/);
  assert.match(f[0].detail, /\d/);
});

test('好好嵌在牆上的門窗完全不該被唸', () => {
  const door: Obj = { id: 'd', kind: 'door', layer: 'openings', x: 300, y: 0, width: 90, angle: 0 } as Obj;
  const win: Obj = { id: 'w', kind: 'window', layer: 'openings', x: 600, y: 200, width: 120, angle: 90 } as Obj;
  assert.deepEqual(checkPlan([...BOX, door, win]).filter(x => x.rule === 'orphan-opening'), []);
});

test('差幾公分沒對準不算孤兒（那是另一條規則的事）', () => {
  const door: Obj = { id: 'd', kind: 'door', layer: 'openings', x: 300, y: 12, width: 90, angle: 0 } as Obj;
  assert.deepEqual(checkPlan([...BOX, door]).filter(x => x.rule === 'orphan-opening'), []);
});

test('還沒畫牆的時候不要唸門窗', () => {
  const door: Obj = { id: 'd', kind: 'door', layer: 'openings', x: 0, y: 0, width: 90, angle: 0 } as Obj;
  assert.deepEqual(checkPlan([door]).filter(x => x.rule === 'orphan-opening'), []);
});

// ---- 乾濕分離太小（量它自己，不是量它旁邊） ----
//
// 目錄預設 90×90 正好是建議值，所以這一條只在使用者把它縮小之後才會響——而淋浴間
// 正是最常為了擠出空間被拉小的東西。

test('淋浴間短邊小於 80 要抓', () => {
  const f = checkPlan([...BOX, furn('s', 'shower', 100, 100, 78, 90)]).filter(x => x.rule === 'min-size');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /78/);
  assert.match(f[0].detail, /80/);   // 門檻要講出來
  assert.match(f[0].detail, /90/);   // 建議值也要
});

test('目錄預設的 90×90 不該被唸', () => {
  assert.deepEqual(checkPlan([...BOX, furn('s', 'shower', 100, 100, 90, 90)]).filter(x => x.rule === 'min-size'), []);
  assert.deepEqual(checkPlan([...BOX, furn('s', 'shower_round', 100, 100, 90, 90)]).filter(x => x.rule === 'min-size'), []);
});

test('80×120 的長形是建議做法，不該被唸', () => {
  assert.deepEqual(checkPlan([...BOX, furn('s', 'shower', 100, 100, 80, 120)]).filter(x => x.rule === 'min-size'), []);
});

test('淋浴門不是隔間，短邊 22cm 是對的', () => {
  // sh_shower_door 是 90×22 的門片；把它一起抓進來就是誤報
  assert.deepEqual(checkPlan([...BOX, furn('d', 'sh_shower_door', 100, 100, 90, 22)]).filter(x => x.rule === 'min-size'), []);
});

test('轉過角度不影響短邊的判斷', () => {
  const f = checkPlan([...BOX, furn('s', 'shower', 100, 100, 78, 90, 45)]).filter(x => x.rule === 'min-size');
  assert.equal(f.length, 1);
});

// ---- 戊：照明（docs/lighting-spec.md「區域與檢查」） ----
//
// 原型的兩間臥室在 lightzones.test.ts 對過數字；這裡每條規則各一對「該抓到／不該
// 抓到」，房間是上面那間 6×4 公尺、12 公分牆。

const lamp = (id: string, item: string, x: number, y: number, more: Record<string, unknown> = {}): Obj =>
  ({ id, kind: 'electrical', layer: 'electrical', item, x, y, angle: 0, ...more }) as Obj;
const tall = (id: string, x: number, y: number, w: number, h: number, height = 280): Obj =>
  ({ ...furn(id, 'wardrobe', x, y, w, h), label: '衣櫃', height }) as Obj;
const ofRule = (objs: Obj[], rule: string) => checkPlan(objs, 280).filter(x => x.rule === rule);
/** 平均鋪滿 6 盞 1200 lm 的崁燈：整間約 160 lux、均勻度約 0.6——一般照明夠，寫字不夠。 */
const EVEN = [100, 300, 500].flatMap((x, i) => [100, 300].map(y => lamp(`g${i}${y}`, 'downlight', x, y, { lumens: 1200 })));

test('照明：一盞燈都沒有的房間完全不檢查照明，床和書桌放著也不唸', () => {
  const f = checkPlan([...BOX, furn('b', 'bed_double', 100, 100, 150, 200), furn('d', 'desk', 400, 300, 120, 60)], 280);
  assert.deepEqual(f.filter(x => x.severity === 'lighting'), []);
});

test('照明一：燈在枕頭正上方要抓；在床尾不唸', () => {
  // 床頭朝上（0°），枕頭在 (175, 125)
  const bed = furn('b', 'bed_double', 100, 100, 150, 200);
  const hit = ofRule([...BOX, bed, lamp('L', 'downlight', 175, 150)], 'light-pillow');
  assert.equal(hit.length, 1);
  assert.match(hit[0].title, /枕頭上方/);
  assert.match(hit[0].detail, /°/);
  assert.deepEqual(ofRule([...BOX, bed, lamp('L', 'downlight', 175, 400)], 'light-pillow'), []);
});

test('照明一：床頭後方的燈降為提醒，不說會直視', () => {
  const bed = furn('b', 'bed_double', 100, 100, 150, 200);
  const f = ofRule([...BOX, bed, lamp('L', 'downlight', 175, 105)], 'light-pillow');
  assert.equal(f.length, 1);
  assert.match(f[0].title, /床頭後上方/);
});

test('照明二：崁燈在做到頂的櫃子上方、或離它不到 25cm 要抓', () => {
  const cab = tall('c', 200, 0, 200, 60);
  assert.match(ofRule([...BOX, cab, lamp('L', 'downlight', 300, 30)], 'light-cabinet')[0]?.title ?? '', /上方/);
  const near = ofRule([...BOX, cab, lamp('L', 'downlight', 300, 75)], 'light-cabinet');
  assert.equal(near.length, 1);
  assert.match(near[0].detail, /15cm/);
});

test('照明二：離櫃子 40cm、或櫃子沒做到頂，不唸', () => {
  assert.deepEqual(ofRule([...BOX, tall('c', 200, 0, 200, 60), lamp('L', 'downlight', 300, 100)], 'light-cabinet'), []);
  assert.deepEqual(ofRule([...BOX, tall('c', 200, 0, 200, 60, 90), lamp('L', 'downlight', 300, 70)], 'light-cabinet'), []);
  // 吊燈垂在櫃子前面，不是裝在櫃頂
  assert.deepEqual(ofRule([...BOX, tall('c', 200, 0, 200, 60), lamp('L', 'pendant', 300, 70)], 'light-cabinet'), []);
});

test('照明三：懸在房間中間的層板燈要抓', () => {
  const f = ofRule([...BOX, lamp('t', 'batten', 300, 200, { size: 4, angle: 180 })], 'light-mount');
  assert.equal(f.length, 1);
});

test('照明三：貼在牆面、或背靠做到頂的櫃子，不唸', () => {
  // 上牆的室內面在 y = 6，朝下（180°）照進房間
  assert.deepEqual(ofRule([...BOX, lamp('t', 'batten', 300, 6, { size: 4, angle: 180 })], 'light-mount'), []);
  // 櫃子正面在 y = 60
  assert.deepEqual(ofRule([...BOX, tall('c', 200, 0, 200, 60), lamp('t', 'batten', 300, 60, { size: 4, angle: 180 })], 'light-mount'), []);
  // 背對牆（朝牆照）就不算貼著
  assert.equal(ofRule([...BOX, lamp('t', 'batten', 300, 6, { size: 4, angle: 0 })], 'light-mount').length, 1);
  // 比櫃面還長，伸出去懸空的那一截沒地方鎖
  assert.equal(ofRule([...BOX, tall('c', 250, 0, 100, 60), lamp('t', 'batten', 300, 60, { size: 4, angle: 180 })], 'light-mount').length, 1);
});

test('照明三：層板燈跨在門上方要抓；同一道牆上錯開不唸', () => {
  const door = { id: 'dr', kind: 'door', layer: 'doors', x: 300, y: 0, width: 90, angle: 0 } as Obj;
  assert.equal(ofRule([...BOX, door, lamp('t', 'batten', 300, 6, { size: 4, angle: 180 })], 'light-door').length, 1);
  assert.deepEqual(ofRule([...BOX, door, lamp('t', 'batten', 480, 6, { size: 4, angle: 180 })], 'light-door'), []);
});

test('照明四：一盞投射燈縮在角落，整間均勻度太低要抓；平均鋪滿不唸', () => {
  const f = ofRule([...BOX, lamp('L', 'spotlight', 40, 40)], 'light-uniformity');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /均勻度 0\.\d\d/);
  assert.deepEqual(ofRule([...BOX, ...EVEN], 'light-uniformity'), []);
});

test('照明五：書桌不夠 300 要提示加檯燈；床面夠亮不唸', () => {
  const objs = [...BOX, ...EVEN, furn('d', 'desk', 400, 300, 120, 60), furn('b', 'bed_double', 50, 150, 150, 200)];
  const f = ofRule(objs, 'light-zone');
  assert.equal(f.length, 1, f.map(x => x.title).join('、'));
  assert.match(f[0].title, /桌面不夠亮/);
  assert.match(f[0].why, /檯燈/);
  assert.deepEqual(f[0].targets, ['d']);
});

test('照明五：門口太暗要抓', () => {
  const door = { id: 'dr', kind: 'door', layer: 'doors', x: 560, y: 400, width: 80, angle: 0 } as Obj;
  const f = ofRule([...BOX, door, lamp('L', 'downlight', 60, 60)], 'light-zone');
  assert.ok(f.some(x => /門口/.test(x.title) && x.targets[0] === 'dr'), f.map(x => x.title).join('、'));
});

test('照明三：牆被切成兩段，跨接縫貼著的層板燈不唸', () => {
  const split = [wall('w1a', 0, 0, 300, 0), wall('w1b', 300, 0, 600, 0), ...BOX.slice(1)];
  assert.deepEqual(ofRule([...split, lamp('t', 'batten', 300, 6, { size: 4, angle: 180 })], 'light-mount'), []);
  // 兩段之間有一個 30 cm 的缺口，燈管跨在缺口上還是要唸
  const gap = [wall('w1a', 0, 0, 270, 0), wall('w1b', 330, 0, 600, 0), ...BOX.slice(1)];
  assert.equal(ofRule([...gap, lamp('t', 'batten', 300, 6, { size: 4, angle: 180 })], 'light-mount').length, 1);
});

test('照明：兩間共用一扇門，門口的提醒記在燈所在那一間，標題寫房名', () => {
  const two = [
    wall('a1', 0, 0, 600, 0), wall('a2', 600, 0, 600, 800), wall('a3', 600, 800, 0, 800), wall('a4', 0, 800, 0, 0),
    wall('mid', 0, 400, 600, 400),
    { ...room('rA', 0, 0, 600, 400), name: '臥室' } as Obj, { ...room('rB', 0, 400, 600, 400), name: '書房' } as Obj,
    { id: 'dr', kind: 'door', layer: 'doors', x: 560, y: 400, width: 80, angle: 0 } as Obj,
    lamp('L', 'downlight', 60, 60),
  ];
  const f = ofRule(two, 'light-zone').filter(x => x.targets[0] === 'dr');
  assert.equal(f.length, 1, '書房沒有燈，不檢查');
  assert.equal(f[0].room, 'rA');
  assert.match(f[0].title, /^臥室門口/);
});

test('照明二：隔著牆的隔壁房櫃子不算', () => {
  const two = [
    wall('a1', 0, 0, 600, 0), wall('a2', 600, 0, 600, 800), wall('a3', 600, 800, 0, 800), wall('a4', 0, 800, 0, 0),
    wall('mid', 0, 400, 600, 400),
    room('rA', 0, 0, 600, 400), room('rB', 0, 400, 600, 400),
    tall('c', 200, 340, 200, 54),          // 臥室的衣櫃背靠中間那道牆（牆面在 394）
    lamp('L', 'downlight', 300, 416),      // 書房的崁燈，離牆面 10 cm，離衣櫃 22 cm
  ];
  assert.deepEqual(ofRule(two, 'light-cabinet'), []);
});
