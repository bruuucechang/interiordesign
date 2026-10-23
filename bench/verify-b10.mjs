// B10：3D 看得到燈（S1）＋實機量切 3D（P1，見 docs/review-2026-10.md）。
//
//   S1  plan1151022 切 3D：每一盞燈都有網格；鳥瞰與「站在房間裡抬頭看天花板」各截一張（目視）
//   P1  按下 3D 到畫出兩個畫格的牆鐘時間。用這台 Mac 裝的 Chrome（channel: 'chrome'）
//       headless 開 GPU，先印出 WebGL renderer 確認不是 SwiftShader，數字才算實機
//
// 需要 npm run dev（:5180 + :8791）。只讀 plan1151022：所有寫入請求一律攔掉。
//
////   node bench/verify-b10.mjs [base-url] [plan-id] [--runs N]
//
// P1 的數字要量正式建置，不要量 dev server（Vite 第一次切 3D 時才逐支編譯模組）：
//   npm run build && (cd client && npx vite preview --port 5181 --strictPort &)
//   node bench/verify-b10.mjs http://localhost:5181 --runs 7
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const runsAt = args.indexOf('--runs');
const RUNS = runsAt >= 0 ? Number(args.splice(runsAt, 2)[1]) : 5;
const BASE = args[0] ?? 'http://localhost:5180';
const PLAN = args[1] ?? 'plan1151022';
const OUT = new URL('./results/', import.meta.url).pathname;
const OWNER = 'own_orsxp52fbvey';
const LIGHTS = ['downlight', 'spotlight', 'ceilingLight', 'pendant', 'wallLight', 'batten', 'exhaust'];

let fails = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${n}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const errs = [];

async function open(b, width = 1500) {
  const page = await b.newPage({ viewport: { width, height: 950 } });
  await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
  await page.addInitScript(([owner]) => {
    try {
      localStorage.setItem('interior_tour_seen', '1');
      localStorage.setItem('interior_view_mode', '2d');
      localStorage.setItem('interior_lang', 'zh-Hant');
      localStorage.setItem('interior_owner', owner);
    } catch { /* ignore */ }
  }, [OWNER]);
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).split('\n')[0]));
  await page.goto(`${BASE}/?perf=1&plan=${PLAN}`);
  await page.waitForFunction((id) => window.__app?.doc.project.id === id && window.__app.doc.objects.length > 0, PLAN, { timeout: 30000 });
  await page.waitForTimeout(2500);
  return page;
}

// 按下 3D → 兩個 rAF 畫格，跟盤點時的量法一樣（docs/review-2026-10.md「效能」）
const switchTo3D = (page) => page.evaluate(() => new Promise((res) => {
  const t0 = performance.now();
  document.querySelector('#viewModes [data-mode="3d"]').click();
  requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0)));
}));
const switchTo2D = (page) => page.evaluate(() => new Promise((res) => {
  document.querySelector('#viewModes [data-mode="2d"]').click();
  requestAnimationFrame(() => requestAnimationFrame(() => res()));
}));

// ---------------------------------------------------------------- S1
console.log('S1 3D 的燈');
{
  // 截圖用 swiftshader：跟 B9 的截圖同一套環境，換台機器也截得出來
  const b = await chromium.launch({ timeout: 120000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await open(b);
  await page.evaluate(() => document.querySelector('#viewModes [data-mode="3d"]').click());
  await page.waitForTimeout(6000);
  const m = await page.evaluate((LIGHTS) => {
    const a = window.__app;
    const fittings = a.doc.objects.filter((o) => o.kind === 'electrical' && LIGHTS.includes(o.item));
    const g = a.view3d.lightGroup;
    // 每盞燈至少一個網格落在它的符號附近（±12 cm，壁燈與 T5 會往照的那側讓開幾公分）
    const pos = g.children.map((c) => c.position);
    const missing = fittings.filter((o) => !pos.some((p) => Math.hypot(p.x - o.x, p.z - o.y) < 12));
    return { fittings: fittings.length, meshes: g.children.length, missing: missing.map((o) => o.item + '@' + Math.round(o.x) + ',' + Math.round(o.y)) };
  }, LIGHTS);
  check('每盞燈都有網格', m.fittings > 0 && m.missing.length === 0, `燈 ${m.fittings} 盞、網格 ${m.meshes} 個、缺 ${m.missing.length}${m.missing.length ? '：' + m.missing.slice(0, 5).join(' ') : ''}`);
  await page.screenshot({ timeout: 120000, path: OUT + 'b10-s1-overview.png' });

  // 站到崁燈最多的那間房的中央，抬頭看最近的一盞——天花板只有相機在室內、比它低時才畫
  const aim = await page.evaluate(() => {
    const a = window.__app;
    const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const p = poly[i], q = poly[j]; if ((p.y > y) !== (q.y > y) && x < (q.x - p.x) * (y - p.y) / (q.y - p.y) + p.x) c = !c; } return c; };
    const downs = a.doc.objects.filter((o) => o.kind === 'electrical' && o.item === 'downlight');
    const rooms = a.doc.objects.filter((o) => o.kind === 'room' && o.poly?.length >= 3)
      .map((r) => ({ r, n: downs.filter((d) => inside(r.poly, d.x, d.y)).length }))
      .sort((p, q) => q.n - p.n);
    const room = rooms[0].r;
    const cx = room.poly.reduce((s, p) => s + p.x, 0) / room.poly.length, cy = room.poly.reduce((s, p) => s + p.y, 0) / room.poly.length;
    const ds = downs.filter((d) => inside(room.poly, d.x, d.y)).sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy));
    const v = a.view3d, t = ds[ds.length - 1];
    // 平常不准仰視（maxPolarAngle 卡在水平），會把相機推到天花板上面；截這張圖時放開
    v.controls.maxPolarAngle = Math.PI - 0.1;
    v.controls.enableDamping = false;
    v.camera.position.set(cx, 140, cy);
    v.controls.target.set(t.x, 265, t.y);
    v.controls.update();
    return { room: room.name, n: rooms[0].n };
  });
  await page.waitForTimeout(4000);
  const ceil = await page.evaluate(() => window.__app.view3d.ceilingGroup.visible);
  check('室內視角天花板有畫出來', ceil, `「${aim.room}」崁燈 ${aim.n} 盞`);
  await page.screenshot({ timeout: 120000, path: OUT + 'b10-s1-ceiling.png' });
  await page.close();
  await b.close();
}

// ---------------------------------------------------------------- P1
console.log('P1 切 3D 時間（這台 Mac 的 Chrome、GPU）');
if (RUNS > 0) {
  const b = await chromium.launch({ channel: 'chrome', headless: true, timeout: 120000, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const gpu = await (async () => {
    const p = await b.newPage();
    const r = await p.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'no webgl';
    });
    await p.close();
    return r;
  })();
  const real = !/swiftshader|llvmpipe|software|no webgl/i.test(gpu);
  check('WebGL 跑在 GPU 上', real, `${b.version()} ／ ${gpu}`);
  const first = [], again = [], build = [];
  for (let i = 0; i < RUNS; i++) {
    const page = await open(b);
    await page.evaluate(() => window.__perf.reset());
    first.push(await switchTo3D(page));
    await page.waitForTimeout(2500);
    // 其中有多少是建場景（view3d.build）：剩下的是建 WebGL 環境、編 shader、第一次上傳貼圖
    build.push(await page.evaluate(() => window.__perf.snapshot().build3d.max));
    // 同一頁第二次切：3D 檢視已經建好，只差重建場景
    await switchTo2D(page); await page.waitForTimeout(1000);
    again.push(await switchTo3D(page));
    await page.close();
  }
  const fmt = (xs) => { const s = [...xs].sort((p, q) => p - q); return `中位數 ${Math.round(s[s.length >> 1])} ms（${s.map(Math.round).join('／')}）`; };
  console.log(`  第一次切 3D：${fmt(first)}`);
  console.log(`  再切一次：  ${fmt(again)}`);
  console.log(`  其中建場景：${fmt(build)}`);
  const med = [...first].sort((p, q) => p - q)[first.length >> 1];
  console.log(`  ${med > 200 ? '> 200 ms：要在 blocks.md 另開優化區塊' : '≤ 200 ms：不用另開優化區塊'}`);
  await b.close();
}

check('沒有頁面錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
