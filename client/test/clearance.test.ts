import { test } from 'node:test';
import assert from 'node:assert/strict';
import { separation, wallBox, pushOut, groupPushOut } from '../src/core/clearance';
import type { Box } from '../src/core/clearance';

const box = (cx: number, cy: number, w: number, h: number, angle = 0): Box => ({ cx, cy, w, h, angle });

const near = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

/** 推完之後真的分開了嗎——這是每一條測試最後都該問的問題。 */
const clear = (m: Box, f: Box[]) => {
  const out = pushOut(m, f);
  for (const w of f) assert.equal(separation(out, w), null, '推完還是重疊');
  return out;
};

// ------------------------------------------------------------------ 分離軸

test('分開的兩個框回 null', () => {
  assert.equal(separation(box(0, 0, 100, 50), box(300, 0, 100, 50)), null);
});

test('剛好碰到不算重疊', () => {
  // 沙發背貼著牆面是對的狀態，不該被再推一次。
  assert.equal(separation(box(0, 0, 100, 50), box(0, 50, 100, 50)), null);
});

test('推出來的方向是最短的那一邊', () => {
  // 100x50 的沙發中心壓在 100x50 的牆上、只差 10：沿短邊推 40 比沿長邊推 90 近。
  const s = separation(box(0, 10, 100, 50), box(0, 0, 100, 50))!;
  near(s.x, 0);
  near(s.y, 40);
});

test('推的方向是離開牆，不是穿過去', () => {
  const above = separation(box(0, 10, 100, 50), box(0, 0, 100, 50))!;
  const below = separation(box(0, -10, 100, 50), box(0, 0, 100, 50))!;
  assert.ok(above.y > 0 && below.y < 0, '兩邊各自往外');
});

test('完全包在裡面也推得出來', () => {
  // 圓桌放在一道厚牆的正中央——沒有任何一軸是分開的，但仍然要有答案。
  const s = separation(box(0, 0, 40, 40), box(0, 0, 400, 80))!;
  assert.ok(Math.hypot(s.x, s.y) > 0);
  assert.equal(separation({ ...box(0, 0, 40, 40), cx: s.x, cy: s.y }, box(0, 0, 400, 80)), null);
});

test('斜牆要用牆自己的軸才分得開', () => {
  // 只試 mover 自己的兩個軸的話，這一組會算出一個推不開的方向——而它不會報錯，
  // 只是沙發留在牆裡。
  const sofa = box(0, 0, 200, 80, 0);
  const wall = box(0, 0, 600, 24, 30);
  const s = separation(sofa, wall)!;
  assert.equal(separation({ ...sofa, cx: sofa.cx + s.x, cy: sofa.cy + s.y }, wall), null);
});

// --------------------------------------------------------------- 牆的包圍盒

test('牆的包圍盒：長邊是中心線、短邊是厚度', () => {
  const b = wallBox({ x: 0, y: 0 }, { x: 300, y: 0 }, 24)!;
  near(b.cx, 150); near(b.cy, 0); near(b.w, 300); near(b.h, 24); near(b.angle, 0);
});

test('零長度的牆沒有包圍盒', () => {
  assert.equal(wallBox({ x: 5, y: 5 }, { x: 5, y: 5 }, 24), null);
});

// ------------------------------------------------------------------ 推出來

test('沒有牆就不動', () => {
  const m = box(0, 0, 100, 50);
  assert.deepEqual(pushOut(m, []), m);
});

test('推到剛好貼著牆面，不是推到房間中央', () => {
  const wall = wallBox({ x: 0, y: 0 }, { x: 600, y: 0 }, 24)!;
  const out = clear(box(300, 0, 200, 80), [wall]);
  // 牆面在 y = ±12，沙發半深 40，所以背貼牆時中心在 ±52。
  near(Math.abs(out.cy), 52);
  near(out.cx, 300, 1e-6);
});

test('沿著牆的方向不會被移動', () => {
  const wall = wallBox({ x: 0, y: 0 }, { x: 600, y: 0 }, 24)!;
  const out = pushOut(box(123, 5, 200, 80), [wall]);
  near(out.cx, 123);
});

test('轉角：一道牆推出去撞到另一道，兩道都要脫離', () => {
  const walls = [
    wallBox({ x: 0, y: 0 }, { x: 600, y: 0 }, 24)!,
    wallBox({ x: 0, y: 0 }, { x: 0, y: 600 }, 24)!,
  ];
  clear(box(10, 10, 120, 120), walls);
});

test('四面牆圍起來的小房間，家具會落在裡面而不是被擠出去', () => {
  const walls = [
    wallBox({ x: 0, y: 0 }, { x: 400, y: 0 }, 24)!,
    wallBox({ x: 0, y: 400 }, { x: 400, y: 400 }, 24)!,
    wallBox({ x: 0, y: 0 }, { x: 0, y: 400 }, 24)!,
    wallBox({ x: 400, y: 0 }, { x: 400, y: 400 }, 24)!,
  ];
  const out = clear(box(20, 200, 100, 60), walls);
  assert.ok(out.cx > 12 && out.cx < 388, `跑到房間外面了：${out.cx}`);
});

test('塞不下的時候給最後一個位置，不會無限迴圈', () => {
  // 兩道牆之間只有 100，沙發 200 寬——沒有合法答案，但必須要回得來。
  const walls = [
    wallBox({ x: 0, y: 0 }, { x: 0, y: 600 }, 20)!,
    wallBox({ x: 110, y: 0 }, { x: 110, y: 600 }, 20)!,
  ];
  const out = pushOut(box(55, 300, 200, 60), walls);
  assert.ok(Number.isFinite(out.cx) && Number.isFinite(out.cy));
});

test('轉過的家具用的是轉過之後佔的地', () => {
  // 200x40 的餐桌貼在牆邊；轉 90° 之後它伸進牆裡，要被推開 80。
  const wall = wallBox({ x: 0, y: 0 }, { x: 600, y: 0 }, 20)!;
  const flat = pushOut(box(300, 30, 200, 40, 0), [wall]);
  near(flat.cy, 30, 1e-6);                       // 平放本來就沒碰到
  const turned = clear(box(300, 30, 200, 40, 90), [wall]);
  near(turned.cy, 110);                          // 牆面 10 + 半個長邊 100
});

// --------------------------------------------- 多選：整組一起推，不要拆散

/**
 * 上一輪這個功能被還原，就是因為缺了這條。
 *
 * 逐一物件推出去，是最直覺的寫法，也會安靜地把使用者排好的東西拆掉：沙發、茶几、
 * 地毯一起拖過牆，三件各自拿到不同的修正量，到位之後就散開了。相對位置是使用者
 * 親手排的，那才是要保住的東西。
 *
 * 做法：取這一組裡「最深」的那個推出向量，整組套同一個。那是唯一能同時讓所有人
 * 脫離牆、又維持隊形的位移。
 */
const groupPush = (boxes: Box[], walls: Box[]) => groupPushOut(boxes, walls);

test('整組推出去之後，彼此的相對位置完全不變', () => {
  const wall = wallBox({ x: 0, y: 0 }, { x: 600, y: 0 }, 24)!;
  // 沙發壓在牆上、茶几在它前面、地毯更前面——三件深度不同
  const group = [box(300, 5, 200, 80), box(300, 90, 100, 50), box(300, 160, 240, 160)];
  const d = groupPush(group, [wall]);
  const moved = group.map(b => ({ ...b, cx: b.cx + d.x, cy: b.cy + d.y }));
  for (let i = 1; i < group.length; i++) {
    near(moved[i].cx - moved[0].cx, group[i].cx - group[0].cx);
    near(moved[i].cy - moved[0].cy, group[i].cy - group[0].cy);
  }
});

test('整組推出去之後，每一件都真的脫離牆了', () => {
  // 同一側的一組：一定有解，每一件都要脫離。
  const wall = wallBox({ x: 0, y: 0 }, { x: 600, y: 0 }, 24)!;
  const group = [box(300, 5, 200, 80), box(300, 90, 100, 50), box(200, 20, 120, 60)];
  const d = groupPush(group, [wall]);
  for (const b of group) {
    const moved = { ...b, cx: b.cx + d.x, cy: b.cy + d.y };
    assert.equal(separation(moved, wall), null, '這一件還在牆裡');
  }
});

test('跨在牆兩側的一組無解，但不會震盪也不會變形', () => {
  // 沒有任何一個剛體位移能同時讓牆兩邊的東西脫離。要求是：會停、而且隊形不變。
  const wall = wallBox({ x: 0, y: 0 }, { x: 600, y: 0 }, 24)!;
  const group = [box(300, 5, 200, 80), box(200, -10, 120, 60)];
  const d = groupPush(group, [wall]);
  assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y), '要回得來');
  const moved = group.map(b => ({ ...b, cx: b.cx + d.x, cy: b.cy + d.y }));
  near(moved[1].cx - moved[0].cx, group[1].cx - group[0].cx);
  near(moved[1].cy - moved[0].cy, group[1].cy - group[0].cy);
});

test('沒有人碰到牆的時候，整組不動', () => {
  const wall = wallBox({ x: 0, y: 0 }, { x: 600, y: 0 }, 24)!;
  const group = [box(300, 200, 200, 80), box(300, 320, 100, 50)];
  const d = groupPush(group, [wall]);
  near(d.x, 0); near(d.y, 0);
});

test('位移取的是最深的那一個，不是加總', () => {
  // 兩件都埋進牆裡，深度不同。相加會衝過頭，取最大才剛好。
  const wall = wallBox({ x: 0, y: 0 }, { x: 600, y: 0 }, 20)!;
  const shallow = box(200, 40, 100, 60);   // 需要推 0（40 - 30 = 10 > 牆面 10）
  const deep = box(400, 0, 100, 60);       // 中心壓在牆心，要推 40
  const d = groupPush([shallow, deep], [wall]);
  const only = pushOut(deep, [wall]);
  near(Math.hypot(d.x, d.y), Math.hypot(only.cx - deep.cx, only.cy - deep.cy));
});
