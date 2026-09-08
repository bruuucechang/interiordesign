import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// 提示列只有一格文字，而三個東西在寫它：工具自己的說明（常駐）、`notice`（常駐，
// 用在「這件事失敗了，你回頭找的時候要還看得到」）、以及 `flash`（1.2 秒的快閃）。
//
// 出過的事：匯出 360 全景會先 flash「正在算全景…」，然後**把主執行緒卡住八秒**
// 去拍，拍完再 flash 結果。第二個 flash 讀到的「原本的字」是第一個 flash 留下的
// 「正在算全景…」，於是它把那句話還原回去——而那句話後面沒有任何計時器，就永遠
// 留在畫面上。使用者看到的是：全景已經存好了，畫面卻一直說它在算。下一次匯出再
// 把這句錯的當成自己的「原本的字」，一路傳下去。

const el = { textContent: '' };
(globalThis as any).document = { querySelector: (s: string) => (s === '#hint' ? el : null) };
(globalThis as any).window = { setTimeout, clearTimeout };

const { flash, notice, hintChanged } = await import('../src/ui/feedback');

const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeEach(() => { hintChanged(); el.textContent = '工具說明'; });

test('快閃訊息 1.2 秒後回到工具說明', async () => {
  flash('已儲存');
  assert.equal(el.textContent, '已儲存');
  await tick(1400);
  assert.equal(el.textContent, '工具說明');
});

test('兩個快閃疊在一起，回到的是工具說明，不是前一句快閃', async () => {
  flash('正在算全景…');
  await tick(100);
  flash('已匯出 360 全景');
  await tick(1400);
  assert.equal(el.textContent, '工具說明', '不能還原成「正在算全景…」');
});

test('第二個快閃隔很久才來，也不會把第一句釘在畫面上', async () => {
  flash('正在算全景…');
  await tick(1400);                       // 第一個已經還原了
  assert.equal(el.textContent, '工具說明');
  flash('已匯出 360 全景');
  await tick(1400);
  assert.equal(el.textContent, '工具說明');
});

test('notice 是常駐的，不會被還沒到期的快閃蓋掉', async () => {
  flash('儲存中…');
  await tick(100);
  notice('找不到這份方案');
  await tick(1400);
  assert.equal(el.textContent, '找不到這份方案');
});

test('換工具之後，先前的快閃不會把舊工具的說明畫回來', async () => {
  flash('已儲存');
  await tick(100);
  hintChanged(); el.textContent = '新工具的說明';   // editor.setHint 做的事
  await tick(1400);
  assert.equal(el.textContent, '新工具的說明');
});
