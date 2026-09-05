import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDynamic, isEmpty, applyKey, resolveEnd, describe } from '../src/core/dynamicInput';
import type { DynamicState } from '../src/core/dynamicInput';

const type = (keys: string) => {
  let s = emptyDynamic();
  for (const k of keys.split(' ')) {
    const next = applyKey(s, k);
    if (next) s = next;
  }
  return s;
};
const near = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

// ------------------------------------------------------------------ 打字

test('數字進的是目前那一格', () => {
  assert.equal(type('3 5 0').length, '350');
});

test('Tab 換到角度，數字就進角度', () => {
  const s = type('3 5 0 Tab 9 0');
  assert.equal(s.length, '350');
  assert.equal(s.angle, '90');
});

test('小數點只能有一個', () => {
  assert.equal(type('1 . 5 . 2').length, '1.52');
});

test('角度可以是負的，長度不行', () => {
  assert.equal(type('Tab -').angle, '-');
  assert.equal(type('-').length, '', '長度打負號沒有意義');
});

test('Backspace 先刪字，格子空了才退回上一格', () => {
  let s = type('3 5 Tab 9');
  s = applyKey(s, 'Backspace')!;
  assert.equal(s.angle, '');
  s = applyKey(s, 'Backspace')!;
  assert.equal(s.field, 'length', '空的角度格再按一次要退回長度');
  assert.equal(s.length, '35', '退回來的時候不能順手把長度也刪掉');
});

test('不認得的鍵要回 null，讓它傳下去', () => {
  // 全部吞掉的話 Esc、工具快捷鍵、undo 全都會壞掉。
  for (const k of ['Escape', 'v', 'z', 'ArrowLeft', 'F5']) {
    assert.equal(applyKey(emptyDynamic(), k), null, k);
  }
});

// -------------------------------------------------------------- 解析出終點

const S = { x: 100, y: 100 };
const pointerEast = { x: 300, y: 100 };   // 距離 200、角度 0°

test('只打長度：方向沿用滑鼠指的方向', () => {
  // 最常見的用法——大致瞄好，再把長度打準。
  const e = resolveEnd(type('3 5 0'), S, pointerEast)!;
  near(Math.hypot(e.x - S.x, e.y - S.y), 350);
  near(e.y, 100);
});

test('只打角度：長度沿用目前的距離', () => {
  const e = resolveEnd(type('Tab 9 0'), S, pointerEast)!;
  near(Math.hypot(e.x - S.x, e.y - S.y), 200);
  near(e.x, 100);
  near(e.y, 300);
});

test('兩個都打：滑鼠完全不參與', () => {
  const e = resolveEnd(type('1 0 0 Tab 1 8 0'), S, pointerEast)!;
  near(e.x, 0);
  near(e.y, 100);
});

test('什麼都沒打就沒有答案', () => {
  assert.equal(resolveEnd(emptyDynamic(), S, pointerEast), null);
});

test('長度 0 或負的不接受', () => {
  assert.equal(resolveEnd(type('0'), S, pointerEast), null);
});

test('只打了一個負號還不是一個角度', () => {
  assert.equal(resolveEnd(type('Tab -'), S, pointerEast), null);
});

test('滑鼠沒動過也還是能打出一道牆', () => {
  // 純鍵盤的路徑：起點就是終點，方向沒有線索，長度打了就該成立。
  const e = resolveEnd(type('2 5 0'), S, S)!;
  near(Math.hypot(e.x - S.x, e.y - S.y), 250);
});

// ---------------------------------------------------------------- 讀出來

test('讀數要標出游標在哪一格', () => {
  const s = type('3 5 0');
  assert.match(describe(s, 'cm'), /\[350\]/);
  assert.match(describe(applyKey(s, 'Tab')!, 'cm'), /\[_\]°/);
});

test('isEmpty 只在兩格都空的時候成立', () => {
  assert.equal(isEmpty(emptyDynamic()), true);
  assert.equal(isEmpty(type('3')), false);
  assert.equal(isEmpty(type('Tab 9')), false);
});
