// End-to-end checks for the wall editing added on top of wallEdit.ts.
//
// The unit tests cover the geometry. What they cannot cover is whether the
// button is wired to it, whether Space reaches the tool, and whether the
// topbar shows the mode the editor is actually in — all of which fail silently
// (the wall just lands somewhere slightly wrong).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
const DIST = join(resolve(import.meta.dirname, '..'), 'client/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = await new Promise(ok => { const s = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/')) { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(p === '/api/projects' ? {projects:[]} : {polygons:[]})); return; }
  let f = join(DIST, p === '/' ? 'index.html' : p); if (!existsSync(f)) f = join(DIST, 'index.html');
  res.writeHead(200, {'content-type': MIME[extname(f)] ?? 'application/octet-stream'}); res.end(await readFile(f));
}); s.listen(0, () => ok(s)); });

const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

// --- 基準線：按鈕與空白鍵是同一份狀態 ---
await page.click('#wallRef button[data-ref="left"]');
check('按鈕切到左緣', await page.evaluate(() => window.__app.editor.wallRef) === 'left');
check('按鈕會亮起來', await page.evaluate(() => !!document.querySelector('#wallRef button[data-ref="left"].active')));

await page.click('.tool-btn[data-tool="wall"]').catch(() => page.evaluate(() => window.__app.editor.selectTool('wall')));
await page.evaluate(() => window.__app.editor.selectTool('wall'));
await page.keyboard.press('r');
const afterSpace = await page.evaluate(() => window.__app.editor.wallRef);
check('R 鍵接著往下切', afterSpace === 'right', afterSpace);
check('R 鍵切完按鈕跟著亮', await page.evaluate(() => !!document.querySelector('#wallRef button[data-ref="right"].active')));

// --- 基準線真的位移了畫出來的牆 ---
const drawn = await page.evaluate(async () => {
  const { editor, doc } = window.__app;
  const r = {};
  for (const ref of ['center', 'left', 'right']) {
    doc.load({ schemaVersion: 1, name: 't', activeFloorId: 'f1',
      floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects: [] }],
      layers: [{ id: 'walls', name: '牆', color: '#eee', visible: true }] });
    editor.setWallRef(ref);
    editor.selectTool('wall');
    const t = editor.tools.wall;
    const P = (x, y) => ({ world: { x, y }, snapped: { x, y }, screen: { x: 0, y: 0 }, shift: false });
    editor.snapEnabled = false;
    t.onDown(P(0, 0)); t.onDown(P(400, 0));
    const w = doc.objects.find(o => o.kind === 'wall');
    r[ref] = w ? Math.round(w.a.y * 100) / 100 : null;
    t.deactivate();
  }
  return r;
});
check('中心線模式：牆就在點的位置', drawn.center === 0, JSON.stringify(drawn));
check('左右緣模式：牆各偏半個厚度且方向相反', drawn.left !== 0 && drawn.right === -drawn.left, JSON.stringify(drawn));

// --- 分割 ---
const sp = await page.evaluate(() => {
  const { editor, doc } = window.__app;
  doc.load({ schemaVersion: 1, name: 't', activeFloorId: 'f1',
    floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects: [
      { id: 'w1', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 24 }] }],
    layers: [{ id: 'walls', name: '牆', color: '#eee', visible: true }] });
  doc.select('w1');
  const ok = editor.splitSelectedWall(150);
  const ws = doc.objects.filter(o => o.kind === 'wall');
  return { ok, n: ws.length, ids: ws.map(w => w.id), th: ws.map(w => w.thickness),
           lens: ws.map(w => Math.round(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y))) };
});
check('分割產生兩道牆', sp.ok && sp.n === 2, JSON.stringify(sp));
check('長度是 150 + 250', sp.lens.sort((a, z) => a - z).join(',') === '150,250', sp.lens.join(','));
check('兩道 id 不同', new Set(sp.ids).size === 2, sp.ids.join(','));
check('厚度兩邊都保留', sp.th.every(x => x === 24), sp.th.join(','));

// --- 對齊 ---
const al = await page.evaluate(() => {
  const { editor, doc } = window.__app;
  doc.load({ schemaVersion: 1, name: 't', activeFloorId: 'f1',
    floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects: [
      { id: 'a', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, thickness: 12 },
      { id: 'b', kind: 'wall', layer: 'walls', a: { x: 600, y: 7 }, b: { x: 800, y: 7 }, thickness: 12 },
      { id: 'c', kind: 'wall', layer: 'walls', a: { x: 0, y: 300 }, b: { x: 200, y: 500 }, thickness: 12 }] }],
    layers: [{ id: 'walls', name: '牆', color: '#eee', visible: true }] });
  doc.selectMany(['a', 'b', 'c']);
  const r = editor.alignWallFaces('center');
  return { r, ys: doc.objects.filter(o => o.kind === 'wall').map(w => [w.id, w.a.y]) };
});
check('對齊回報移了 1 道、跳過 1 道', al.r.moved === 1 && al.r.skipped === 1, JSON.stringify(al.r));
check('平行的那道被拉平', al.ys.find(x => x[0] === 'b')[1] === 0, JSON.stringify(al.ys));
check('斜的那道原地不動', al.ys.find(x => x[0] === 'c')[1] === 300, JSON.stringify(al.ys));

check('全程沒有例外', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
await b.close(); server.close();
process.exit(fails ? 1 : 0);
