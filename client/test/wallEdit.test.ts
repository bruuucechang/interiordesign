import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceShift, applyReference, splitWallAt, alignWalls } from '../src/core/wallEdit';
import type { Wall } from '../src/core/wallEdit';

const wall = (id: string, ax: number, ay: number, bx: number, by: number, over: Partial<Wall> = {}): Wall =>
  ({ id, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 12, ...over });

const near = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

// ---------------------------------------------------------------- 繪製基準線

test('中心線模式不位移', () => {
  assert.equal(referenceShift('center', 12), 0);
  const r = applyReference({ x: 0, y: 0 }, { x: 100, y: 0 }, 'center', 12);
  assert.deepEqual(r.a, { x: 0, y: 0 });
});

test('左右兩側位移一樣多但方向相反', () => {
  assert.equal(referenceShift('left', 12), 6);
  assert.equal(referenceShift('right', 12), -6);
});

test('位移是半個牆厚，不是整個', () => {
  // 整個的話，量內緣畫出來的房間每邊差一整個牆厚。
  assert.equal(Math.abs(referenceShift('left', 24)), 12);
});

test('沿 X 走時，位移落在垂直方向', () => {
  const r = applyReference({ x: 0, y: 0 }, { x: 100, y: 0 }, 'left', 12);
  near(r.a.x, 0); near(r.b.x, 100);
  near(r.a.y, -6); near(r.b.y, -6);
});

test('左右分別落在線的兩側', () => {
  const l = applyReference({ x: 0, y: 0 }, { x: 100, y: 0 }, 'left', 12);
  const r = applyReference({ x: 0, y: 0 }, { x: 100, y: 0 }, 'right', 12);
  assert.ok(l.a.y * r.a.y < 0, `${l.a.y} / ${r.a.y} 應該一正一負`);
});

test('反過來畫，同一個模式會落在另一邊——「左」是相對行進方向的', () => {
  // 這是刻意的：單獨一段牆沒有「室內」可言，唯一有定義的是行進方向。
  const fwd = applyReference({ x: 0, y: 0 }, { x: 100, y: 0 }, 'left', 12);
  const back = applyReference({ x: 100, y: 0 }, { x: 0, y: 0 }, 'left', 12);
  assert.ok(fwd.a.y * back.a.y < 0);
});

test('位移量與方向無關，永遠是半個牆厚', () => {
  for (const [bx, by] of [[100, 0], [0, 100], [70, 70], [-40, 30]]) {
    const r = applyReference({ x: 0, y: 0 }, { x: bx, y: by }, 'left', 20);
    near(Math.hypot(r.a.x, r.a.y), 10, 1e-9);
  }
});

test('位移之後線段長度不變', () => {
  const r = applyReference({ x: 0, y: 0 }, { x: 300, y: 400 }, 'right', 12);
  near(Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y), 500, 1e-9);
});

// ---------------------------------------------------------------- 分割

test('從 a 端量指定長度切開', () => {
  const out = splitWallAt(wall('w', 0, 0, 400, 0), 150)!;
  assert.ok(out);
  assert.deepEqual(out[0].a, { x: 0, y: 0 });
  assert.deepEqual(out[0].b, { x: 150, y: 0 });
  assert.deepEqual(out[1].a, { x: 150, y: 0 });
  assert.deepEqual(out[1].b, { x: 400, y: 0 });
});

test('切點沿著牆走，不是沿著座標軸', () => {
  const out = splitWallAt(wall('w', 0, 0, 300, 400), 250)!;   // 長度 500
  near(out[0].b.x, 150); near(out[0].b.y, 200);
});

test('兩半保留原本的厚度、高度與材質——切開是一分為二不是重新畫兩道', () => {
  const w = wall('w', 0, 0, 400, 0, { thickness: 24, height: 300, finish: 'brick' });
  const out = splitWallAt(w, 200)!;
  for (const half of out) {
    assert.equal(half.thickness, 24);
    assert.equal(half.height, 300);
    assert.equal((half as any).finish, 'brick');
    assert.equal(half.layer, 'walls');
  }
});

test('第二半的 id 留空，由呼叫端給新的', () => {
  // 兩半共用同一個 id 的話，第二半在文件裡會蓋掉第一半。
  const out = splitWallAt(wall('w', 0, 0, 400, 0), 200)!;
  assert.equal(out[0].id, 'w');
  assert.equal(out[1].id, '');
});

test('切在端點上或超出範圍會被拒絕', () => {
  const w = wall('w', 0, 0, 400, 0);
  assert.equal(splitWallAt(w, 0), null);
  assert.equal(splitWallAt(w, 400), null);
  assert.equal(splitWallAt(w, 500), null);
  assert.equal(splitWallAt(w, -10), null);
});

test('切出來的碎屑太短也拒絕', () => {
  const w = wall('w', 0, 0, 400, 0);
  assert.equal(splitWallAt(w, 0.5, 10), null);
  assert.equal(splitWallAt(w, 399.5, 10), null);
  assert.ok(splitWallAt(w, 20, 10));
});

test('曲線牆拒絕分割，而不是把它切成兩段直牆', () => {
  // 照弦線切的話，畫面上那道弧就這樣沒了，而且不會有任何提示。
  assert.equal(splitWallAt(wall('w', 0, 0, 400, 0, { bulge: 60 }), 200), null);
});

test('兩半加起來等於原本的長度', () => {
  const w = wall('w', 10, 20, 310, 420);
  const [p, q] = splitWallAt(w, 137)!;
  const len = (x: Wall) => Math.hypot(x.b.x - x.a.x, x.b.y - x.a.y);
  near(len(p) + len(q), len(w), 1e-9);
  near(len(p), 137, 1e-9);
});

// ---------------------------------------------------------------- 對齊

const runOf = (n: number, y: number, len = 100, over: Partial<Wall> = {}) =>
  wall('w' + n, n * len, y, (n + 1) * len, y, over);

test('少於兩道牆不動作', () => {
  assert.deepEqual(alignWalls([runOf(0, 0)], 'center'), { moves: [], skipped: [] });
});

test('最長的那道不動，其他對過去', () => {
  // 現場上長的那一道通常是對的，飄掉的是短的接續段。
  const long = wall('long', 0, 0, 600, 0);
  const jog = wall('jog', 600, 7, 800, 7);
  const { moves } = alignWalls([long, jog], 'center');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 'jog');
  near(moves[0].a.y, 0); near(moves[0].b.y, 0);
});

test('選取順序不影響結果', () => {
  const long = wall('long', 0, 0, 600, 0);
  const jog = wall('jog', 600, 7, 800, 7);
  assert.deepEqual(alignWalls([long, jog], 'center').moves, alignWalls([jog, long], 'center').moves);
});

test('對齊的是面不是中心線——厚度不同才看得出差別', () => {
  // 兩道厚度不同的牆對「中心」會留下一道階；對「左緣」才會平。
  // 斷言的是「兩個面落在同一條線上」而不是某個算出來的數字——手算那個
  // 數字的正負號我第一次就寫反了，而位置的性質不會騙人。
  const a = wall('a', 0, 0, 600, 0, { thickness: 20 });
  const b = wall('b', 600, 0, 800, 0, { thickness: 10 });
  assert.equal(alignWalls([a, b], 'center').moves.length, 0, '中心線本來就齊了');

  const moves = alignWalls([a, b], 'left').moves;
  assert.equal(moves.length, 1, '左緣沒齊，要移');
  const faceY = (y: number, th: number) => y + th / 2;      // 沿左法線 (0,1)
  near(faceY(moves[0].a.y, b.thickness), faceY(a.a.y, a.thickness));
});

test('已經齊了就不產生任何一步', () => {
  assert.deepEqual(alignWalls([wall('a', 0, 0, 600, 0), wall('b', 600, 0, 800, 0)], 'center').moves, []);
});

test('對齊只動垂直方向，不會沿著牆滑動', () => {
  const { moves } = alignWalls([wall('a', 0, 0, 600, 0), wall('b', 600, 9, 800, 9)], 'center');
  near(moves[0].a.x, 600); near(moves[0].b.x, 800);
});

test('斜牆不會被硬拉到線上，而是回報在 skipped', () => {
  // 安靜跳過最糟：選取看起來「哪裡都對齊了」，因為你只會抽查幾處。
  const long = wall('long', 0, 0, 600, 0);
  const slanted = wall('slant', 600, 0, 800, 200);
  const r = alignWalls([long, slanted], 'center');
  assert.deepEqual(r.moves, []);
  assert.deepEqual(r.skipped, ['slant']);
});

test('容差內的小歪斜仍然算平行', () => {
  const long = wall('long', 0, 0, 600, 0);
  const almost = wall('almost', 600, 5, 800, 11);   // 約 1.7°
  const r = alignWalls([long, almost], 'center');
  assert.equal(r.skipped.length, 0);
  assert.equal(r.moves.length, 1);
});

test('反向畫的平行牆也算平行', () => {
  // 角度差 180° 跟差 0° 是同一件事。
  const long = wall('long', 0, 0, 600, 0);
  const back = wall('back', 800, 9, 600, 9);
  const r = alignWalls([long, back], 'center');
  assert.equal(r.skipped.length, 0);
  assert.equal(r.moves.length, 1);
});

test('曲線牆一律回報在 skipped', () => {
  const r = alignWalls([wall('a', 0, 0, 600, 0), wall('b', 600, 9, 800, 9), wall('c', 0, 50, 600, 50, { bulge: 40 })], 'center');
  assert.ok(r.skipped.includes('c'));
  assert.equal(r.moves.length, 1);
});

test('垂直方向的一排牆也對得起來', () => {
  const long = wall('long', 0, 0, 0, 600);
  const jog = wall('jog', 8, 600, 8, 800);
  const { moves } = alignWalls([long, jog], 'center');
  near(moves[0].a.x, 0); near(moves[0].b.x, 0);
  near(moves[0].a.y, 600);
});
