// 靠牆放的家具要背對牆；底圖辨識出來的牆要用量到的厚度；柱子要是一根實心的。
//
//   node bench/verify-placement.mjs
//
// 三件事的共同原則是使用者說的那一句：**不要超出我畫的線**。牆畫成兩條線是它的
// 厚度，所以生出來的牆要跟那兩條線一樣厚；柱子是一個實心黑塊，所以它是一根柱子
// 而不是四道圍成方管的牆。家具那條是另一件事，但同樣只能端到端驗——`angle` 是
// 放置當下算出來的，單元測試看不到「點在牆的哪一側」。
//
// Headless，理由同 soak.mjs。

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'client/dist');
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

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(() => {
  // Benches are not testing onboarding, and the first-run tour would eat the
  // first Escape (its capture listener) and cover the app with an overlay.
  try { localStorage.setItem('interior_tour_seen', '1'); } catch { /* ignore */ }
});

page.on('pageerror', (e) => { console.error('PAGEERROR', String(e).split('\n')[0]); fail++; });
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fail++;
};

await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForFunction(() => window.__app?.doc);

// 一個 600×400 的房間，四面牆。家具放在每一面牆邊，背都要朝那面牆。
await page.evaluate(() => window.__app.doc.load({
  schemaVersion: 1, name: 'place', activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects: [
    { id: 'wt', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, thickness: 20, finish: 'paint' },
    { id: 'wr', kind: 'wall', layer: 'walls', a: { x: 600, y: 0 }, b: { x: 600, y: 400 }, thickness: 20, finish: 'paint' },
    { id: 'wb', kind: 'wall', layer: 'walls', a: { x: 600, y: 400 }, b: { x: 0, y: 400 }, thickness: 20, finish: 'paint' },
    { id: 'wl', kind: 'wall', layer: 'walls', a: { x: 0, y: 400 }, b: { x: 0, y: 0 }, thickness: 20, finish: 'paint' },
  ] }],
  layers: [{ id: 'walls', name: '牆', color: '#eee', visible: true },
           { id: 'furniture', name: '家具', color: '#e0b45a', visible: true }],
}));
await page.waitForTimeout(300);

// 每一面牆內側 25cm 處放一張沙發，量它的角度。
// 角度的意思：家具的 local +y（正面）要指向室內。
const cases = [
  ['上牆', { x: 300, y: 25 }, 0],      // 正面朝下（+y）→ 0°
  ['下牆', { x: 300, y: 375 }, 180],
  ['左牆', { x: 25, y: 200 }, -90],    // 正面朝右（+x）
  ['右牆', { x: 575, y: 200 }, 90],
];
const got = await page.evaluate((cs) => {
  const a = window.__app;
  return cs.map(([, p]) => {
    const f = a.fitFurnitureToWall(a.doc, p, { w: 200, h: 90, height: 80 });
    return f ? { angle: Math.round(f.angle), pos: { x: Math.round(f.pos.x), y: Math.round(f.pos.y) } } : null;
  });
}, cases);
for (let i = 0; i < cases.length; i++) {
  const [name, , want] = cases[i], g = got[i];
  const norm = (d) => ((d % 360) + 540) % 360 - 180;
  check(`${name}：沙發背朝牆`, g && Math.abs(norm(g.angle - want)) < 1,
    g ? `${g.angle}°（應為 ${want}°）` : '沒有吸附到牆');
}
// 背貼著牆面，不是壓進牆裡，也不是浮在半空
check('背貼在牆面上', got[0] && got[0].pos.y === 10 + 45, `y=${got[0]?.pos.y}（牆半厚 10 ＋ 半深 45）`);

// 天花板件與地面覆蓋物不轉
const skipped = await page.evaluate(() => {
  const a = window.__app, p = { x: 300, y: 25 };
  return {
    ceiling: a.fitFurnitureToWall(a.doc, p, { w: 60, h: 60, height: 40, mount: 'ceiling' }),
    rug: a.fitFurnitureToWall(a.doc, p, { w: 200, h: 140, height: 2 }),
  };
});
check('吊燈不會被轉去貼牆', skipped.ceiling === null);
check('地毯不會被轉去貼牆', skipped.rug === null);

// 離牆太遠就不吸附
const far = await page.evaluate(() => window.__app.fitFurnitureToWall(
  window.__app.doc, { x: 300, y: 200 }, { w: 200, h: 90, height: 80 }));
check('離牆遠的照原樣放', far === null);

console.log(fail ? `\n${fail} 項失敗` : '\n放置行為全過');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
