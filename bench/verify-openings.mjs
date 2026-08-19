// 門窗兩側的牆長：面板上兩個欄位連動，圖上不再畫。
//
//   node bench/verify-openings.mjs
//
// 這兩個值是同一個事實的兩種說法（left + 寬度 + right ≡ 牆長），所以要驗的是
// **它們不會互相矛盾**。而且矛盾最容易發生在編輯的當下：`doc.onChange` 裡的
// refreshProps 在焦點還在屬性面板時會刻意跳過（不然打到一半的輸入框會被換掉），
// 所以正在改的那一刻正是面板最不會自己更新的時候。
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

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', (e) => { console.error('PAGEERROR', String(e).split('\n')[0]); fail++; });
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fail++;
};

await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForFunction(() => window.__app?.doc);

// 一道 600 公分的牆，中間一扇 90 公分的門 → 兩側各 255
await page.evaluate(() => window.__app.doc.load({
  schemaVersion: 1, name: 'openings', activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects: [
    { id: 'w1', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, thickness: 12, finish: 'paint' },
    { id: 'd1', kind: 'door', layer: 'openings', x: 300, y: 0, width: 90, height: 210, angle: 0, style: 'single' },
  ] }],
  layers: [{ id: 'walls', name: '牆', color: '#eee', visible: true },
           { id: 'openings', name: '門窗', color: '#8bffb0', visible: true }],
}));
await page.waitForTimeout(400);
await page.evaluate(() => { const d = window.__app.doc; d.selectedIds = ['d1']; d.emit(); });
await page.waitForTimeout(300);

const fields = () => page.$$eval('#properties .prop', (rows) => Object.fromEntries(
  rows.map((r) => [r.querySelector('label')?.textContent ?? '', r.querySelector('input')?.value ?? ''])
    .filter(([k]) => /牆長|寬度/.test(k))));

const f0 = await fields();
const key = (frag) => Object.keys(f0).find((k) => k.includes(frag));
const [kl, kr, kw] = ['左側牆長', '右側牆長', '寬度'].map(key);
check('左右牆長欄位都在', !!kl && !!kr, JSON.stringify(f0));
check('置中的門兩側相等', f0[kl] === f0[kr], `${f0[kl]} / ${f0[kr]}`);

// --- 改左邊，右邊要跟著動（而且是在焦點還在面板裡的時候） ---
const leftSel = `#properties .prop:has(label:text-is("${kl}")) input`;
const rightSel = `#properties .prop:has(label:text-is("${kr}")) input`;
await page.fill(leftSel, '100');
await page.waitForTimeout(200);
let f = await fields();
check('改左側，右側跟著變', Number(f[kr]) === 410, `左 ${f[kl]} → 右 ${f[kr]}（應為 410）`);
// 用 locator.evaluate 而不是 page.evaluate + querySelector：`:text-is()` 是
// Playwright 自己的選擇器引擎，瀏覽器的 querySelector 不認得。
check('焦點還留在左側欄位', await page.locator(leftSel).evaluate((el) => el === document.activeElement));

// --- 反過來 ---
await page.fill(rightSel, '150');
await page.waitForTimeout(200);
f = await fields();
check('改右側，左側跟著變', Number(f[kl]) === 360, `右 ${f[kr]} → 左 ${f[kl]}（應為 360）`);

// --- 超出牆長要夾住 ---
await page.fill(leftSel, '9999');
await page.waitForTimeout(200);
f = await fields();
check('超出範圍時對面立刻反映夾住的結果', Number(f[kr]) === 0, `右 ${f[kr]}（應為 0）`);
check('正在打字的那一格不被改寫', Number(f[kl]) === 9999, `左 ${f[kl]}`);
await page.locator(leftSel).blur();
await page.waitForTimeout(150);
f = await fields();
check('離開欄位後校正成真正發生的值', Number(f[kl]) === 510, `左 ${f[kl]}（應為 510）`);

// --- 改寬度，兩側都要跟著重算 ---
await page.fill(leftSel, '200');
await page.waitForTimeout(150);
await page.fill(`#properties .prop:has(label:text-is("${kw}")) input`, '120');
await page.waitForTimeout(250);
f = await fields();
check('改寬度後兩側加總仍等於牆長',
  Math.round(Number(f[kl]) + 120 + Number(f[kr])) === 600, `${f[kl]} + 120 + ${f[kr]}`);

// --- 圖上不再畫那兩個綠色數字 ---
const green = await page.evaluate(() => {
  const c = document.querySelector('#view2d canvas') ?? document.querySelector('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4)            // #8bffb0 前後
    if (d[i] > 0x70 && d[i] < 0xa8 && d[i + 1] > 0xe0 && d[i + 2] > 0x90 && d[i + 2] < 0xd0) n++;
  return n;
});
check('圖上沒有那組薄荷綠數字了', green === 0, `${green} 個綠色像素`);

console.log(fail ? `\n${fail} 項失敗` : '\n門窗牆長全過');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
