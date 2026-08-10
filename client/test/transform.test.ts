import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeBox, resizeFurniture, curveBulge, rotateAngle, openingEndpoint } from '../src/core/transform';

const near = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

const G = { x: 100, y: 100, w: 200, h: 100 };   // 左上 (100,100)，右下 (300,200)

// ---------------------------------------------------------------- 方框縮放

test('拉右下角，左上角不動', () => {
  assert.deepEqual(resizeBox(G, 'se', { x: 400, y: 350 }), { x: 100, y: 100, w: 300, h: 250 });
});

test('拉左上角，右下角不動', () => {
  // 錨點選錯的話這裡會從左上長出去，方向剛好相反。
  assert.deepEqual(resizeBox(G, 'nw', { x: 50, y: 60 }), { x: 50, y: 60, w: 250, h: 140 });
});

test('四個角各自錨在對角', () => {
  for (const [corner, anchor] of [
    ['nw', { x: 300, y: 200 }], ['ne', { x: 100, y: 200 }],
    ['se', { x: 100, y: 100 }], ['sw', { x: 300, y: 100 }],
  ] as const) {
    // 把角拖到「錨點 + (60,60)」，結果一定是以錨點為原點的 60×60。
    const r = resizeBox(G, corner, { x: anchor.x + 60, y: anchor.y + 60 });
    assert.deepEqual(r, { x: anchor.x, y: anchor.y, w: 60, h: 60 }, corner);
  }
});

test('拖過頭會翻面，不會變成負寬度', () => {
  // 負的 w 什麼都畫不出來——滑鼠還按著，物件就整個不見了。
  const r = resizeBox(G, 'se', { x: 40, y: 30 });
  assert.ok(r.w > 0 && r.h > 0);
  assert.deepEqual(r, { x: 40, y: 30, w: 60, h: 70 });
});

test('縮到零仍留下最小尺寸', () => {
  const r = resizeBox(G, 'se', { x: 100, y: 100 });
  assert.deepEqual([r.w, r.h], [10, 10]);
});

// ---------------------------------------------------------------- 家具縮放

const F = { x: 0, y: 0, w: 100, h: 60, angle: 0 };   // 中心 (50,30)

test('家具以中心縮放，兩邊一起動', () => {
  const r = resizeFurniture(F, { x: 100, y: 30 });   // 距中心 50 → 寬 100
  near(r.w, 100);
  near(r.x, 0, 1e-9);
});

test('滑鼠往中心靠就變小', () => {
  const r = resizeFurniture(F, { x: 60, y: 30 });    // 距中心 10 → 寬 20
  near(r.w, 20);
  near(r.x, 40);
});

test('轉過的家具沿自己的軸長，不是螢幕的軸', () => {
  // 這是整個函式存在的理由：座標是軸對齊 + 一個 angle，不先轉回本地座標，
  // 轉了 90° 的家具會把「寬」長在螢幕的 x 上，看起來像被剪切。
  // 同一個游標點，轉了 90° 的家具與沒轉的，寬高剛好對調。
  const at = { x: 35, y: 80 };
  const upright = resizeFurniture(F, at);
  const turned = resizeFurniture({ ...F, angle: 90 }, at);
  near(upright.w, 30); near(upright.h, 100);
  near(turned.w, 100); near(turned.h, 30);
});

test('寬高都是從同一個游標點推的——不是只改被拉的那一軸', () => {
  // 點落在本地的 x 軸上，另一軸就收到最小值。這不是 bug，是這個把手的定義。
  const r = resizeFurniture(F, { x: 100, y: 30 });
  near(r.w, 100);
  assert.equal(r.h, 10);
});

test('吸附是套在尺寸上而不是游標上', () => {
  const r = resizeFurniture(F, { x: 97, y: 30 }, 10);   // 半寬 47 → 寬 94 → 吸到 90
  near(r.w, 90);
  near(r.x, 5, 1e-9);
});

test('吸附之後仍不小於最小尺寸', () => {
  const r = resizeFurniture(F, { x: 50.5, y: 30 }, 20);   // 吸附會把它拉到 0
  assert.ok(r.w >= 10, String(r.w));
});

// ---------------------------------------------------------------- 曲線牆

const A = { x: 0, y: 0 }, B = { x: 400, y: 0 };

test('往一邊拉是正的，往另一邊是負的', () => {
  const up = curveBulge(A, B, { x: 200, y: 100 }, 10, false);
  const down = curveBulge(A, B, { x: 200, y: -100 }, 10, false);
  assert.ok(up * down < 0, `${up} / ${down} 應該一正一負`);
  near(Math.abs(up), Math.abs(down));
});

test('開吸附時弧深是格線的整數倍', () => {
  const b = curveBulge(A, B, { x: 200, y: 97 }, 10, true);
  near(b % 10, 0);
});

test('拉回接近零就真的變成直牆', () => {
  // 留著 0.4 的 bulge 看起來是直的，但房間偵測、3D 掃掠、DXF 匯出都還當它是弧。
  assert.equal(curveBulge(A, B, { x: 200, y: 4 }, 10, false), 0);
  assert.equal(curveBulge(A, B, { x: 200, y: 4 }, 10, true), 0);
});

test('關掉吸附也一樣會歸零，只是不取整', () => {
  const b = curveBulge(A, B, { x: 200, y: 97 }, 10, false);
  assert.notEqual(b % 10, 0);
  assert.ok(Math.abs(b) > 10);
});

// ---------------------------------------------------------------- 旋轉

const C = { x: 0, y: 0 };

test('把手在物件正上方，所以正上方是 0 度', () => {
  // 少了那個 +90，每次抓旋轉把手物件都會先跳四分之一圈。
  assert.equal(rotateAngle(C, { x: 0, y: -100 }, false), 0);
});

test('繞一圈四個方位', () => {
  assert.equal(rotateAngle(C, { x: 100, y: 0 }, false), 90);
  assert.equal(rotateAngle(C, { x: 0, y: 100 }, false), 180);
  assert.equal(rotateAngle(C, { x: -100, y: 0 }, false), 270);   // 不是 -90——這裡不正規化到 ±180
});

test('接近直角會被吸過去', () => {
  const a = rotateAngle(C, { x: 100, y: -8 }, false);   // 約 85.4°
  assert.equal(a, 90);
});

test('離直角夠遠就不吸，保留整數度', () => {
  const a = rotateAngle(C, { x: 100, y: -100 }, false);  // 45°
  assert.equal(a, 45);
});

test('吸附範圍是 8 度：邊界內外要分得開', () => {
  const inside = rotateAngle(C, { x: Math.cos(-0.12), y: Math.sin(-0.12) }, false);
  assert.equal(inside, 90, '約差 7 度，該吸');
  const outside = rotateAngle(C, { x: Math.cos(-0.2), y: Math.sin(-0.2) }, false);
  assert.notEqual(outside, 90, '約差 11 度，不該吸');
});

test('按住 Shift 走 15 度一格，而且不再吸直角', () => {
  const a = rotateAngle(C, { x: 100, y: -8 }, true);
  assert.equal(a % 15, 0);
  assert.equal(a, 90);
  assert.equal(rotateAngle(C, { x: 100, y: -60 }, true), 60);   // 約 59° → 60
});

test('Shift 讓 45 度附近落在 45，不是被吸到 90', () => {
  assert.equal(rotateAngle(C, { x: 100, y: -105 }, true), 45);
});

// ---------------------------------------------------------------- 開口端點

const D = { x: 200, y: 100, width: 90, angle: 0 };   // 兩端 (155,100) 與 (245,100)

test('拉 b 端時 a 端釘住不動', () => {
  // 固定端跟著跑的話，門會一邊縮放一邊沿著牆爬走。
  const e = openingEndpoint(D, 'b', { x: 305, y: 100 });
  assert.deepEqual(e.fixed, { x: 155, y: 100 });
  near(e.width, 150);
  near(e.centre.x, 230);
});

test('拉 a 端時 b 端釘住不動', () => {
  const e = openingEndpoint(D, 'a', { x: 95, y: 100 });
  assert.deepEqual(e.fixed, { x: 245, y: 100 });
  near(e.width, 150);
  near(e.centre.x, 170);
});

test('角度是從固定端量向被拉的那端', () => {
  assert.equal(openingEndpoint(D, 'b', { x: 305, y: 100 }).angle, 0);
  assert.equal(openingEndpoint(D, 'a', { x: 95, y: 100 }).angle, 0);
});

test('拉過固定端會轉向，不會得到反過來的寬度', () => {
  const e = openingEndpoint(D, 'b', { x: 55, y: 100 });   // 越過 a 端
  assert.ok(e.width > 0);
  near(e.width, 100);
  near(Math.abs(e.angle), 180);
});

test('轉過的開口，固定端要跟著轉', () => {
  const turned = { x: 200, y: 100, width: 90, angle: 90 };
  const e = openingEndpoint(turned, 'b', { x: 200, y: 200 });
  near(e.fixed.x, 200);
  near(e.fixed.y, 55);
  near(e.width, 145);
});

test('拉到固定端上仍給得出最小寬度', () => {
  const e = openingEndpoint(D, 'b', { x: 155, y: 100 });
  assert.equal(e.width, 10);
});
