// 把目錄分批拉近渲染，用來「看」而不是「推論」。
//
//   node bench/shot-items.mjs                 # 全部，每批 24 件
//   node bench/shot-items.mjs --batch 12      # 每批 12 件，更近
//   node bench/shot-items.mjs --from 48 --count 24
//
// bench/furniture.mjs 把 185 件排在同一張圖裡，那張適合看「有沒有東西不見了、
// 有沒有比例錯得離譜」，但每一件只有幾十個像素——**看不出材質**。要判斷「這件
// 看起來像不像程式硬生出來的」只能拉近看，所以這支一次只排一小批，相機貼著看。
//
// Headless，理由同 soak.mjs。

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'client/dist');
const OUT = join(ROOT, 'bench/results/items');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const BATCH = arg('--batch', 24), FROM = arg('--from', 0), COUNT = arg('--count', 0);

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

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
  // Benches are not testing onboarding, and the first-run tour would eat the
  // first Escape (its capture listener) and cover the app with an overlay.
  try { localStorage.setItem('interior_tour_seen', '1'); } catch { /* ignore */ }
});

page.on('pageerror', (e) => console.error('PAGEERROR', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForFunction(() => window.__app?.FURNITURE, null, { timeout: 60000 });

const all = await page.evaluate(() => window.__app.FURNITURE.map((f) => ({ id: f.id, w: f.w, h: f.h })));
const slice = COUNT ? all.slice(FROM, FROM + COUNT) : all.slice(FROM);
console.log(`${all.length} 件，這次渲 ${slice.length} 件，每批 ${BATCH}`);

for (let b = 0; b < slice.length; b += BATCH) {
  const items = slice.slice(b, b + BATCH);
  const COLS = Math.ceil(Math.sqrt(items.length));
  const CELL = 260;                                  // 每格 2.6 公尺，最大的家具也放得下
  const W = COLS * CELL, D = Math.ceil(items.length / COLS) * CELL;
  const objects = [{ id: 'r', kind: 'room', layer: 'rooms', x: 0, y: 0, w: W, h: D, name: '', floor: 'oaklight' }];
  items.forEach((it, i) => objects.push({
    id: `f${i}`, kind: 'furniture', layer: 'furniture', item: it.id, label: '', angle: 0,
    x: (i % COLS) * CELL + (CELL - it.w) / 2, y: Math.floor(i / COLS) * CELL + (CELL - it.h) / 2,
    w: it.w, h: it.h,
  }));
  await page.evaluate((plan) => window.__app.doc.load(plan), {
    schemaVersion: 1, name: 'items', activeFloorId: 'f1',
    floors: [{ id: 'f1', name: '1F', base: 0, height: 300, objects }],
    layers: [{ id: 'rooms', name: '房', color: '#4c8dff', visible: true },
             { id: 'furniture', name: '家具', color: '#e0b45a', visible: true }],
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('.view-modes button[data-mode="3d"]')?.click());
  // 模型是非同步載入的：固定等一段時間會拍到還沒換上模型的那一幀，圖照樣出得來、
  // 看起來也合理，只是拍的不是要看的東西。
  await page.evaluate(async (n) => {
    const got = () => performance.getEntriesByType('resource')
      .filter((e) => /\.(gltf|glb)$/.test(e.name)).length;
    const start = got();
    for (let i = 0; i < 160 && got() < start + n; i++) await new Promise((r) => setTimeout(r, 100));
  }, Math.min(items.length, 12));
  await page.waitForTimeout(3500);
  await page.evaluate(({ W, D }) => {
    const c = window.__app.view3d.camera;
    c.position.set(W / 2, Math.max(W, D) * 0.72, D * 1.05);
    c.lookAt(W / 2, 40, D / 2);
    c.updateProjectionMatrix();
  }, { W, D });
  await page.waitForTimeout(1800);
  const file = join(OUT, `items-${String(FROM + b).padStart(3, '0')}.png`);
  const box = await page.locator('#view3d canvas').boundingBox({ timeout: 120000 });
  await page.screenshot({ path: file, clip: box, timeout: 300000 });
  console.log(`  ${String(FROM + b).padStart(3, ' ')}–${FROM + b + items.length - 1}  ${items.map((i) => i.id).join(' ')}`);
}
console.log('→', OUT);
await browser.close();
server.close();
