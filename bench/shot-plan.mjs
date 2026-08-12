// Renders a plan file (or the traced A1 unit) in 2D and 3D so it can be checked
// by eye against the original drawing.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..'), DIST = join(ROOT, 'client/dist');
const OUT = join(ROOT, 'bench/results/shots');
const PLAN = process.argv[2];
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json' };
const server = await new Promise(ok => { const s = createServer(async (req,res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/')) {
    // Read-only proxy. The app autosaves whatever it has loaded, so a proxy
    // that forwards writes puts every test fixture into the real database —
    // it put three of them there before this was noticed, and they looked
    // exactly like the user's own plans in the list.
    if (req.method !== 'GET' && !/^\/api\/(rooms|dimensions|walls)\//.test(p)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true,"blocked":"bench proxy is read-only"}');
      return;
    }
    const body = await new Promise(r => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>r(b)); });
    try { const up = await fetch('http://127.0.0.1:8791'+req.url, { method:req.method, headers:{'content-type':'application/json'}, body: req.method==='GET'?undefined:body });
      res.writeHead(up.status,{'content-type':'application/json'}); res.end(await up.text());
    } catch { res.writeHead(200,{'content-type':'application/json'}); res.end('{"polygons":[]}'); }
    return;
  }
  let f = join(DIST, p==='/'?'index.html':p); if (!existsSync(f)) f = join(DIST,'index.html');
  res.writeHead(200,{'content-type':MIME[extname(f)]??'application/octet-stream'}); res.end(await readFile(f));
}); s.listen(0,()=>ok(s)); });

const plan = JSON.parse(await readFile(PLAN, 'utf8'));
await mkdir(OUT, { recursive: true });
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1700,height:1000} });
page.on('pageerror', e => console.error('PAGEERROR', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);
await page.evaluate(p => { window.__app.doc.load(p); window.__app.fit2D(); }, plan);
await page.waitForTimeout(3000);
for (const m of ['2d','split','3d']) {
  await page.click(`.view-modes button[data-mode="${m}"]`);
  await page.waitForTimeout(m === '2d' ? 1500 : 3500);
  const f = join(OUT, `a1-${m}.png`);
  await page.screenshot({ path: f });
  console.log('→', f);
}
const rooms = await page.evaluate(() => window.__app.doc.objects.filter(o => o.kind === 'room')
  .map(r => `${r.name} ${(r.w*r.h/10000).toFixed(1)}m²`));
console.log('\n房間:', rooms.join(' · '));
await b.close(); server.close();
