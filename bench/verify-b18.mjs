// B18 驗收：3D 的燈真的發光、離燈越遠越暗、牆擋光（docs/spec-game-mode.md 第二節）。
//
//   node bench/verify-b18.mjs            # 要先 npm run dev（:5180）
//
// 夜晚站在客廳裡（眼睛 160 cm）看一張、從上面看一張，正午再看一張（燈不該亮）。
// 截圖 bench/results/b18-*.png——亮暗對不對只能用眼睛看，這支只驗開關與挑燈。

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5180';
const OUT = new URL('./results/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, info = '') => { if (!ok) bad++; console.log(`${ok ? '✔' : '✖'} ${name}${info ? '  ' + info : ''}`); };

// 預設用這台的 GPU（Metal）：swiftshader 畫 12 盞聚光燈＋6 張陰影圖一幀超過 30 秒。沒有 GPU 的機器帶 --swiftshader。
const SOFT = process.argv.includes('--swiftshader');
const br = await chromium.launch({ timeout: 120000, args: SOFT ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--ignore-gpu-blocklist'] });

const page = await br.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(300000);
await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
await page.addInitScript(() => { try {
  localStorage.setItem('interior_tour_seen', '1'); localStorage.setItem('interior_view_mode', '3d');
  localStorage.setItem('interior_lang', 'zh-Hant'); localStorage.setItem('interior_owner', 'own_orsxp52fbvey');
} catch {} });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto(`${BASE}/?perf=1&plan=plan1151022`, { timeout: 400000 });
await page.waitForFunction(() => window.__app?.doc.objects.length > 0 && window.__app.view3d, null, { timeout: 400000 });
await page.waitForLoadState('networkidle', { timeout: 400000 });
await page.waitForTimeout(3000);

// 每一張截圖前等兩幀畫完（swiftshader 一幀好幾秒）
const frames = async (k = 2) => {
  await page.evaluate(() => { const c = window.__app.view3d.clock; if (!c.__wrapped) { const o = c.getDelta.bind(c); c.getDelta = () => { window.__f = (window.__f || 0) + 1; return o(); }; c.__wrapped = 1; } window.__f = 0; });
  await page.waitForFunction((k) => window.__f >= k, k, { timeout: 400000 });
};

const sel = (v) => page.evaluate((v) => { const s = document.getElementById('timeOfDay'); s.value = v; s.dispatchEvent(new Event('change')); }, v);

await sel('noon');
await frames();
check('正午燈不亮', await page.evaluate(() => !window.__app.view3d.lamps.isOn));

await sel('night');
await frames();
check('夜晚自動開燈', await page.evaluate(() => window.__app.view3d.lamps.isOn));
check('開燈按鈕跟著亮', await page.evaluate(() => document.getElementById('lampsToggle').classList.contains('on')));
await page.screenshot({ path: OUT + 'b18-night-overview.png' });

// 站進客廳
const at = await page.evaluate(() => {
  const r = window.__app.doc.objects.find((o) => o.kind === 'room' && /客廳/.test(o.name ?? ''));
  const xs = r.poly.map((p) => p.x), ys = r.poly.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const v = window.__app.view3d;
  v.camera.position.set(cx - 150, 160, cy + 120); v.controls.target.set(cx + 200, 110, cy - 150); v.controls.update();
  return { cx, cy, name: r.name };
});
await frames(3);
const active = await page.evaluate(() => window.__app.view3d.lamps.active.length);
check('站在屋裡：點亮 12 盞（池子滿）', active === 12, `${active} 盞`);
await page.screenshot({ path: OUT + 'b18-night-inside.png' });

// 手動關掉
await page.evaluate(() => document.getElementById('lampsToggle').click());
await frames();
check('按鈕可以關燈', await page.evaluate(() => !window.__app.view3d.lamps.isOn));
await page.screenshot({ path: OUT + 'b18-night-off.png' });

check('沒有頁面錯誤', errs.length === 0, errs.join(' | '));
await br.close();
process.exit(bad ? 1 : 0);
