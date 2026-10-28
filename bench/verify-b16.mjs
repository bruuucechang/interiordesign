// B16 驗收：靈敏度重調（docs/spec-game-mode.md 第一節）。
//
//   node bench/verify-b16.mjs            # 要先 npm run dev（:5180）
//
// 量的是行為，不是常數：按住 W 實際每秒走幾公分、觸控板一次滑動 2D 縮放多少、
// 滑桿一動 3D 的轉速有沒有跟著變、重新整理後設定還在。截圖 bench/results/b16-*.png。

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const PLAN = 'plan1151022';
const OWNER = 'own_orsxp52fbvey';
const OUT = new URL('./results/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

let bad = 0;
const check = (name, ok, info = '') => { if (!ok) bad++; console.log(`${ok ? '✔' : '✖'} ${name}${info ? '  ' + info : ''}`); };

const br = await chromium.launch({ timeout: 120000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await br.newPage({ viewport: { width: 1440, height: 900 } });
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
await page.waitForTimeout(1500);

// ---- 2D 滾輪：觸控板一次滑動（40 個 2.5 px 的事件）只縮放一點點 ----
const z0 = await page.evaluate(() => window.__app.editor.vp.scale);
// 直接對畫布送 WheelEvent：headless 的 page.mouse.wheel 在這裡沒送到畫布（縮放 ×1.000，原因沒追）
const wheel = (dy, n = 1) => page.evaluate(([dy, n]) => {
  const c = document.getElementById('canvas'), r = c.getBoundingClientRect();
  for (let i = 0; i < n; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
}, [dy, n]);
await wheel(-2.5, 40);
const z1 = await page.evaluate(() => window.__app.editor.vp.scale);
check('觸控板滑一下 2D 只放大一點（舊版 ×45）', z1 / z0 > 1.02 && z1 / z0 < 1.2, `×${(z1 / z0).toFixed(3)}`);
await wheel(-120);
const z2 = await page.evaluate(() => window.__app.editor.vp.scale);
check('滑鼠滾一格約 ×1.1', Math.abs(z2 / z1 - 1.1) < 0.02, `×${(z2 / z1).toFixed(3)}`);

// ---- 3D：按住 W 的速度 ----
await page.evaluate(() => document.querySelector('#viewModes [data-mode="3d"]').click());
await page.waitForTimeout(3000);
await page.evaluate(() => { document.activeElement?.blur?.(); window.__app.view3d.setFly(true); });
// 包住 clock.getDelta：記下每幀實際用到的秒數（封頂後），走的距離 ÷ 秒數＝速度
await page.evaluate(() => {
  const v = window.__app.view3d, c = v.clock, orig = c.getDelta.bind(c);
  window.__dt = 0; window.__frames = 0;
  c.getDelta = () => { const d = orig(); if (v.pressed.size) { window.__dt += Math.min(d, 0.1); window.__frames++; } return d; };
});
const cam0 = await page.evaluate(() => window.__app.view3d.camera.position.toArray());
await page.keyboard.down('w');
await page.waitForFunction(() => window.__frames >= 3, null, { timeout: 300000 });
await page.keyboard.up('w');
await page.waitForTimeout(300);
const [cam1, dt, frames] = await page.evaluate(() => [window.__app.view3d.camera.position.toArray(), window.__dt, window.__frames]);
const moved = Math.hypot(cam1[0] - cam0[0], cam1[2] - cam0[2]);
check('按住 W 每秒約 250 cm（舊版約 1000）', Math.abs(moved / dt - 250) < 30, `${Math.round(moved)} cm / ${dt.toFixed(2)} s`);
// swiftshader 一幀要好幾秒，沒封頂的話一幀就走好幾公尺
check('卡一幀也不會一口氣飛出去（每幀最多 0.1 秒）', moved <= 250 * 0.1 * frames + 1, `${Math.round(moved)} cm / ${frames} 幀`);
const rot0 = await page.evaluate(() => window.__app.view3d.controls.rotateSpeed);
check('3D 轉視角預設 0.5（three.js 預設 1）', rot0 === 0.5, String(rot0));

// ---- 操作設定面板 ----
await page.evaluate(() => document.querySelector('[data-act="feel"]').click());
await page.waitForSelector('#feelModal:not(.hidden)');
await page.screenshot({ path: OUT + 'b16-settings.png' });
await page.evaluate(() => {
  const el = document.querySelector('#feelModal input[data-key="rotate"]');
  el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true }));
});
const rot1 = await page.evaluate(() => window.__app.view3d.controls.rotateSpeed);
check('滑桿拉到 ×2 轉速跟著變', rot1 === 1, String(rot1));
await page.reload();
await page.waitForFunction(() => !!window.__app?.view3d, null, { timeout: 400000 });
const rot2 = await page.evaluate(() => window.__app.view3d.controls.rotateSpeed);
check('重新整理後設定還在', rot2 === 1, String(rot2));
await page.evaluate(() => localStorage.removeItem('id.controlFeel'));

check('沒有頁面錯誤', errs.length === 0, errs.join(' | '));
await br.close();
process.exit(bad ? 1 : 0);
