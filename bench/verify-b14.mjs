// B14：拆 3D 程式之後證明畫面沒變（.claude/rules/layering.md「重構 3D 之後怎麼證明沒改壞」）。
//
// plan1151022 在 2D 載入後切 3D，擺三個固定視角各截一張：鳥瞰（build 的 reframe）、
// 站在房間裡抬頭看天花板（燈）、靠近家具的斜角。拆前拆後各跑一次，再用 --compare 比。
//
//   node bench/verify-b14.mjs shoot <前綴>          # 例：before／after
//   node bench/verify-b14.mjs compare <前綴A> <前綴B>
//
// 需要 npm run dev（:5180 + :8791）。只讀：所有寫入請求一律攔掉。
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const [cmd, a, b] = process.argv.slice(2);
const BASE = 'http://localhost:5180';
const PLAN = 'plan1151022';
const OWNER = 'own_orsxp52fbvey';
const OUT = new URL('./results/', import.meta.url).pathname;
const VIEWS = ['overview', 'ceiling', 'furniture'];

if (cmd === 'compare') {
  let bad = 0;
  for (const v of VIEWS) {
    const r = execFileSync(new URL('../.venv/bin/python', import.meta.url).pathname, ['-c', `
import cv2,sys; x=cv2.imread(sys.argv[1]); y=cv2.imread(sys.argv[2])
d=cv2.absdiff(x,y); print(f"{d.mean():.4f} {(d.max(axis=2)>8).mean()*100:.4f}")`,
      `${OUT}b14-${a}-${v}.png`, `${OUT}b14-${b}-${v}.png`]).toString().trim();
    const [mean, pct] = r.split(' ').map(Number);
    // JPEG 雜訊量級是 0.005；PNG 的 swiftshader 截圖同一版重截兩次的差就是這裡的底
    const ok = mean < 0.05 && pct < 0.05;
    if (!ok) bad++;
    console.log(`${ok ? '✔' : '✖'} ${v}  平均差 ${mean}  差異 >8 的像素 ${pct}%`);
  }
  process.exit(bad ? 1 : 0);
}

const br = await chromium.launch({ timeout: 120000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await br.newPage({ viewport: { width: 1500, height: 950 } });
await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
await page.addInitScript(([owner]) => {
  try {
    localStorage.setItem('interior_tour_seen', '1');
    localStorage.setItem('interior_view_mode', '2d');
    localStorage.setItem('interior_lang', 'zh-Hant');
    localStorage.setItem('interior_owner', owner);
  } catch { /* ignore */ }
}, [OWNER]);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto(`${BASE}/?perf=1&plan=${PLAN}`, { timeout: 400000 });
await page.waitForFunction((id) => window.__app?.doc.project.id === id && window.__app.doc.objects.length > 0, PLAN, { timeout: 400000 });
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('#viewModes [data-mode="3d"]').click());
// 模型與貼圖是非同步到的，晚到的會讓 3D 重建（onModelsReady）——等到網路靜下來再多等一段，
// 不然第一張截到的是還沒換上實掃模型的那一版（實測床會不一樣）
await page.waitForLoadState('networkidle', { timeout: 400000 });
// 再保險一次：dev server 上 import 同一支模組拿到的是 App 用的同一份快取，把這份方案用到的
// 每件家具都載完，然後重建場景——兩次截圖才保證都是實掃模型那一版
const models = await page.evaluate(async () => {
  const f = await import('/src/core/furniture3d.ts');
  const items = [...new Set(window.__app.doc.objects.filter((o) => o.kind === 'furniture').map((o) => o.item))];
  const ok = await Promise.all(items.map((i) => f.loadFurnitureModel(i)));
  window.__app.view3d.build(window.__app.doc, false);
  return `${ok.filter(Boolean).length}/${items.length}`;
});
console.log(`實掃模型載到 ${models} 件`);
// 家具材質的掃描貼圖也是晚到的（applyScan 先排隊、到了才補上），沒到齊時床的反光就不一樣
const scans = await page.evaluate(async () => {
  const t = await import('/src/core/textures3d.ts');
  const t0 = performance.now();
  while (t.scansPending() > 0 && performance.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 500));
  return t.scansPending();
});
console.log(`還在等的掃描貼圖：${scans}`);
await page.waitForTimeout(8000);

const pose = (p) => page.evaluate((p) => {
  const v = window.__app.view3d;
  v.controls.enableDamping = false;
  // 自動降解析度看的是畫格時間，swiftshader 慢得不固定——鎖在 1，兩次截圖才比得起來
  v.setBudget('shared');
  v.res = { ...v.res, ratio: 1, goodWindows: 0 };
  v.resize();
  v.controls.maxPolarAngle = Math.PI - 0.1;
  v.camera.position.set(...p.cam);
  v.controls.target.set(...p.at);
  v.controls.update();
}, p);
const box = await page.evaluate(() => {
  const xs = [], ys = [];
  for (const o of window.__app.doc.objects) if (o.kind === 'wall') { xs.push(o.a.x, o.b.x); ys.push(o.a.y, o.b.y); }
  const room = window.__app.doc.objects.filter((o) => o.kind === 'room' && o.poly?.length >= 3)
    .sort((p, q) => q.poly.length - p.poly.length)[0];
  const cx = room.poly.reduce((s, p) => s + p.x, 0) / room.poly.length, cy = room.poly.reduce((s, p) => s + p.y, 0) / room.poly.length;
  const f = window.__app.doc.objects.find((o) => o.kind === 'furniture' && o.w > 100);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), cx, cy, f: { x: f.x + f.w / 2, y: f.y + f.h / 2 } };
});
const mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2, span = Math.max(box.x1 - box.x0, box.y1 - box.y0);
const poses = {
  overview: { cam: [mx + span * 0.7, span * 0.8, my + span * 0.9], at: [mx, 40, my] },
  ceiling: { cam: [box.cx, 140, box.cy], at: [box.cx + 200, 265, box.cy + 120] },
  furniture: { cam: [box.f.x + 250, 220, box.f.y + 250], at: [box.f.x, 40, box.f.y] },
};
for (const v of VIEWS) {
  await pose(poses[v]);
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => { const b = document.querySelector('#view3d canvas').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await page.screenshot({ timeout: 120000, clip: r, path: `${OUT}b14-${a}-${v}.png` });
  console.log(`截 ${OUT}b14-${a}-${v}.png`);
}
console.log(errs.length ? '頁面錯誤：' + errs.join(' | ') : '沒有頁面錯誤');
await br.close();
process.exit(errs.length ? 1 : 0);
