// How many full canvas redraws one drag costs.
//
// The soak's roaming exercise mostly lands on empty space, which is the pan
// path — one redraw per pointer event either way — so it cannot see the thing
// this measures. Dragging a *multi-selection* is the expensive path: every
// object moved calls doc.update(), every update fires doc.onChange(), and that
// used to draw the whole canvas synchronously inside the pointermove handler.
// N objects selected meant N+1 redraws per event, all but the last thrown away
// before reaching the screen.
//
//   node bench/drag.mjs                  # current build
//   node bench/drag.mjs --selected 16
//
// Reports redraws per pointer event. The floor is well under 1: at 60 Hz a
// coalesced drag draws once a frame no matter how fast the events arrive.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'client/dist');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const SELECTED = arg('selected', 8);
const MOVES = arg('moves', 120);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(p === '/api/projects' ? { projects: [] } : p.startsWith('/api/rooms') ? { polygons: [] } : {}));
      return;
    }
    let f = join(DIST, p === '/' ? 'index.html' : p);
    if (!existsSync(f)) f = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    res.end(await readFile(f));
  });
  s.listen(0, () => ok(s));
});

const plan = (n) => {
  const objects = [];
  for (let i = 0; i < n; i++) {
    objects.push({
      id: 'f' + i, kind: 'furniture', layer: 'furniture', item: 'sofa', label: '沙發',
      x: 100 + (i % 6) * 220, y: 100 + Math.floor(i / 6) * 160, w: 180, h: 80, angle: 0,
    });
  }
  return {
    schemaVersion: 1, name: 'drag bench', activeFloorId: 'f1',
    floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects }],
    layers: [{ id: 'furniture', name: '家具', color: '#ffd479', visible: true }],
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.error('PAGEERROR', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);

await page.evaluate((p) => { window.__app.doc.load(p); window.__app.fit2D(); }, plan(SELECTED + 8));
await page.waitForTimeout(1200);

// Select N objects and put the pointer on one of them, so the drag takes the
// move path rather than the pan path.
// vp.toScreen gives canvas-relative pixels; page.mouse wants page pixels. The
// canvas sits below a toolbar and beside a sidebar, so the two differ by the
// canvas's bounding rect — get that wrong and every event lands outside the
// canvas, the drag silently becomes a pan, and the benchmark measures nothing.
const start = await page.evaluate((n) => {
  const objs = window.__app.doc.objects.slice(0, n);
  window.__app.doc.selectMany(objs.map((o) => o.id));
  const o = objs[0];
  const p = window.__app.editor.vp.toScreen({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
}, SELECTED);

await page.evaluate(() => {
  window.__perf.reset();
  window.__raf = 0;
  (function tick() { window.__raf++; requestAnimationFrame(tick); })();
});

const t0 = Date.now();
await page.mouse.move(start.x, start.y);
await page.mouse.down();
for (let k = 0; k < MOVES; k++) {
  await page.mouse.move(start.x + (k % 40) * 4, start.y + Math.sin(k / 5) * 40);
}
await page.mouse.up();
const ms = Date.now() - t0;

const r = await page.evaluate(() => window.__perf.snapshot().render2d);
const rafs = await page.evaluate(() => window.__raf);
const _ms = ms;
console.log(`  期間 rAF 觸發 ${rafs} 次（${(rafs / (Date.now() - 0) * 0).toFixed(0)}）→ 約 ${(rafs / (ms / 1000)).toFixed(0)}/秒`.replace('（0）', ''));
const after = await page.evaluate(() => ({
  x: window.__app.doc.objects[0].x,
  sel: window.__app.doc.selectedObjects.length,
  input: window.__app.editor.inputEnabled,
  canvasParent: document.querySelector('#pane2d')?.className,
}));
console.log('  診斷:', JSON.stringify(after), ' 起始 x=100');
const moved = after.sel === SELECTED;

console.log(`選取 ${SELECTED} 個物件、${MOVES} 次 pointermove、耗時 ${ms}ms`);
console.log(`  仍為多選: ${moved ? '是' : '否 —— 拖曳沒有走到多選路徑，數字不算數'}`);
console.log(`  重繪次數: ${r.count}   每次 pointermove ${(r.count / MOVES).toFixed(2)} 次`);
console.log(`  每次重繪 p50 ${r.p50.toFixed(2)}ms p95 ${r.p95.toFixed(2)}ms   重繪總耗時 ${(r.meanAll * r.count).toFixed(0)}ms`);
console.log(`  未合併時應為 ${MOVES * (SELECTED + 1)} 次`);

await browser.close();
server.close();
