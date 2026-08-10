// A screenshot of the 2D plan with several floor finishes side by side, so the
// hatching can be judged the same way the 3D materials are: by looking.
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

const finishes = ['wood', 'herringbone', 'tile', 'marble', 'terrazzo', 'carpet', 'concrete', 'walnut'];
const objects = [];
finishes.forEach((f, k) => {
  const x = (k % 4) * 520, y = Math.floor(k / 4) * 420;
  objects.push({ id: 'r' + k, kind: 'room', layer: 'rooms', x, y, w: 480, h: 380, name: f, floor: f });
  for (const [a, b] of [[[x,y],[x+480,y]], [[x+480,y],[x+480,y+380]], [[x+480,y+380],[x,y+380]], [[x,y+380],[x,y]]])
    objects.push({ id: `w${k}_${a[0]}_${a[1]}_${b[0]}`, kind: 'wall', layer: 'walls', a: {x:a[0],y:a[1]}, b: {x:b[0],y:b[1]}, thickness: 12 });
});
const plan = { schemaVersion: 1, name: '2d hatch', activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects }],
  layers: [{ id: 'walls', name: '牆', color: '#e6e9ef', visible: true }, { id: 'rooms', name: '房間', color: '#4c8dff', visible: true }] };

await mkdir(OUT, { recursive: true });
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => console.error('PAGEERROR', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);
await page.evaluate(p => { window.__app.doc.load(p); window.__app.fit2D(); }, plan);
await page.waitForTimeout(1200);
const file = join(OUT, '2d-hatch.png');
await page.locator('#canvas').screenshot({ path: file });
console.log('→', file);
await b.close(); server.close();
