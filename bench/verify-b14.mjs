// B14：拆 3D 程式之後證明畫面沒變（.claude/rules/layering.md「重構 3D 之後怎麼證明沒改壞」）。
//
// plan1151022 在 2D 載入後切 3D，擺三個固定視角各截一張：鳥瞰（build 的 reframe）、
// 站在房間裡抬頭看天花板（燈）、靠近家具的斜角。拆前拆後各跑一次，再用 --compare 比。
//
//   node bench/verify-b14.mjs shoot <前綴>          # 例：before／after
//   node bench/verify-b14.mjs compare <前綴A> <前綴B>
//   node bench/verify-b14.mjs interact              # 搬出去的鍵盤（keys3d）與放置預覽（ghosts3d）還會動
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

if (cmd === 'interact') {
  let bad = 0;
  const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${n}${extra ? '  ' + extra : ''}`); if (!ok) bad++; };
  const canvas = page.locator('#view3d canvas');
  const r = await canvas.boundingBox();
  // WASD：按住 W 相機往前飛、提示格亮起；放開就暗
  await page.evaluate(() => { document.activeElement?.blur?.(); window.__app.view3d.setFly(true); });
  const cam0 = await page.evaluate(() => window.__app.view3d.camera.position.toArray());
  // swiftshader 一幀要好幾秒（陰影 4096² ＋ GTAO），按固定毫秒數可能一幀都輪不到——數畫格：
  // 包住 clock.getDelta（每幀叫一次），按住直到跑過兩幀
  await page.evaluate(() => { const c = window.__app.view3d.clock; const orig = c.getDelta.bind(c); window.__frames = 0; c.getDelta = () => { window.__frames++; return orig(); }; });
  await page.keyboard.down('w');
  await page.evaluate(() => { window.__frames = 0; });
  await page.waitForFunction(() => window.__frames >= 2, null, { timeout: 300000 });
  const lit = await page.evaluate(() => [...document.querySelectorAll('.key-hud div')].find((d) => d.textContent === 'W')?.style.background);
  await page.keyboard.up('w');
  await page.waitForTimeout(300);
  const unlit = await page.evaluate(() => [...document.querySelectorAll('.key-hud div')].find((d) => d.textContent === 'W')?.style.background);
  const cam1 = await page.evaluate(() => window.__app.view3d.camera.position.toArray());
  const moved = Math.hypot(cam1[0] - cam0[0], cam1[2] - cam0[2]);
  check('按住 W 相機往前飛', moved > 10, `移動 ${Math.round(moved)} cm`);
  check('W 的提示格亮起又暗下', lit !== unlit && /123, 198, 255|7bc6ff/.test(lit ?? ''), `${lit} → ${unlit}`);
  // 家具預覽跟著游標落在地上
  await page.evaluate(() => window.__app.view3d.setPlacementPreview({ id: 'sofa', w: 200, h: 90 }));
  await page.mouse.move(r.x + r.width / 2, r.y + r.height * 0.7);
  await page.mouse.move(r.x + r.width / 2 + 5, r.y + r.height * 0.7 + 5);
  await page.waitForTimeout(500);
  const g = await page.evaluate(() => { const [f] = window.__app.view3d.ghosts.objects(); return f ? { vis: f.visible, y: f.position.y, order: f.renderOrder } : null; });
  check('家具預覽出現在地上', !!g && g.vis && g.y === 0 && g.order === 999, JSON.stringify(g));
  await page.evaluate(() => window.__app.view3d.renderer.domElement.dispatchEvent(new PointerEvent('pointerleave')));
  const gone = await page.evaluate(() => window.__app.view3d.ghosts.objects()[0]?.visible);
  check('游標離開就藏起來', gone === false);
  await page.evaluate(() => window.__app.view3d.setPlacementPreview(null));
  // 門窗預覽：照給的位置與角度擺上牆
  const o = await page.evaluate(() => {
    const v = window.__app.view3d;
    v.setOpeningGhost({ kind: 'door', x: 120, y: 340, angle: 90, width: 90 });
    const [, og] = v.ghosts.objects();
    const a = og ? { vis: og.visible, x: og.position.x, z: og.position.z, ry: og.rotation.y } : null;
    v.setOpeningGhost(null);
    return { a, hidden: v.ghosts.objects()[1]?.visible };
  });
  check('門的預覽擺到指定位置並轉 90°', !!o.a && o.a.vis && o.a.x === 120 && o.a.z === 340 && Math.abs(o.a.ry + Math.PI / 2) < 1e-9, JSON.stringify(o.a));
  check('門的預覽收得掉', o.hidden === false);
  console.log(errs.length ? '頁面錯誤：' + errs.join(' | ') : '沒有頁面錯誤');
  await br.close();
  process.exit(bad || errs.length ? 1 : 0);
}

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
