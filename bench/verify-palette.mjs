// 底部型錄列（B20）：分類、搜尋、風格篩選。
//
//   node bench/verify-palette.mjs
//
// 這三個控制項各自獨立，而「獨立」正是唯一值得端到端驗的性質：三者互相卡住的話，
// 一個空的第二排有三種可能的原因，使用者只能猜。所以這裡驗的是組合——搜尋加篩選
// 要是交集、搜尋跨分類、風格套在分類上，重載之後風格還在；外加一次只開一個分類。
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
await page.addInitScript(() => {
  // Benches are not testing onboarding, and the first-run tour would eat the
  // first Escape (its capture listener) and cover the app with an overlay.
  try { localStorage.setItem('interior_tour_seen', '1'); localStorage.setItem('interior_lang', 'zh-Hant'); } catch { /* ignore */ }
});

page.on('pageerror', (e) => { console.error('PAGEERROR', String(e).split('\n')[0]); fail++; });
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fail++;
};
// B20：家具在底部的型錄列，一次只展開一個分類。看得到的＝第二排（#catalogShelf）裡的按鈕。
const visible = () => page.$$eval('#catalogShelf .furn-btn[data-furn]', (b) => b.length);
const openTabs = () => page.$$eval('.cat-tab.open', (t) => t.map((x) => x.dataset.cat));
const count = (pred) => page.evaluate(`window.__app.FURNITURE.filter(${pred}).length`);

await page.goto(`${base}/?perf=1`);
await page.waitForSelector('.cat-tab[data-cat]');

check('一開始第二排收著（畫面留給房子）', (await page.$eval('#catalogShelf', (e) => e.classList.contains('hidden'))) && (await visible()) === 0);

// --- 每個家具分類點開，件數跟目錄對得上；全部加起來＝整份目錄 ---
const cats = await page.$$eval('.cat-tab[data-cat]', (t) => t.map((x) => x.dataset.cat));
let sum = 0;
for (const c of cats) {
  if (c === 'structure') continue;
  await page.click(`.cat-tab[data-cat="${c}"]`);
  await page.waitForTimeout(40);
  const n = await visible();
  const expect = c === 'lights' ? await count("f => f.cat === '燈具'") : await count(`f => f.cat === '${c === 'lights' ? '燈具' : c}'`);
  if (!(n === expect)) check(`分類「${c}」件數`, false, `${n} / ${expect}`);
  sum += n;
}
const total = await page.evaluate(() => window.__app.FURNITURE.length);
check('每個分類點開的件數加起來＝整份目錄', sum === total, `${sum} / ${total}`);
check('一次只開一個分類', (await openTabs()).length === 1);
const last = cats[cats.length - 1];
await page.click(`.cat-tab[data-cat="${last}"]`);
await page.waitForTimeout(40);
check('再點一次同一個分類就收起來', (await openTabs()).length === 0 && (await page.$eval('#catalogShelf', (e) => e.classList.contains('hidden'))));

// --- 燈與電：小分類 ---
await page.click('.cat-tab[data-cat="lights"]');
await page.click('#catalogShelf .chip:has-text("插座")');
await page.waitForTimeout(40);
check('燈與電 → 插座只剩插座', (await page.$$eval('#catalogShelf [data-elec]', (b) => b.length)) === 5 && (await visible()) === 0);

// --- 搜尋跨分類，而且不屬於哪個分類 ---
await page.fill('.furn-search', '衣櫃');
await page.waitForTimeout(80);
const q = await visible();
const expectQ = await count("f => f.name.includes('衣櫃')");
check('搜尋「衣櫃」跨分類找', q === expectQ && q > 1, `${q} 件（目錄裡有 ${expectQ} 件）`);
check('搜尋時沒有分類亮著', (await openTabs()).length === 0);

// --- 搜尋 + 風格是交集 ---
await page.selectOption('.style-select', '現代');
await page.waitForTimeout(80);
const both = await visible();
const expectBoth = await count("f => f.name.includes('衣櫃') && f.style === '現代'");
check('搜尋 ∩ 風格', both === expectBoth && both < q, `${both} 件`);

// --- 清掉搜尋，風格留著，套在分類上 ---
await page.fill('.furn-search', '');
await page.click('.cat-tab[data-cat="客廳"]');
await page.waitForTimeout(80);
const livingModern = await visible();
check('只留風格，客廳只剩現代', livingModern === await count("f => f.cat === '客廳' && f.style === '現代'"), `${livingModern} 件`);
check('分類上的數字跟著風格', (await page.$eval('.cat-tab[data-cat="客廳"] .cat-n', (e) => e.textContent)) === String(livingModern));

// --- 風格單選：換一個就取代 ---
await page.selectOption('.style-select', '古典');
await page.waitForTimeout(80);
const classic = await visible();
check('選另一個風格會取代前一個', classic === await count("f => f.cat === '客廳' && f.style === '古典'"), `${classic} 件（古典）`);

// --- 篩到沒有東西時說為什麼 ---
await page.click('.cat-tab[data-cat="浴室"]');
await page.waitForTimeout(80);
if ((await visible()) === 0) check('篩到空的時候第二排說怎麼辦', (await page.textContent('#catalogShelf')).includes('全部風格'));

// --- 重載之後風格還在 ---
await page.reload();
await page.waitForSelector('.cat-tab[data-cat]');
check('重載後風格還記得', (await page.$eval('.style-select', (e) => e.value)) === '古典');

// --- 全部風格 ---
await page.selectOption('.style-select', '');
await page.click('.cat-tab[data-cat="客廳"]');
await page.waitForTimeout(80);
check('「全部風格」清掉篩選', (await visible()) === await count("f => f.cat === '客廳'"));

// --- 點一件就拿在手上 ---
await page.click('#catalogShelf .furn-btn[data-furn]');
check('點一件家具就切到放家具', await page.evaluate(() => window.__app.editor.toolName === 'furniture'));

console.log(fail ? `\n${fail} 項失敗` : '\n面板全過');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
