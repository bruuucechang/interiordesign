// 3D 換解析度時整個畫面閃一下（2026-11-01 使用者回報「有時候畫面會閃一下閃一下」）。
//
//   node bench/verify-resflash.mjs            # 要先 npm run dev（:5180）
//
// Retina 上 3D 會自己在 1～2 倍像素比之間調（resolution.ts）。換比例要重設畫布
// 大小，而重設會把畫布清空；如果那一幀已經畫完，瀏覽器就把空白的畫布貼上螢幕，
// 下一幀才補回來——深色背景一閃。這裡用 2 倍像素比開頁、錄下每一幀（CDP
// screencast），強制換幾次比例，再改一次視窗大小，看有沒有哪一幀的平均亮度
// 掉下去又彈回來。
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5180';
let bad = 0;
const check = (name, ok, info = '') => { if (!ok) bad++; console.log(`${ok ? '✔' : '✖'} ${name}${info ? '  ' + info : ''}`); };

const br = await chromium.launch({ timeout: 120000, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await br.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultTimeout(400000);
await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
await page.addInitScript(() => { try {
  localStorage.setItem('interior_tour_seen', '1'); localStorage.setItem('interior_view_mode', '3d');
  localStorage.setItem('interior_lang', 'zh-Hant'); localStorage.setItem('interior_owner', 'own_orsxp52fbvey');
} catch {} });
await page.goto(`${BASE}/?perf=1&plan=plan1151022`, { timeout: 400000 });
await page.waitForFunction(() => window.__app?.doc.objects.length > 0 && window.__app.view3d, null, { timeout: 400000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);

const cdp = await ctx.newCDPSession(page);
const lum = [];
cdp.on('Page.screencastFrame', (f) => {
  const im = PNG.sync.read(Buffer.from(f.data, 'base64'));
  let s = 0, n = 0;
  for (let i = 0; i < im.data.length; i += 16) { s += im.data[i] * 0.3 + im.data[i + 1] * 0.59 + im.data[i + 2] * 0.11; n++; }
  lum.push(s / n);
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 500, maxHeight: 350, everyNthFrame: 1 });
await page.waitForTimeout(1500);
for (const r of [1.5, 2, 1.25, 1, 2]) {
  await page.evaluate((r) => { const v = window.__app.view3d; v.res = { ...v.res, ratio: r }; v.resize(); }, r);
  await page.waitForTimeout(1500);
}
await page.setViewportSize({ width: 900, height: 650 });
await page.waitForTimeout(1500);
await cdp.send('Page.stopScreencast');

// 一幀比前後兩幀都暗 20 以上（0～255）＝閃了一下；鏡頭沒動，正常幀之間幾乎不變。
let flashes = 0;
for (let i = 1; i + 1 < lum.length; i++) if (lum[i - 1] - lum[i] > 20 && lum[i + 1] - lum[i] > 20) flashes++;
check('錄到足夠的幀', lum.length > 100, `${lum.length} 幀`);
check('換解析度、改視窗大小時畫面不閃', flashes === 0, `閃了 ${flashes} 次`);
await br.close();
process.exit(bad ? 1 : 0);
