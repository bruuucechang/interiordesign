// 回收桶：刪掉、找得回來——**尤其是在一份都不剩的時候**。
//
//   node bench/verify-bin.mjs [base-url]
//
// 不是單元測試測得到的，因為壞掉的方式是「接線」而不是「運算」：`openModal` 在
// 沒有任何存活方案時會提早 `return`，而 `renderBin()` 在那一行**後面**。於是唯一
// 真的需要回收桶的時刻——你把手上唯一那張圖刪掉、想把它救回來——正好是它不存在的
// 時刻。畫面上沒有任何錯誤，只有一句「尚無已儲存的專案」，而新手教學還在旁邊說
// 刪掉的東西 30 天內都救得回來。
//
// 需要後端在 :8791（或用第一個參數指向桌面版／正式建置的位址）。
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.addInitScript(() => {
  try {
    localStorage.clear();                       // 全新的 owner，看不到別人的圖
    localStorage.setItem('interior_tour_seen', '1');
    localStorage.setItem('interior_lang', 'zh-Hant');
  } catch { /* ignore */ }
});

const errs = [];
p.on('pageerror', (e) => errs.push('例外: ' + String(e).split('\n')[0]));
p.on('response', (r) => { if (!r.ok() && r.status() !== 304) errs.push(`HTTP ${r.status()} ${r.url()}`); });

await p.goto(`${BASE}/?perf=1`, { waitUntil: 'load' });
await p.waitForTimeout(3000);
await p.evaluate(() => { window.confirm = () => true; });

let fails = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${n}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

// 一份有名字、有內容的圖，存到後端
const NAME = `回收桶驗證-${await p.evaluate(() => window.__app.doc.project.id)}`;
await p.evaluate((n) => {
  const i = document.getElementById('projectName');
  i.value = n; i.dispatchEvent(new Event('input', { bubbles: true }));
}, NAME);
await p.evaluate(() => {
  const d = window.__app.doc;
  d.commit();
  d.add({ id: 'w_bin', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, thickness: 12 });
});
await p.waitForTimeout(2500);
const owner = await p.evaluate(() => localStorage.getItem('interior_owner'));
const live = () => p.evaluate((o) => fetch('/api/projects', { headers: { 'X-Owner': o } })
  .then((r) => r.json()).then((d) => d.projects.length), owner);
const binned = () => p.evaluate((o) => fetch('/api/projects-deleted', { headers: { 'X-Owner': o } })
  .then((r) => r.json()).then((d) => d.projects.map((x) => x.name)), owner);

check('存進去了', await live() === 1, `live=${await live()}`);

// 刪掉它——這個 owner 現在一份都不剩
await p.evaluate(() => document.querySelector('[data-act="open"]').click());
await p.waitForTimeout(2500);
const removed = await p.evaluate((n) => {
  const rows = [...document.querySelectorAll('#projectList .project-row')];
  const row = rows.find((r) => r.textContent.includes(n));
  if (!row) return `找不到那一列（共 ${rows.length} 列）`;
  const del = [...row.querySelectorAll('button')].find((x) => /刪除/.test(x.title || x.textContent || ''));
  if (!del) return '那一列沒有刪除鈕';
  del.click(); return 'ok';
}, NAME);
check('刪得掉', removed === 'ok', removed);
await p.waitForTimeout(2000);
check('真的進了回收桶', (await binned()).includes(NAME));
check('存活清單空了', await live() === 0);

// 重開對話框：這就是那個「一份都不剩」的狀態
await p.evaluate(() => document.querySelector('[data-act="close-modal"]').click());
await p.waitForTimeout(300);
await p.evaluate(() => document.querySelector('[data-act="open"]').click());
await p.waitForTimeout(2500);

const seen = await p.evaluate(() => ({
  binRows: document.querySelectorAll('#projectList .project-row.binned').length,
  restore: document.querySelectorAll('#projectList button.restore').length,
  head: [...document.querySelectorAll('#projectList .proj-group')].map((e) => e.textContent).join(' / '),
}));
check('一份都不剩的時候，回收桶仍然看得到', seen.binRows >= 1 && seen.restore >= 1, JSON.stringify(seen));

if (seen.restore) {
  await p.evaluate(() => document.querySelector('#projectList button.restore').click());
  await p.waitForTimeout(2500);
  check('還原回得來', await live() === 1 && !(await binned()).includes(NAME));
}

// 收尾：把驗證用的那一份刪掉，不要留在資料庫裡
await p.evaluate((o) => fetch('/api/projects', { headers: { 'X-Owner': o } })
  .then((r) => r.json())
  .then((d) => Promise.all(d.projects.map((x) => fetch(`/api/projects/${x.id}`, { method: 'DELETE', headers: { 'X-Owner': o } })))), owner);

check('沒有 console 例外或失敗請求', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
console.log(fails ? `\n${fails} 項未通過` : '\n全部通過');
process.exit(fails ? 1 : 0);
