import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDisplay, fromDisplay, fieldValue, formatLength, formatArea, parseLength, stepFor } from '../src/core/units';

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
