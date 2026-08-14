// Screenshots of every catalogue item, laid out in one room.
//
// Seventeen of them are CC0 scanned models (scripts/fetch_models.py) and the
// rest are built in code. Neither kind has a unit test that can say it looks
// like the thing it is named after, and a scanned model brings its own ways to
// be wrong that code does not: buried in the floor, floating, facing sideways,
// scaled by a thousand. This renders them all so those are visible.
//
//   node bench/furniture.mjs            # 俯視全部
//   node bench/furniture.mjs --close    # 拉近看細節
//
// Headless, for the reason in soak.mjs: a covered Chrome window renders nothing.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'client/dist');
const OUT = join(ROOT, 'bench/results/shots');
const CLOSE = process.argv.includes('--close');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
};
// 404 rather than falling back to index.html: a missing .gltf served as HTML
// makes the loader fail with a parse error a long way from the cause.
const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(p === '/api/projects' ? { projects: [] } : { polygons: [] }));
      return;
    }
    const f = join(DIST, p === '/' ? 'index.html' : p);
    if (!existsSync(f)) { console.log('404', p); res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    res.end(await readFile(f));
  });
  s.listen(0, () => ok(s));
});

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('PAGEERROR', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);

// 清單向 App 要。在這裡抄一份的話，新增的品項永遠不會被渲出來看——而這支工具
// 存在的唯一理由就是看。
const items = await page.evaluate(() => {
  const a = window.__app;
  if (!a?.FURNITURE) throw new Error('__app 沒有家具目錄 —— main.ts 的 ?perf=1 匯出改過了');
  return a.FURNITURE.map((f) => ({ id: f.id, w: f.w, h: f.h }));
});
console.log(`${items.length} 件家具`);

// Laid out in rows at each piece's own catalogue size, with a gap wide enough
// that a model scaled wrong is obvious rather than merely overlapping.
const GAP = 90, WIDE = 1900;
const placed = [];
let x = GAP, y = GAP, rowH = 0;
for (const it of items) {
  if (x + it.w > WIDE - GAP) { x = GAP; y += rowH + GAP; rowH = 0; }
  placed.push({ ...it, x, y });
  x += it.w + GAP;
  rowH = Math.max(rowH, it.h);
}
const deep = y + rowH + GAP;

const objects = [{ id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: WIDE, h: deep, name: '目錄', floor: 'oaklight' }];
const corners = [[0, 0, WIDE, 0], [WIDE, 0, WIDE, deep], [WIDE, deep, 0, deep], [0, deep, 0, 0]];
corners.forEach(([ax, ay, bx, by], i) => objects.push({
  id: `w${i}`, kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 12, finish: 'paint',
}));
placed.forEach((p, i) => objects.push({
  id: `f${i}`, kind: 'furniture', layer: 'furniture', item: p.id, label: p.id, angle: 0,
  x: p.x, y: p.y, w: p.w, h: p.h,
}));

await page.evaluate((plan) => window.__app.doc.load(plan), {
  schemaVersion: 1, name: 'catalogue', activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects }],
  layers: [
    { id: 'walls', name: '牆', color: '#eee', visible: true },
    { id: 'rooms', name: '房', color: '#4c8dff', visible: true },
    { id: 'furniture', name: '家具', color: '#e0b45a', visible: true },
  ],
});
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('.view-modes button[data-mode="3d"]').click());

// 等模型真的到齊再截：它們是非同步載入的，固定等一段時間會拍到還沒換上模型的
// 那一幀——圖照樣產出、看起來也合理，只是拍的不是要驗的東西。
await page.evaluate(async (n) => {
  const got = () => performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.gltf')).length;
  for (let i = 0; i < 120 && got() < n; i++) await new Promise((r) => setTimeout(r, 150));
  return got();
}, Math.min(items.length, 17));
await page.waitForTimeout(4000);

if (CLOSE) {
  await page.evaluate(() => {
    const c = window.__app.view3d.camera;
    c.position.set(700, 190, 700); c.lookAt(700, 60, 250); c.updateProjectionMatrix();
  });
  await page.waitForTimeout(2500);
}
console.log('模型載入狀況:', await page.evaluate(async () => {
  const r = performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.gltf'));
  return { gltf: r.length, names: r.map((e) => e.name.split('/').slice(-2, -1)[0]).join(',') };
}));
const file = join(OUT, CLOSE ? 'furniture-close.png' : 'furniture.png');
const box = await page.locator('#view3d canvas').boundingBox();
await page.screenshot({ path: file, clip: box });
console.log('→', file);
await browser.close();
server.close();
