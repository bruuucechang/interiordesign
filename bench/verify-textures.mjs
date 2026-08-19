// 每一件家具的每一個材質都要有貼圖。
//
//   node bench/verify-textures.mjs           # 只印沒貼皮的
//   node bench/verify-textures.mjs --all     # 全部列出來
//
// 「都貼好了」被我講錯過三次，每一次的成因都一樣：抽樣看幾件、看起來有紋理就
// 宣布完成。這支把它變成可以驗的事實——把目錄裡每一件都實際建出來（該載模型的
// 載模型、該用程式蓋的蓋出來），走訪每一個 mesh 的每一個材質，數有幾個 `map`
// 是空的，並且把那個材質的名字印出來，這樣「哪裡沒貼」不需要猜。
//
// **有些材質沒有貼圖是對的**，所以清單分兩欄而不是一個數字：
//   · 玻璃、鏡面——真的沒有紋理，一張圖貼上去是憑空加髒污
//   · 上釉陶瓷（馬桶、洗手台）——兩個圖庫的 ceramic 掃描全是「磁磚」，含填縫與磨損
//   · 發光的燈罩
// 這些列在 EXEMPT 裡，逐條寫理由。**不在 EXEMPT 又沒有 map 的，就是漏掉的。**
//
// Headless，理由同 soak.mjs。

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'client/dist');
const ALL = process.argv.includes('--all');

// 材質名字對得上這些的，沒有貼圖是刻意的。
const EXEMPT = [
  { re: /glass|mirror|窗玻璃/i, why: '玻璃與鏡面本來就沒有紋理' },
  { re: /ceramic|porcelain/i,   why: '上釉陶瓷；圖庫的 ceramic 掃描全是磁磚，貼上去等於加髒污' },
  { re: /emissive|glow|shade|bulb/i, why: '自體發光的燈罩' },
  { re: /water/i,               why: '水面' },
];

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
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', (e) => console.error('PAGEERROR', String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForFunction(() => window.__app?.FURNITURE, null, { timeout: 60000 });

const report = await page.evaluate(async (exempt) => {
  const a = window.__app;
  const res = [];
  for (const item of a.FURNITURE) {
    // 先把模型載進來再建，不然量到的是還沒換上模型的那個程式生成版本——
    // 那正是「看起來有貼圖」但其實驗錯對象的典型。
    await a.loadFurnitureModel(item.id).catch(() => false);
    const o = a.getFurnitureModel(item.id, item.w, item.h);
    // applyScan 是非同步的。在這裡不等，量到的是「還沒貼上去」而不是「沒貼」——
    // 第一版就這樣，把一份混著兩種東西的清單當成結論。
    for (let i = 0; i < 200 && a.scansPending(); i++) await new Promise((r) => setTimeout(r, 25));
    const bare = [], okd = [];
    o.traverse((n) => {
      const mm = n.material;
      if (!mm) return;
      for (const m of (Array.isArray(mm) ? mm : [mm])) {
        if (!m) continue;
        const name = m.name || n.name || '(無名)';
        const textured = !!(m.map || m.normalMap || m.roughnessMap);
        if (textured) okd.push(name);
        else if (!exempt.some((e) => new RegExp(e.re, e.flags).test(name))) bare.push(name);
      }
    });
    res.push({ id: item.id, name: item.name, bare: [...new Set(bare)], ok: okd.length });
  }
  return res;
}, EXEMPT.map((e) => ({ re: e.re.source, flags: e.re.flags })));

const bad = report.filter((r) => r.bare.length);
for (const r of ALL ? report : bad) {
  const mark = r.bare.length ? '✘' : '✔';
  console.log(`  ${mark} ${r.id.padEnd(22)} ${r.name.padEnd(12)} 有貼圖 ${String(r.ok).padStart(3)}`
    + (r.bare.length ? `　沒貼圖: ${r.bare.slice(0, 6).join(', ')}` : ''));
}
console.log(bad.length
  ? `\n${bad.length} / ${report.length} 件有沒貼圖的材質`
  : `\n${report.length} 件全部貼好 ✔`);
await browser.close();
server.close();
process.exit(bad.length ? 1 : 0);
