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
page.on('pageerror', (e) => console.error('PAGEERROR', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);

const list = WALLS
  ? ['paint', 'plaster', 'brick', 'walltile', 'wallpaper']
  : ['wood', 'walnut', 'herringbone', 'tile', 'marble', 'terrazzo', 'carpet', 'concrete'];

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
  await page.waitForTimeout(1600);   // rebuild + a few frames of AO
  const file = join(OUT, `${WALLS ? 'wall' : 'floor'}-${id}.png`);
  await page.locator('#view3d canvas').screenshot({ path: file });
  console.log('→', file);
}

await browser.close();
server.close();
