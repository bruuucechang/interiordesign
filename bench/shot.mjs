// Screenshots of the 3D view, one per material.
//
// Unit tests can say the normal map is unit length and points the right way.
// They cannot say the floor looks like a floor. This renders a room with each
// finish and writes a PNG, so the answer to "does it look right" comes from
// looking at it.
//
//   node bench/shot.mjs                 # every floor material
//   node bench/shot.mjs --wall          # every wall material
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
const WALLS = process.argv.includes('--wall');

// .jpg matters now that materials load photographed maps from /textures — a
// wrong or missing content-type here would fall back to index.html and the shot
// would quietly show the generated texture instead of the one being checked.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(p === '/api/projects' ? { projects: [] } : { polygons: [] }));
      return;
    }
    let f = join(DIST, p === '/' ? 'index.html' : p);
    if (!existsSync(f)) f = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    res.end(await readFile(f));
  });
  s.listen(0, () => ok(s));
});

// A single room with four walls, a door and a window — enough surface for a
// floor finish to tile across and for light to rake along a wall.
const room = (floor, finish) => ({
  schemaVersion: 1, name: 'shot', activeFloorId: 'f1',
  floors: [{
    id: 'f1', name: '1F', base: 0, height: 270,
    objects: [
      { id: 'w1', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, thickness: 12, finish },
      { id: 'w2', kind: 'wall', layer: 'walls', a: { x: 600, y: 0 }, b: { x: 600, y: 450 }, thickness: 12, finish },
      { id: 'w3', kind: 'wall', layer: 'walls', a: { x: 600, y: 450 }, b: { x: 0, y: 450 }, thickness: 12, finish },
      { id: 'w4', kind: 'wall', layer: 'walls', a: { x: 0, y: 450 }, b: { x: 0, y: 0 }, thickness: 12, finish },
      { id: 'win', kind: 'window', layer: 'openings', x: 300, y: 0, width: 180, angle: 0 },
      { id: 'dr', kind: 'door', layer: 'openings', x: 0, y: 225, width: 90, angle: 90 },
      { id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 600, h: 450, name: '樣板房', floor },
    ],
  }],
  layers: [
    { id: 'walls', name: '牆', color: '#e6e9ef', visible: true },
    { id: 'rooms', name: '房間', color: '#4c8dff', visible: true },
    { id: 'openings', name: '門窗', color: '#8bffb0', visible: true },
  ],
});

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
await page.addInitScript(() => {
  // Benches are not testing onboarding, and the first-run tour would eat the
  // first Escape (its capture listener) and cover the app with an overlay.
  try { localStorage.setItem('interior_tour_seen', '1'); } catch { /* ignore */ }
});

page.on('pageerror', (e) => console.error('PAGEERROR', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);

// 從 App 自己的材質清單取，不要在這裡再抄一份：抄的那一份不會跟著新增的材質
// 更新，於是新材質永遠不會被渲出來看——而這支工具存在的唯一理由就是看。
const list = await page.evaluate((w) => {
  const a = window.__app;
  if (!a?.floorMaterials) throw new Error('__app 沒有材質清單 —— main.ts 的 ?perf=1 匯出改過了');
  return (w ? a.wallMaterials() : a.floorMaterials()).map((m) => m.id);
}, WALLS);
console.log(`${list.length} 種${WALLS ? '牆面' : '地板'}材質`);

// Switch to 3D as the main view, so it renders at full resolution with AO.
// 三段選擇器，不是舊的切換鈕。找不到就丟例外——一個安靜停止測試半個
// 程式的測試架構，比一個會失敗的糟得多。
await page.evaluate(() => {
  const b = document.querySelector('.view-modes button[data-mode="3d"]');
  if (!b) throw new Error('找不到 3D 檢視按鈕 —— 版面改過了');
  b.click();
});
await page.waitForTimeout(600);

for (const id of list) {
  await page.evaluate((p) => { window.__app.doc.load(p); }, WALLS ? room('wood', id) : room(id, 'paint'));
  // 等這個材質的實拍貼圖真的到齊再截。貼圖改成非同步載入之後，1600ms 的固定
  // 等待會截到「程式生成的備援」那一幀——圖照樣產出、看起來也合理，只是拍的
  // 不是要驗的東西。到齊之後 onTexturesReady 會讓 3D 重建，所以還要再等一次。
  await page.evaluate(async (mid) => {
    const has = (n) => performance.getEntriesByType('resource')
      .filter((e) => e.name.includes(`/textures/${n}/`)).length >= 3;
    for (let i = 0; i < 50 && !has(mid); i++) await new Promise((r) => setTimeout(r, 100));
  }, id);
  await page.waitForTimeout(1800);   // rebuild + a few frames of AO
  const file = join(OUT, `${WALLS ? 'wall' : 'floor'}-${id}.png`);
  // page.screenshot + clip，不是 locator.screenshot：後者會等元素「穩定」，而
  // 貼圖到齊觸發的重建剛好讓它永遠等不到。
  const box = await page.locator('#view3d canvas').boundingBox();
  await page.screenshot({ path: file, clip: box });
  console.log('→', file);
}

await browser.close();
server.close();
