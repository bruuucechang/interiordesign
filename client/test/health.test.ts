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
