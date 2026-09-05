// Screenshots of the three view modes, so the split layout can be judged by eye.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..'), DIST = join(ROOT, 'client/dist');
const OUT = join(ROOT, 'bench/results/shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = await new Promise(ok => { const s = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/')) { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(p === '/api/projects' ? {projects:[]} : {polygons:[]})); return; }
  let f = join(DIST, p === '/' ? 'index.html' : p); if (!existsSync(f)) f = join(DIST, 'index.html');
  res.writeHead(200, {'content-type': MIME[extname(f)] ?? 'application/octet-stream'}); res.end(await readFile(f));
}); s.listen(0, () => ok(s)); });

const objects = [];
const rooms = [['客廳', 0, 0, 520, 400, 'wood'], ['臥室', 520, 0, 380, 400, 'carpet'], ['浴室', 0, 400, 260, 300, 'tile'], ['廚房', 260, 400, 640, 300, 'terrazzo']];
rooms.forEach(([name, x, y, w, h, floor], k) => {
  objects.push({ id: 'r' + k, kind: 'room', layer: 'rooms', x, y, w, h, name, floor });
  for (const [a, b] of [[[x,y],[x+w,y]], [[x+w,y],[x+w,y+h]], [[x+w,y+h],[x,y+h]], [[x,y+h],[x,y]]])
    objects.push({ id: `w${k}_${a[0]}_${a[1]}_${b[0]}_${b[1]}`, kind: 'wall', layer: 'walls', a: {x:a[0],y:a[1]}, b: {x:b[0],y:b[1]}, thickness: 12, finish: 'paint' });
});
objects.push({ id: 'win1', kind: 'window', layer: 'openings', x: 260, y: 0, width: 200, angle: 0 });
objects.push({ id: 'win2', kind: 'window', layer: 'openings', x: 700, y: 0, width: 160, angle: 0 });
objects.push({ id: 'd1', kind: 'door', layer: 'openings', x: 520, y: 200, width: 90, angle: 90 });
objects.push({ id: 'sofa', kind: 'furniture', layer: 'furniture', item: 'sofa', label: '沙發', x: 80, y: 120, w: 200, h: 90, angle: 0 });
objects.push({ id: 'bed', kind: 'furniture', layer: 'furniture', item: 'bed', label: '雙人床', x: 600, y: 90, w: 200, h: 210, angle: 0 });
const plan = { schemaVersion: 1, name: '分割檢視', activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects }],
  layers: [{ id: 'walls', name: '牆', color: '#e6e9ef', visible: true }, { id: 'rooms', name: '房間', color: '#4c8dff', visible: true }, { id: 'openings', name: '門窗', color: '#8bffb0', visible: true }, { id: 'furniture', name: '家具', color: '#ffd479', visible: true }] };

await mkdir(OUT, { recursive: true });
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
await page.addInitScript(() => {
  // Benches are not testing onboarding, and the first-run tour would eat the
  // first Escape (its capture listener) and cover the app with an overlay.
  try { localStorage.setItem('interior_tour_seen', '1'); } catch { /* ignore */ }
});

page.on('pageerror', e => console.error('PAGEERROR', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);
await page.evaluate(p => { window.__app.doc.load(p); window.__app.fit2D(); }, plan);
await page.waitForTimeout(1000);
for (const m of ['2d', 'split', '3d']) {
  await page.click(`.view-modes button[data-mode="${m}"]`);
  await page.waitForTimeout(2200);
  const f = join(OUT, `view-${m}.png`);
  await page.screenshot({ path: f });
  console.log('→', f);
}
await b.close(); server.close();
