// B25～B27（docs/spec-declutter.md）：畫面減量，在真的頁面上驗。
//
//   node bench/verify-declutter.mjs [http://localhost:5180]     # 要先 npm run dev
//
// Headless、用這台的 Metal。A1 只讀：寫入的 API 全擋。截圖在 bench/results/declutter-*.png。
import { chromium } from 'playwright';
const BASE = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'http://localhost:5180';
const OUT = new URL('./results/', import.meta.url).pathname;
const br = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };
const errs = [];

async function open(url, { plan = false, mode = '2d', w = 1440, h = 900 } = {}) {
  const ctx = await br.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript((mode) => { localStorage.setItem('interior_tour_seen', '1'); localStorage.setItem('interior_lang', 'zh-Hant');
    localStorage.setItem('interior_owner', 'own_orsxp52fbvey'); localStorage.setItem('interior_view_mode', mode); }, mode);
  await page.goto(url, { timeout: 400000 });
  if (plan) await page.waitForFunction(() => window.__app?.doc.objects.length > 50, null, { timeout: 120000 });
  else await page.waitForFunction(() => !!window.__app, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}
const A1 = `${BASE}/?perf=1&plan=plan1151022`;
const setScale = (page, s) => page.evaluate((s) => { const v = window.__app.editor.vp; const c = v.toWorld({ x: v.width / 2, y: v.height / 2 });
  v.scale = s; v.centerOn(c.x, c.y, 0, 0); }, s);
// 重畫一次，記下每次 fill()／stroke() 當下的顏色與透明度
const paints = (page) => page.evaluate(() => {
  const P = CanvasRenderingContext2D.prototype, of = P.fill, os = P.stroke, out = [];
  const col = (v) => typeof v === 'string' ? v.toLowerCase() : v instanceof CanvasPattern ? 'pattern' : 'other';
  P.fill = function (...a) { out.push({ op: 'fill', c: col(this.fillStyle), a: this.globalAlpha }); return of.apply(this, a); };
  P.stroke = function (...a) { out.push({ op: 'stroke', c: col(this.strokeStyle), a: this.globalAlpha }); return os.apply(this, a); };
  try { window.__app.editor.renderNow(); } finally { P.fill = of; P.stroke = os; }
  return out;
});
const AMBER = /^#(e0b45a|f0c869|ffd98a)/;

// ---------------------------------------------------------------- B25
console.log('B25 只有燈是黃的、地板條紋');
{
  const { ctx, page } = await open(A1, { plan: true });
  await page.evaluate(() => document.getElementById('zoomFit')?.click());
  await page.waitForTimeout(500);
  const scale = await page.evaluate(() => window.__app.editor.vp.scale);
  let p = await paints(page);
  const solidYellow = p.filter(x => x.op === 'fill' && x.c.startsWith('#ffd166') && x.a === 1).length;
  ok(solidYellow === 0, `A1 全圖（${scale.toFixed(2)} px/cm）：沒有實心的黃色燈點（${solidYellow} 個）`);
  const amber = p.filter(x => AMBER.test(x.c)).length;
  ok(amber === 0, `家具線條沒有琥珀色（${amber} 筆）`);
  const loudYellowLines = p.filter(x => x.op === 'stroke' && x.c.startsWith('#ffd166') && x.a === 1).length;
  ok(loudYellowLines === 0, `沒有全強度的黃色線（子區域虛線、燈條）（${loudYellowLines} 筆）`);
  const rings = p.filter(x => x.op === 'stroke' && x.c.startsWith('#ffd166') && x.a < 1).length;
  ok(rings >= 57, `嵌燈還畫得出來（淡黃細線 ${rings} 筆，A1 有 57 盞嵌燈＋21 條燈條）`);
  await page.screenshot({ path: `${OUT}declutter-a1.png` });
  // A1 八間房：木地板 5、磁磚 2、磨石子 1。全圖時木紋不畫，磁磚格（32 px）照畫
  const hatchFar = p.filter(x => x.op === 'fill' && x.c === 'pattern').length;
  ok(scale <= 0.55 && hatchFar <= 3, `A1 全圖：木地板的條紋不畫（畫了紋路的 ${hatchFar} 塊，只剩磁磚、磨石子）`);
  await setScale(page, 0.1);
  p = await paints(page);
  ok(!p.some(x => x.op === 'fill' && x.c === 'pattern'), '縮到 0.1 px/cm：一塊紋路都不畫');
  await setScale(page, 1.5);
  p = await paints(page);
  const hatchNear = p.filter(x => x.op === 'fill' && x.c === 'pattern').length;
  ok(hatchNear > 0, `放大到 1.5 px/cm：地板紋路出現（${hatchNear} 塊）`);
  await page.screenshot({ path: `${OUT}declutter-a1-zoom.png` });
  // 照度熱圖開著：燈照舊用迴路顏色畫實心，沒有任何淡化的燈
  ok(await page.evaluate(() => !!document.querySelector('[data-act="lighting"]')), '「照度熱圖」按鈕在');
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => !!window.__app.editor.heat), '照度熱圖打開了');
  p = await paints(page);
  const faded = p.filter(x => x.c.startsWith('#ffd166') && x.a < 1).length;
  const lit = p.filter(x => x.op === 'fill' && x.a === 1 && /^#/.test(x.c) && !/^#(3a4150|2b3340|0e1218|31414e)/.test(x.c)).length;
  ok(faded === 0 && lit >= 57, `照度熱圖開著：沒有淡化的燈（${faded} 筆）、燈照舊實心（${lit} 筆）`);
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());   // 關回來
  await page.waitForTimeout(500);
  // PNG 匯出照舊：家具照舊琥珀色、燈照舊實心
  const png = await page.evaluate(async () => {
    const ex = await import('/src/core/exporter.ts');
    const P = CanvasRenderingContext2D.prototype, of = P.fill, os = P.stroke, out = [];
    const col = (v) => typeof v === 'string' ? v.toLowerCase() : 'other';
    P.fill = function (...a) { out.push(col(this.fillStyle) + '|' + this.globalAlpha); return of.apply(this, a); };
    P.stroke = function (...a) { out.push(col(this.strokeStyle) + '|' + this.globalAlpha); return os.apply(this, a); };
    const fn = Object.values(ex).find(f => typeof f === 'function' && /png/i.test(f.name));
    const a = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    try { await fn(window.__app.doc, 'x'); } catch (e) { out.push('ERR ' + e); } finally { P.fill = of; P.stroke = os; HTMLAnchorElement.prototype.click = a; }
    return out;
  });
  ok(png.some(s => /^#e0b45a/.test(s)) && png.some(s => s === '#ffd166|1'), `PNG 匯出照舊：家具琥珀色、燈實心（${png.length} 筆${png.find(s => s.startsWith('ERR')) ?? ''}）`);
  ok(await page.evaluate(() => window.__app.doc.objects.length) === 180, 'A1 還是 180 件（只讀）');
  await ctx.close();
}

console.log('\nB25 家具目錄的燈具照舊是黃的');
{
  const { ctx, page } = await open(`${BASE}/?perf=1`);
  const ink = (item) => page.evaluate((item) => { const d = window.__app.doc; d.commit();
    d.add({ id: 'f-' + item, kind: 'furniture', layer: 'furniture', item, x: 0, y: 0, w: 60, h: 60, angle: 0, label: '' });
    const v = window.__app.editor.vp; v.scale = 2; v.centerOn(0, 0, 60, 60);
    const P = CanvasRenderingContext2D.prototype, os = P.stroke, out = new Set();
    P.stroke = function (...a) { out.add(String(this.strokeStyle).toLowerCase()); return os.apply(this, a); };
    try { window.__app.editor.renderNow(); } finally { P.stroke = os; }
    d.remove('f-' + item); return [...out]; }, item);
  const lamp = await ink('lamp_ceiling'), wardrobe = await ink('wardrobe');
  ok(lamp.some(c => /^#f0c869/.test(c)), `吸頂燈（家具目錄）在平面圖上照舊黃色（${lamp.join(' ')}）`);
  ok(!wardrobe.some(c => AMBER.test(c)), `衣櫃換成灰色（${wardrobe.join(' ')}）`);
  await ctx.close();
}

ok(!errs.length, `沒有頁面錯誤${errs.length ? '：' + errs.join(' / ') : ''}`);
await br.close();
console.log(fails ? `\n✘ ${fails} 項沒過` : '\n✔ 全部通過');
process.exit(fails ? 1 : 0);
