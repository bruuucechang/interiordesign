import { test } from 'node:test';
import assert from 'node:assert/strict';

const near = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);
import { toDisplay, fromDisplay, fieldValue, formatLength, formatArea, parseLength, stepFor, ALL_UNITS, areaToDisplay, areaLabel, unitLabel } from '../src/core/units';

// ---------------------------------------------------------------- 換算

test('公分模式不做任何換算', () => {
  assert.equal(toDisplay(350, 'cm'), 350);
  assert.equal(fromDisplay(350, 'cm'), 350);
});

test('公尺模式差 100 倍', () => {
  assert.equal(toDisplay(350, 'm'), 3.5);
  assert.equal(fromDisplay(3.5, 'm'), 350);
});

test('來回換算回得到原值', () => {
  // 顯示 → 輸入回來會經過這一對；不對稱的話欄位每被讀寫一次就漂一點。
  for (const u of ['cm', 'm'] as const) {
    for (const cm of [1, 90, 350, 12345]) {
      assert.equal(fromDisplay(toDisplay(cm, u), u), cm, `${cm} ${u}`);
    }
  }
});

// ---------------------------------------------------------------- 欄位顯示

test('公分顯示整數，公尺顯示兩位小數', () => {
  assert.equal(fieldValue(350, 'cm'), '350');
  assert.equal(fieldValue(350, 'm'), '3.50');
});

test('顯示值先取整，因為它會被寫回去', () => {
  // 欄位 step 是 1，裡面卻放著 12.3456 的話，方向鍵按一下送出的是 13.3456。
  assert.equal(fieldValue(12.3456, 'cm'), '12');
  assert.equal(fieldValue(12.3456, 'm'), '0.12');
});

test('顯示出來的值再解析一次不會變', () => {
  for (const u of ['cm', 'm'] as const) {
    const shown = fieldValue(347.6, u);
    const back = parseLength(shown, u)!;
    assert.equal(fieldValue(back, u), shown, u);
  }
});

test('step 對得上小數位數', () => {
  assert.equal(stepFor('cm'), '1');
  assert.equal(stepFor('m'), '0.01');
});

// ---------------------------------------------------------------- 唯讀顯示

test('長度帶單位', () => {
  assert.equal(formatLength(350, 'cm'), '350 cm');
  assert.equal(formatLength(350, 'm'), '3.50 m');
});

test('面積的換算是平方——這一個錯了看起來也很合理', () => {
  // 一坪多一點的房間。用長度的 100 倍去除會得到 240 m²，一樣是「一個數字」。
  assert.equal(formatArea(240000, 'cm'), '240000 cm²');
  assert.equal(formatArea(240000, 'm'), '24.00 m²');
  assert.equal(formatArea(10000, 'm'), '1.00 m²', '1 m² 是 10000 cm² 不是 100');
});

test('面積單位標示帶平方符號', () => {
  assert.ok(formatArea(1, 'cm').endsWith('cm²'));
  assert.ok(formatArea(1, 'm').endsWith('m²'));
});

// ---------------------------------------------------------------- 解析

test('讀得懂就換算回公分', () => {
  assert.equal(parseLength('3.5', 'm'), 350);
  assert.equal(parseLength('350', 'cm'), 350);
});

test('打到一半的狀態回 null，不是 0', () => {
  // 清空欄位重打時會經過空字串；當成 0 寫下去，物件會在打字途中塌掉，
  // 而且在 undo 堆疊上留一筆垃圾。
  for (const raw of ['', ' ', '-', '.', 'abc', 'NaN']) {
    assert.equal(parseLength(raw, 'cm'), null, JSON.stringify(raw));
  }
});

test('Infinity 不算數', () => {
  assert.equal(parseLength('Infinity', 'cm'), null);
  assert.equal(parseLength('1e999', 'cm'), null);
});

test('下限會夾住，而且是夾公分不是夾顯示值', () => {
  // 夾在換算前的話，公尺模式下的下限會變成 100 倍。
  assert.equal(parseLength('0.05', 'm', 10), 10);
  assert.equal(parseLength('0.5', 'm', 10), 50);
});

test('沒給下限時允許零與負值', () => {
  assert.equal(parseLength('0', 'cm'), 0);
  assert.equal(parseLength('-5', 'cm', -Infinity), -5);
});

test('後面接單位文字仍讀得到數字', () => {
  // number input 一般不會有，但貼上的內容會。
  assert.equal(parseLength('3.5 m', 'm'), 350);
});

// ---- 英制 ----
//
// 一個只講公制的工具，對習慣英尺英寸的人不是「用起來不順」，是每一個數字都要自己
// 換算。`ft` 是**十進位英尺**不是英尺加英寸：欄位是 <input type="number">，而
// `12' 6"` 不是一個數字；而且平面圖是靠微調數值編輯的，兩段式字串撐不過那個流程。

test('英寸與英尺的換算是精確值', () => {
  // 2.54 是定義值，不是近似值——寫錯這裡，整份圖會慢慢歪掉而且看起來很合理。
  near(fromDisplay(1, 'in'), 2.54);
  near(fromDisplay(1, 'ft'), 30.48);
  near(fromDisplay(12, 'in'), fromDisplay(1, 'ft'));
});

test('來回換算不會漂移', () => {
  for (const u of ALL_UNITS) {
    for (const cm of [1, 12.7, 100, 350, 1230.5]) {
      near(fromDisplay(toDisplay(cm, u), u), cm, 1e-9);
    }
  }
});

test('面積的因子要平方', () => {
  // 這一條是「看起來對的時候正好是錯的」那一種：1 ft² = 929.03 cm²，不是 30.48。
  near(areaToDisplay(929.0304, 'ft'), 1, 1e-9);
  near(areaToDisplay(6.4516, 'in'), 1, 1e-9);
});

test('每一種單位都有標籤與面積標籤', () => {
  for (const u of ALL_UNITS) {
    assert.ok(unitLabel(u).length > 0, u);
    assert.match(areaLabel(u), /²$/, u);
  }
});

test('step 跟顯示的小數位數一致', () => {
  // 不一致的話，按一次上下鍵會提交一個欄位沒有顯示過的數字。
  assert.equal(stepFor('cm'), '1');
  assert.equal(stepFor('in'), '0.1');
  assert.equal(stepFor('ft'), '0.01');
  assert.equal(stepFor('m'), '0.01');
});

test('英制的欄位值不會顯示出比 step 更細的位數', () => {
  // 顯示 12.3456 而 step 是 0.01 的話，下一次按上鍵會提交 12.3556。
  assert.equal(fieldValue(376.1234, 'ft').split('.')[1]?.length, 2);
  assert.equal(fieldValue(376.1234, 'in').split('.')[1]?.length, 1);
});
