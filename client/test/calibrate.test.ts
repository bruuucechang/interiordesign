import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, calibrationMessage } from '../src/core/calibrate';
import type { Rect, Calibration } from '../src/core/calibrate';

const near = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

const img = (): Rect => ({ x: 0, y: 0, w: 1000, h: 800 });
const ok = (r: ReturnType<typeof calibrate>): Calibration => {
  assert.ok(typeof r === 'object', `被拒絕了：${r}`);
  return r as Calibration;
};

// ---------------------------------------------------------------- 核心保證

test('校正之後，那條線量起來就是輸入的長度', () => {
  // 這是整個功能唯一真正要保證的事。
  const p0 = { x: 100, y: 100 }, p1 = { x: 300, y: 100 };   // 畫出來 200
  const c = ok(calibrate(img(), p0, p1, 350));
  near(200 * c.factor, 350);
});

test('斜線也一樣', () => {
  const p0 = { x: 0, y: 0 }, p1 = { x: 300, y: 400 };       // 長度 500
  const c = ok(calibrate(img(), p0, p1, 125));
  near(500 * c.factor, 125);
});

test('圖比實際小的時候會放大，大的時候會縮小', () => {
  const small = ok(calibrate(img(), { x: 0, y: 0 }, { x: 100, y: 0 }, 400));
  assert.ok(small.factor > 1 && small.rect.w > 1000);
  const big = ok(calibrate(img(), { x: 0, y: 0 }, { x: 400, y: 0 }, 100));
  assert.ok(big.factor < 1 && big.rect.w < 1000);
});

test('等比縮放：長寬比不變', () => {
  const c = ok(calibrate(img(), { x: 0, y: 0 }, { x: 200, y: 0 }, 500));
  near(c.rect.w / c.rect.h, 1000 / 800);
});

test('以拉的那條線的中點為錨點，量到的那一段不會跑掉', () => {
  const p0 = { x: 400, y: 300 }, p1 = { x: 600, y: 300 };
  const mid = { x: 500, y: 300 };
  const c = ok(calibrate(img(), p0, p1, 800));
  // 錨點在底圖裡的相對位置，縮放前後應該一樣
  const before = { u: (mid.x - 0) / 1000, v: (mid.y - 0) / 800 };
  const after = { u: (mid.x - c.rect.x) / c.rect.w, v: (mid.y - c.rect.y) / c.rect.h };
  near(after.u, before.u, 1e-9);
  near(after.v, before.v, 1e-9);
});

test('已經是對的比例時，什麼都不動', () => {
  const c = ok(calibrate(img(), { x: 0, y: 0 }, { x: 200, y: 0 }, 200));
  near(c.factor, 1);
  assert.deepEqual(c.rect, img());
});

// ------------------------------------------------------------------ 拒絕

test('點一下不算量測', () => {
  // 2px 的手抖會除以趨近 0，把底圖炸成幾公里——那比叫他重來糟得多。
  assert.equal(calibrate(img(), { x: 10, y: 10 }, { x: 10, y: 10 }, 350), 'too-short');
  assert.equal(calibrate(img(), { x: 10, y: 10 }, { x: 10.4, y: 10 }, 350), 'too-short');
});

test('長度要是大於 0 的數字', () => {
  const p0 = { x: 0, y: 0 }, p1 = { x: 200, y: 0 };
  assert.equal(calibrate(img(), p0, p1, 0), 'bad-length');
  assert.equal(calibrate(img(), p0, p1, -5), 'bad-length');
  assert.equal(calibrate(img(), p0, p1, NaN), 'bad-length');
});

test('離譜的縮放倍率要擋下來', () => {
  // 拉了整張圖的寬，卻輸入一扇門的尺寸——兩個數字講的不是同一件事。
  assert.equal(calibrate(img(), { x: 0, y: 0 }, { x: 1000, y: 0 }, 0.5), 'extreme');
  assert.equal(calibrate(img(), { x: 0, y: 0 }, { x: 10, y: 0 }, 100000), 'extreme');
});

test('太短的守衛排在倍率守衛前面', () => {
  // 1cm 的拖曳配上 100000 的長度，兩個守衛都成立。先答的是「太短」，因為那才是
  // 使用者真正做錯的事——叫他重輸入一個數字沒有用，他要重拉那條線。
  assert.equal(calibrate(img(), { x: 0, y: 0 }, { x: 1, y: 0 }, 100000), 'too-short');
});

test('每一種拒絕都有話可以講', () => {
  for (const e of ['too-short', 'bad-length', 'extreme'] as const) {
    assert.ok(calibrationMessage(e).length > 6, e);
  }
});

// ------------------------------------------------------------ 真實的例子

test('IMG_0199 那張圖：長邊猜 10m，實際是 12.3m', () => {
  // 匯入時把長邊硬設成 1000cm。若圖上一段標「350」的牆在那個假比例下量起來
  // 是 284.5，校正後整張圖會變成 1000 × (350/284.5) ≈ 1230cm。
  const c = ok(calibrate({ x: 0, y: 0, w: 1000, h: 700 }, { x: 0, y: 0 }, { x: 284.5, y: 0 }, 350));
  near(Math.round(c.rect.w), 1230);
});
