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

// ---------------------------------------------------------------- B26
console.log('\nB26 家具名與牆長放得下才畫');
{
  const { ctx, page } = await open(A1, { plan: true });
  const texts = () => page.evaluate(() => {
    const P = CanvasRenderingContext2D.prototype, orig = P.fillText, seen = [];
    P.fillText = function (s, ...r) { seen.push(String(s)); return orig.call(this, s, ...r); };
    try { window.__app.editor.renderNow(); } finally { P.fillText = orig; }
    return seen;
  });
  const names = await page.evaluate(() => { const F = new Set(); for (const o of window.__app.doc.objects) if (o.kind === 'furniture') F.add(o.label || o.item); return [...F]; });
  const furnNames = await page.evaluate(async () => {
    const { FURNITURE_BY_ID } = await import('/src/data/furniture.ts');
    return window.__app.doc.objects.filter(o => o.kind === 'furniture').map(o => o.label || FURNITURE_BY_ID[o.item]?.name || '');
  });
  void names;
  const countFurn = (t) => { const pool = [...t]; let n = 0; for (const f of furnNames) { const i = pool.indexOf(f); if (i >= 0) { n++; pool.splice(i, 1); } } return n; };
  await page.evaluate(() => document.getElementById('zoomFit')?.click());
  await page.waitForTimeout(500);
  let t = await texts();
  const farShort = t.filter(s => /^\d+ cm$/.test(s));
  ok(!t.includes('65 cm'), `A1 全圖：65 cm 那種短牆不標（畫了的公分數：${farShort.join(', ') || '沒有'}）`);
  ok(t.includes('5.06 m') && t.includes('7.03 m'), 'A1 全圖：長牆照樣標（5.06 m、7.03 m）');
  await page.screenshot({ path: `${OUT}declutter-a1-labels.png` });
  // 以位置判斷：畫面內每件家具，中心有沒有它的名字（同名的兩件分得開）
  const labelled = () => page.evaluate(async () => {
    const { FURNITURE_BY_ID } = await import('/src/data/furniture.ts');
    const P = CanvasRenderingContext2D.prototype, orig = P.fillText, seen = [];
    P.fillText = function (s, x, y, ...r) { seen.push([String(s), x, y]); return orig.call(this, s, x, y, ...r); };
    try { window.__app.editor.renderNow(); } finally { P.fillText = orig; }
    const v = window.__app.editor.vp, out = {};
    for (const o of window.__app.doc.objects) {
      if (o.kind !== 'furniture') continue;
      const c = v.toScreen({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
      if (c.x < 0 || c.y < 0 || c.x > v.width || c.y > v.height) continue;
      const name = o.label || FURNITURE_BY_ID[o.item]?.name;
      out[o.id] = seen.some(([s, x, y]) => s === name && Math.abs(x - c.x) < 1 && Math.abs(y - c.y) < 1);
    }
    return out;
  });
  // 跟「沒有 B26」比：把 text() 的 fits 參數拿掉重畫一次，就是 B24 時的樣子
  // （換掉頁面上那個 renderer 實例的方法；import 進來的模組跟頁面用的不一定是同一份）
  const withoutFit = (on) => page.evaluate((on) => {
    const r = window.__app.editor.renderer;
    if (on) r.text = function (...a) { return Object.getPrototypeOf(r).text.apply(this, a.slice(0, 5)); };
    else delete r.text;
  }, on);
  const far = await labelled();
  await withoutFit(true); const farOld = await labelled(); await withoutFit(false);
  const n = (m) => Object.values(m).filter(Boolean).length;
  const onlyB26 = Object.keys(far).filter(id => farOld[id] && !far[id]);
  ok(n(far) < n(farOld) && onlyB26.length > 0, `A1 全圖：標名字的家具比沒有這條規則時少（${n(farOld)} → ${n(far)} / ${Object.keys(far).length}；因為太小才拿掉的 ${onlyB26.length} 件）`);
  await page.evaluate((id) => window.__app.doc.select(id), onlyB26[0]);
  const sel = await labelled();
  ok(sel[onlyB26[0]] === true, `選了其中一件（${onlyB26[0]}）：它的名字就畫出來（沒有 B24 的選取優先也一樣是因為它被放寬）`);
  await page.evaluate(() => window.__app.doc.select(null));
  await page.evaluate(() => { const v = window.__app.editor.vp; v.zoomAt({ x: v.width / 2, y: v.height / 2 }, 2.5); });
  const near = await labelled();
  const ratio = (m) => Object.values(m).filter(Boolean).length / Object.keys(m).length;
  ok(ratio(near) > ratio(far), `放大 2.5 倍：畫面內標了名字的家具比例變高（${(ratio(far) * 100).toFixed(0)}% → ${(ratio(near) * 100).toFixed(0)}%）`);
  t = await texts();
  // 施工圖照舊：每件家具都有名字（每道牆都有長度在 verify-polish 驗）
  const plot = await page.evaluate(async () => {
    const plot = await import('/src/core/plot.ts');
    const P = CanvasRenderingContext2D.prototype, orig = P.fillText, seen = [];
    const project = window.__app.doc.serialize(), extent = plot.projectExtent(project), sheet = plot.chooseSheet(extent.w, extent.h);
    P.fillText = function (...a) { seen.push(String(a[0])); return orig.apply(this, a); };
    try { plot.plotFloorCanvas(project, project.activeFloorId, sheet, extent); } finally { P.fillText = orig; }
    return seen;
  });
  ok(countFurn(plot) === furnNames.filter(Boolean).length, `施工圖：每件家具都有名字（${countFurn(plot)} / ${furnNames.filter(Boolean).length}）`);
  ok(await page.evaluate(() => window.__app.doc.objects.length) === 180, 'A1 還是 180 件（只讀）');
  await ctx.close();
}

// ---------------------------------------------------------------- B27
console.log('\nB27 介面角落');
{
  const { ctx, page } = await open(A1, { plan: true, mode: 'split' });
  await page.waitForTimeout(1500);
  const viewBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('#topbar .menu-btn')].find(b => /檢視/.test(b.textContent));
    return { chip: !!b?.querySelector('.health-count'), text: b?.textContent.trim() }; });
  ok(!viewBtn.chip && !/\d/.test(viewBtn.text), `「檢視」上沒有數字（「${viewBtn.text}」）`);
  const peek = await page.evaluate(() => { const p = document.getElementById('drawerPeek'); return p && !p.classList.contains('hidden') ? p.textContent : ''; });
  ok(!/牆面對齊/.test(peek), `右上角沒有常駐的「牆面對齊」（${peek || '沒有把手'}）`);
  const drawerClosed = () => page.evaluate(() => document.getElementById('right').classList.contains('closed'));
  ok(await drawerClosed(), '沒選東西時右側抽屜收著');
  const item = await page.evaluate(() => { const b = document.querySelector('[data-act="health"]'); return b ? b.textContent.trim() : null; });
  const n = Number((item ?? '').match(/(\d+)\s*$/)?.[1] ?? NaN);
  ok(n > 0, `「檢視」選單裡的「空間健檢」照樣有數字（「${item}」）`);
  await page.evaluate(() => document.querySelector('[data-act="health"]').click());
  await page.waitForTimeout(500);
  const row = await page.evaluate(() => document.querySelector('#healthBody .facesteps-row')?.textContent ?? '');
  ok(/牆面對齊（2 處）/.test(row), `空間健檢裡有「牆面對齊（2 處）」（${row.slice(0, 30)}）`);
  await page.screenshot({ path: `${OUT}declutter-health.png` });
  await page.evaluate(() => document.querySelector('#healthBody .facesteps-row button').click());
  await page.waitForTimeout(500);
  const shown = await page.evaluate(() => document.querySelectorAll('#properties .facestep').length);
  ok(!(await drawerClosed()) && shown === 2, `按「看這幾處」：抽屜打開、列出 2 處（${shown}）`);
  // 而且看得到：第一列的位置上最上面的就是抽屜，不是被健檢面板蓋住
  const onTop = await page.evaluate(() => { const r = document.querySelector('#properties .facestep').getBoundingClientRect();
    return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#right'); });
  ok(onTop, '抽屜裡的對齊列表沒被空間健檢面板蓋住');
  await page.evaluate(() => { const b = document.querySelector('#properties .facesteps .linkish'); b?.click(); });
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => document.querySelector('[data-act="health"]').textContent.trim());
  ok(Number(after.match(/(\d+)\s*$/)?.[1] ?? 0) === n - 2, `「全部略過」之後健檢的數字跟著少 2（${item} → ${after}）`);
  await page.evaluate(() => localStorage.removeItem('interior_facestep_skipped'));
  await page.evaluate(() => { document.querySelector('[data-act="close-drawer"]')?.click(); document.querySelector('[data-act="close-health"]')?.click(); });
  await page.waitForTimeout(400);
  // 3D 的按鍵條
  const hudOpacity = () => page.evaluate(() => { const h = document.querySelector('.key-hud'); return h ? Number(getComputedStyle(h).opacity) : -1; });
  await page.mouse.move(200, 400);   // 2D 那一格
  await page.waitForTimeout(400);
  ok(await hudOpacity() === 0, `滑鼠不在 3D 上：按鍵條不顯示（opacity ${await hudOpacity()}）`);
  const v3 = await page.evaluate(() => { const r = document.getElementById('view3d').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(v3[0], v3[1]);
  await page.waitForTimeout(400);
  ok(await hudOpacity() === 1, `滑鼠移到 3D 上：按鍵條出現（opacity ${await hudOpacity()}）`);
  await page.screenshot({ path: `${OUT}declutter-split.png` });
  await ctx.close();
}
{
  const { ctx, page } = await open(A1, { plan: true, mode: '3d' });
  await page.waitForTimeout(1500);
  // 按著移動鍵、滑鼠不在 3D 上（放在頂列）：按鍵條出現；另一個鍵點一下放開，還按著的那個讓它留著
  const hudOpacity = () => page.evaluate(() => { const h = document.querySelector('.key-hud'); return h ? Number(getComputedStyle(h).opacity) : -1; });
  await page.mouse.move(700, 20);
  await page.keyboard.down('w');
  // 淡入 0.2 秒，3D 剛載入時鍵盤處理也可能晚一點接上：等它出現（最多 2 秒），不是固定睡 300 ms
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.key-hud')).opacity) === 1, null, { timeout: 2000 }).catch(() => {});
  const down = await hudOpacity();
  await page.keyboard.press('a'); await page.waitForTimeout(1700);
  const held = await hudOpacity();
  await page.keyboard.up('w'); await page.waitForTimeout(1700);
  const up = await hudOpacity();
  ok(down === 1 && held === 1 && up === 0, `只看 3D、滑鼠在頂列：按住 W 按鍵條出現（${down}），點一下 A 之後照樣留著（${held}），W 放開後收起（${up}）`);
  await page.click('#walkToggle'); await page.waitForTimeout(800);
  const hint = () => page.evaluate(() => { const h = document.getElementById('hint3d'); return { text: h.textContent, op: Number(getComputedStyle(h).opacity), hidden: h.classList.contains('hidden') }; });
  let h = await hint();
  ok(/行走/.test(h.text) && !h.hidden && h.op === 1, `進入行走：提示出現（opacity ${h.op}）`);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(7200);
  h = await hint();
  ok(h.op === 0, `6 秒後淡出（opacity ${h.op}）`);
  const bottom = await page.evaluate(() => document.getElementById('view3d').getBoundingClientRect().bottom);
  await page.mouse.move(700, bottom - 30);
  await page.waitForTimeout(800);
  h = await hint();
  ok(h.op === 1, `滑鼠移到下緣：提示回來（opacity ${h.op}）`);
  await page.keyboard.press('f'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.getElementById('hint3d').classList.contains('walk-hint')), '離開行走：不再是行走提示');
  ok(await page.evaluate(() => window.__app.doc.objects.length) === 180, 'A1 還是 180 件（只讀）');
  await ctx.close();
}

ok(!errs.length, `沒有頁面錯誤${errs.length ? '：' + errs.join(' / ') : ''}`);
await br.close();
console.log(fails ? `\n✘ ${fails} 項沒過` : '\n✔ 全部通過');
process.exit(fails ? 1 : 0);
