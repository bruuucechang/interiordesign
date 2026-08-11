// The partition line, end to end against the real backend.
//
// The unit tests cannot reach this one at all: a partition's entire job is to
// be included in the payload sent to /api/rooms/detect, and the failure — being
// left out — looks exactly like success. The line is drawn, no error appears,
// and the second room simply never shows up.
//
// Needs the backend on :8791. /api is proxied so the page's relative URLs work.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
const DIST = join(resolve(import.meta.dirname, '..'), 'client/dist');
const API = 'http://127.0.0.1:8791';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = await new Promise(ok => { const s = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/')) {
    const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
    try {
      const up = await fetch(API + req.url, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'GET' ? undefined : body });
      res.writeHead(up.status, { 'content-type': 'application/json' });
      res.end(await up.text());
    } catch (e) { res.writeHead(502); res.end(JSON.stringify({ error: String(e) })); }
    return;
  }
  let f = join(DIST, p === '/' ? 'index.html' : p); if (!existsSync(f)) f = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); res.end(await readFile(f));
}); s.listen(0, () => ok(s)); });

const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

const room = (extra = []) => ({ schemaVersion: 1, name: 't', activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects: [
    { id: 'w1', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 12 },
    { id: 'w2', kind: 'wall', layer: 'walls', a: { x: 400, y: 0 }, b: { x: 400, y: 300 }, thickness: 12 },
    { id: 'w3', kind: 'wall', layer: 'walls', a: { x: 400, y: 300 }, b: { x: 0, y: 300 }, thickness: 12 },
    { id: 'w4', kind: 'wall', layer: 'walls', a: { x: 0, y: 300 }, b: { x: 0, y: 0 }, thickness: 12 },
    ...extra] }],
  layers: [{ id: 'walls', name: '牆', color: '#eee', visible: true }, { id: 'rooms', name: '房間', color: '#4c8dff', visible: true }] });

const autoRooms = async () => page.evaluate(() =>
  window.__app.doc.objects.filter(o => o.kind === 'room' && o.auto).map(r => Math.round(r.w) + '×' + Math.round(r.h)));

await page.evaluate(p => window.__app.doc.load(p), room());
await page.waitForTimeout(1500);
const before = await autoRooms();
check('沒有隔間線時偵測到 1 間', before.length === 1, JSON.stringify(before));

await page.evaluate(p => window.__app.doc.load(p), room([
  { id: 'p1', kind: 'partition', layer: 'rooms', a: { x: 250, y: 0 }, b: { x: 250, y: 300 } }]));
await page.waitForTimeout(1500);
const after = await autoRooms();
check('加一條隔間線後變成 2 間', after.length === 2, JSON.stringify(after));
check('切出來的兩間寬度是 250 與 150', after.map(s => s.split('×')[0]).sort().join(',') === '150,250', JSON.stringify(after));

// 刪掉它，兩間要合回一間 —— 隔間線是活的，不是畫上去就固定了
await page.evaluate(() => { window.__app.doc.remove('p1'); });
await page.waitForTimeout(1500);
const removed = await autoRooms();
check('刪掉隔間線後合回 1 間', removed.length === 1, JSON.stringify(removed));

// 3D 不能生出任何東西
const in3d = await page.evaluate(async () => {
  document.querySelector('.view-modes button[data-mode="3d"]').click();
  await new Promise(r => setTimeout(r, 1500));
  let n = 0;
  window.__app.view3d.staticGroup.traverse(o => { if (o.isMesh) n++; });
  return n;
});
const in3dNoPart = await page.evaluate(async () => {
  window.__app.doc.add({ id: 'p2', kind: 'partition', layer: 'rooms', a: { x: 100, y: 0 }, b: { x: 100, y: 300 } });
  await new Promise(r => setTimeout(r, 1500));
  let n = 0;
  window.__app.view3d.staticGroup.traverse(o => { if (o.isMesh) n++; });
  return n;
});
check('隔間線在 3D 不生成任何幾何', in3d === in3dNoPart, `${in3d} → ${in3dNoPart}`);

check('全程沒有例外', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
await b.close(); server.close();
process.exit(fails ? 1 : 0);
