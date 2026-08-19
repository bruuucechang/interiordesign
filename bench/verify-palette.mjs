// 左側家具面板：搜尋、風格篩選、分類摺疊。
//
//   node bench/verify-palette.mjs
//
// 這三個控制項各自獨立，而「獨立」正是唯一值得端到端驗的性質：單元測試看不到
// `display: none`，而三者互相卡住的話，一個空面板有三種可能的原因，使用者只能猜。
// 所以這裡驗的是組合——搜尋加篩選要是交集，摺疊不能改變誰被篩掉，重載之後
// 兩個狀態都還在。
//
// Headless，理由同 soak.mjs。

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'client/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' };

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(p === '/api/projects' ? { projects: [] } : { polygons: [] }));
      return;
    }
    const f = join(DIST, p === '/' ? 'index.html' : p);
    if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    res.end(await readFile(f));
  });
  s.listen(0, () => ok(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on('pageerror', (e) => { console.error('PAGEERROR', String(e).split('\n')[0]); fail++; });
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fail++;
};
const visible = () => page.$$eval('.furn-btn[data-furn]', (b) => b.filter((x) => x.style.display !== 'none').length);
const heads = () => page.$$eval('.furn-head', (h) => h.filter((x) => x.style.display !== 'none').map((x) => x.textContent));

await page.goto(`${base}/?perf=1`);
await page.waitForSelector('.furn-btn', { state: 'attached' });   // 摺疊還原後第一顆可能是隱藏的

const total = await visible();
const catalogue = await page.evaluate(() => window.__app.FURNITURE.length);
check('一開始全部顯示', total === catalogue, `${total} / ${catalogue}`);

// --- 搜尋 ---
await page.fill('.furn-search', '衣櫃');
await page.waitForTimeout(80);
const q = await visible();
const expectQ = await page.evaluate(() => window.__app.FURNITURE.filter((f) => f.name.includes('衣櫃')).length);
check('搜尋「衣櫃」', q === expectQ && q > 1, `${q} 件（目錄裡有 ${expectQ} 件）`);
check('沒有結果的分類整段收起來', (await heads()).every((t) => !/(\D)0$/.test(t)));

// --- 搜尋 + 風格是交集，不是互相取代 ---
await page.click('.chip:has-text("現代")');
await page.waitForTimeout(80);
const both = await visible();
const expectBoth = await page.evaluate(() =>
  window.__app.FURNITURE.filter((f) => f.name.includes('衣櫃') && f.style === '現代').length);
check('搜尋 ∩ 風格', both === expectBoth && both < q, `${both} 件`);

// --- 清掉搜尋，只留風格 ---
await page.fill('.furn-search', '');
await page.waitForTimeout(80);
const onlyStyle = await visible();
const expectStyle = await page.evaluate(() => window.__app.FURNITURE.filter((f) => f.style === '現代').length);
check('只留風格', onlyStyle === expectStyle, `${onlyStyle} 件`);

// --- 風格是單選：按第二顆要把第一顆放掉 ---
await page.click('.chip:has-text("古典")');
await page.waitForTimeout(80);
const two = await visible();
const expectTwo = await page.evaluate(() => window.__app.FURNITURE.filter((f) => f.style === '古典').length);
check('選另一個風格會取代前一個', two === expectTwo, `${two} 件（古典）`);
check('前一個風格的按鈕已經不再亮著', (await page.$$('.chip.on')).length === 1);

// 再按一次同一顆 = 回到全部
await page.click('.chip:has-text("古典")');
await page.waitForTimeout(80);
check('再按一次同一顆回到全部', (await visible()) === total);
await page.click('.chip:has-text("古典")');
await page.waitForTimeout(80);

// --- 摺疊不影響「誰被篩掉」，只影響看不看得到 ---
const firstHead = await page.$('.furn-head:not([style*="none"])');
await firstHead.click();
await page.waitForTimeout(80);
const afterFold = await visible();
check('摺疊不改變篩選結果', afterFold === two, `${afterFold} 件仍在篩選內`);
const gridHidden = await page.$$eval('.furn-head', (hs) => {
  const h = hs.find((x) => x.classList.contains('collapsed'));
  return h ? getComputedStyle(h.nextElementSibling).display === 'none' : false;
});
check('摺疊真的把格線收起來', gridHidden);

// --- 重載之後兩個狀態都還在 ---
await page.reload();
await page.waitForSelector('.furn-btn', { state: 'attached' });   // 摺疊還原後第一顆可能是隱藏的
await page.waitForTimeout(150);
check('重載後風格還記得', (await visible()) === two, `${await visible()} 件`);
check('重載後摺疊還記得', (await page.$$('.furn-head.collapsed')).length === 1);

// --- 全部 ---
await page.click('.chip:has-text("全部")');
await page.waitForTimeout(80);
check('「全部」清掉風格', (await visible()) === total);

console.log(fail ? `\n${fail} 項失敗` : '\n面板全過');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
