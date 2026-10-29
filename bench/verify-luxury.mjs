// B28～B31（docs/spec-luxury.md）：分層顯示、燈具種類、溫潤木質傢俱、A1 豪宅版，在真的頁面上驗。
//
//   node bench/verify-luxury.mjs [http://localhost:5180]     # 要先 npm run dev
//
// Headless、用這台的 Metal。A1 只讀：寫入的 API 全擋（被擋的次數也算進結果）。截圖在 bench/results/luxury-*.png。
import { chromium } from 'playwright';
const BASE = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'http://localhost:5180';
const OUT = new URL('./results/', import.meta.url).pathname;
const br = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };
const errs = [];
let writes = 0;
let baseline = null;   // A1 載入時的內容（serialize）

async function open(url, { plan = false, mode = '2d', w = 1440, h = 900, ctx = null } = {}) {
  ctx ??= await br.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.route('**/api/**', (r) => {
    const q = r.request();
    if (q.method() === 'GET') return r.continue();
    // 只算「改了方案」的寫入：房間偵測是唯讀的計算；自動存檔換頁前會把沒變的內容重送一次（B28 之前就這樣），內容一樣不算
    if (!q.url().endsWith('/api/rooms/detect')) {
      const body = q.method() === 'PUT' ? (() => { try { const j = JSON.parse(q.postData() ?? ''); return JSON.stringify(j.data ?? j); } catch { return '?'; } })() : '?';
      if (body !== baseline) { writes++; console.log('  [改了方案的寫入被擋]', q.method(), q.url().replace(BASE, '')); }
    }
    return r.abort();
  });
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
// 用真的選單勾／取消
const tick = async (page, group, on) => {
  await page.click('#showMenu > .menu-btn');
  const box = page.locator(`#showMenu input[data-show="${group}"]`);
  if ((await box.isChecked()) !== on) await box.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
};
// 重畫一次，記下畫了哪些物件（kind:item）
const drawn = (page) => page.evaluate(() => {
  const r = window.__app.editor.renderer, orig = r.drawObject, out = [];
  r.drawObject = function (o, c) { out.push(o.kind + ':' + (o.item ?? '')); return orig.call(this, o, c); };
  try { window.__app.editor.renderNow(); } finally { r.drawObject = orig; }
  return out;
});
const count = (list, re) => list.filter(s => re.test(s)).length;
const LIGHT = /^electrical:(downlight|batten|ceilingLight|spotlight|pendant|wallLight|exhaust)$/;
const OUTLET = /^electrical:(socket|socket2|socketWater|tv|network|switch\d)$/;

// ---------------------------------------------------------------- B28
console.log('B28 頂列「顯示」：勾掉的 2D、3D 都不畫、點不到，照度照算，不進方案');
{
  const { ctx, page } = await open(A1, { plan: true });
  await page.evaluate(() => document.getElementById('zoomFit')?.click());
  await page.waitForTimeout(500);
  const labels = await page.$$eval('#showMenu .menu-check', ls => ls.map(l => [l.textContent.trim(), l.querySelector('input').checked]));
  ok(labels.length === 4 && labels.every(([, c]) => c), `「顯示」有四個勾選、預設全勾（${labels.map(([t]) => t).join('、')}）`);
  const before = await page.evaluate(() => ({ plan: JSON.stringify(window.__app.doc.serialize()), past: window.__app.doc.past.length }));
  baseline = before.plan;
  const writes0 = writes;
  let d = await drawn(page);
  const n0 = { lights: count(d, LIGHT), outlets: count(d, OUTLET), furn: count(d, /^furniture:/), dims: count(d, /^(dimension|area):/), walls: count(d, /^wall:/) };
  ok(n0.lights === 78 && n0.furn === 29 && n0.walls === 37, `全勾：燈 ${n0.lights}（57 嵌燈＋21 燈條）、插座開關 ${n0.outlets}、家具 ${n0.furn}、尺寸與子區域 ${n0.dims}、牆 ${n0.walls}`);

  // 照度先算一次（照度面板打開）
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());
  await page.waitForFunction(() => window.__app.lighting.rooms.length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const lux0 = await page.evaluate(() => window.__app.lighting.rooms.map(r => r.avg.toFixed(2)).join(','));
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());

  // 點一盞嵌燈：勾著選得到，勾掉選不到
  const clickLight = async () => {
    const at = await page.evaluate(() => {
      const o = window.__app.doc.objects.find(o => o.kind === 'electrical' && o.item === 'downlight');
      window.__app.doc.select(null);
      const v = window.__app.editor.vp; v.scale = 1.5; v.centerOn(o.x, o.y, 0, 0); window.__app.editor.renderNow();
      const s = v.toScreen({ x: o.x, y: o.y }), r = document.getElementById('canvas').getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y, id: o.id };
    });
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
    return page.evaluate((id) => window.__app.doc.selectedIds.includes(id), at.id);
  };
  ok(await clickLight(), '燈具勾著：點嵌燈選得到');
  await tick(page, 'lights', false);
  ok(await page.evaluate(() => window.__app.doc.selectedIds.length === 0), '勾掉燈具：選著的那盞從選取裡拿掉');
  ok(!(await clickLight()), '燈具勾掉：點同一個位置選不到它');
  await page.evaluate(() => document.getElementById('zoomFit')?.click());
  await page.waitForTimeout(400);
  d = await drawn(page);
  ok(count(d, LIGHT) === 0 && count(d, OUTLET) === n0.outlets && count(d, /^furniture:/) === n0.furn,
    `勾掉燈具：一盞燈都不畫（${count(d, LIGHT)}），插座開關 ${count(d, OUTLET)}、家具 ${count(d, /^furniture:/)} 照畫`);
  ok(await page.evaluate(() => document.querySelector('#showMenu > .menu-btn').classList.contains('filtered')), '有勾掉的時候「顯示」字變色提醒');
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());
  await page.waitForTimeout(2500);
  const lux1 = await page.evaluate(() => window.__app.lighting.rooms.map(r => r.avg.toFixed(2)).join(','));
  ok(lux1 === lux0 && lux0.length > 0, `燈藏起來照度照算（各房平均 ${lux0}）`);
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());
  await page.waitForTimeout(300);

  const lenTexts = () => page.evaluate(() => {
    const P = CanvasRenderingContext2D.prototype, orig = P.fillText, seen = [];
    P.fillText = function (t, ...r) { seen.push(String(t)); return orig.call(this, t, ...r); };
    try { window.__app.editor.renderNow(); } finally { P.fillText = orig; }
    return seen.filter(t => /^\d+(\.\d+)? (m|cm)$/.test(t));
  });
  const len0 = await lenTexts();
  for (const g of ['outlets', 'furniture', 'notes']) await tick(page, g, false);
  const len1 = await lenTexts();
  ok(len0.length > 10 && len1.length === 0, `勾掉尺寸與標註：牆長數字不畫（${len0.length} → ${len1.length}）`);
  d = await drawn(page);
  const left = [...new Set(d.map(s => s.split(':')[0]))].sort().join(',');
  ok(count(d, LIGHT) + count(d, OUTLET) + count(d, /^(furniture|dimension|area):/) === 0, `全部勾掉：只剩 ${left}`);
  await page.keyboard.press('ControlOrMeta+a');
  await page.waitForTimeout(200);
  const selKinds = await page.evaluate(() => [...new Set(window.__app.doc.selectedObjects.map(o => o.kind))].sort().join(','));
  ok(!/electrical|furniture|dimension|area/.test(selKinds), `全選只選到看得到的（${selKinds}）`);
  await page.evaluate(() => window.__app.doc.select(null));
  await page.screenshot({ path: `${OUT}luxury-b28-rooms-only.png` });

  const after = await page.evaluate(() => ({ plan: JSON.stringify(window.__app.doc.serialize()), past: window.__app.doc.past.length, ls: localStorage.getItem('interior_view_hidden') }));
  ok(after.plan === before.plan, '勾來勾去方案內容一個字都沒變');
  ok(after.past === before.past, `沒有產生復原紀錄（${before.past} → ${after.past}）`);
  ok(writes === writes0, `沒有送出改過的方案（${writes - writes0} 次）`);
  ok(after.ls === '["lights","outlets","furniture","notes"]', `存在瀏覽器（${after.ls}）`);

  // 匯出照舊全畫
  const png = await page.evaluate(async () => {
    const ex = await import('/src/core/exporter.ts');
    const r = window.__app.editor.renderer;   // 匯出用自己的 Renderer，攔原型
    const proto = Object.getPrototypeOf(r), orig = proto.drawObject, out = [];
    proto.drawObject = function (o, c) { out.push(o.kind); return orig.call(this, o, c); };
    const a = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    const fn = Object.values(ex).find(f => typeof f === 'function' && /png/i.test(f.name));
    try { await fn(window.__app.doc, 'x'); } catch (e) { out.push('ERR ' + e); } finally { proto.drawObject = orig; HTMLAnchorElement.prototype.click = a; }
    return out;
  });
  ok(png.filter(k => k === 'electrical').length >= 78 && png.filter(k => k === 'furniture').length === 29,
    `PNG 匯出照舊全畫（水電 ${png.filter(k => k === 'electrical').length}、家具 ${png.filter(k => k === 'furniture').length}${png.find(s => s.startsWith('ERR')) ?? ''}）`);

  // 重新整理：設定還在
  await page.reload();
  await page.waitForFunction(() => window.__app?.doc.objects.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  const kept = await page.$$eval('#showMenu input[data-show]', bs => bs.filter(b => b.checked).length);
  d = await drawn(page);
  ok(kept === 0 && count(d, /^(electrical|furniture):/) === 0, `重新整理後設定還在（勾著 ${kept} 個、畫了水電＋家具 ${count(d, /^(electrical|furniture):/)} 件）`);
  ok(await page.evaluate(() => window.__app.doc.objects.length) === 180, 'A1 還是 180 件（只讀）');
  ok(writes === writes0, `重新整理也沒有送出改過的方案（${writes - writes0} 次）`);
  await page.close();

  // 3D：同一個瀏覽器設定（同一個 context 的 localStorage）
  const { page: p3 } = await open(A1, { plan: true, mode: '3d', ctx });
  const g3 = () => p3.evaluate(() => { const v = window.__app.view3d; return { lights: v.lightGroup.children.length, furn: v.furnGroup.children.length }; });
  await p3.waitForTimeout(2000);
  const hidden3 = await g3();
  ok(hidden3.lights === 0 && hidden3.furn === 0, `3D 全部勾掉：燈具 ${hidden3.lights}、家具 ${hidden3.furn} 個模型`);
  await p3.screenshot({ path: `${OUT}luxury-b28-3d-rooms-only.png` });
  // 匯出 3D（.glb）不看顯示設定：在檔案產生的那一刻數場景裡的家具與燈具模型
  const glb = () => p3.evaluate(async () => {
    const v = window.__app.view3d, oc = URL.createObjectURL, a = HTMLAnchorElement.prototype.click; let got = null;
    URL.createObjectURL = (b) => { got = { size: b.size, furn: v.furnGroup.children.length, lights: v.lightGroup.children.length }; return oc.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () {};
    try { await v.exportGLB('x'); } finally { URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = a; }
    return got;
  });
  const glbHidden = await glb();
  // 360 全景也一樣：拍的那一刻場景裡家具、燈具都在（等模型載完、全部重建）
  const pano = await p3.evaluate(async () => {
    const v = window.__app.view3d, r = v.renderer, orig = r.render; let seen = null;
    r.render = function (...a) { seen ??= { furn: v.furnGroup.children.length, lights: v.lightGroup.children.length }; return orig.apply(this, a); };
    try { await v.loadAllModels(); seen = null; v.capturePanorama(); } finally { r.render = orig; }
    return seen;
  });
  ok(pano?.furn === 29 && pano?.lights === 135, `360 全景照舊全拍（拍的時候家具 ${pano?.furn}、燈具 ${pano?.lights}）`);
  const afterExport = await g3();
  ok(afterExport.lights === 0 && afterExport.furn === 0, `匯出完畫面照舊藏著（燈具 ${afterExport.lights}、家具 ${afterExport.furn}）`);
  await tick(p3, 'furniture', true);
  await p3.waitForTimeout(1500);
  const furn3 = await g3();
  ok(furn3.furn === 29 && furn3.lights === 0, `3D 勾回家具：家具 ${furn3.furn}、燈具還是 ${furn3.lights}`);
  await tick(p3, 'lights', true);
  await p3.waitForTimeout(1500);
  const all3 = await g3();
  ok(all3.lights > 0, `3D 勾回燈具：燈具模型 ${all3.lights} 個`);
  // 回到預設，不留給下一段
  for (const g of ['outlets', 'notes']) await tick(p3, g, true);
  ok(await p3.evaluate(() => localStorage.getItem('interior_view_hidden')) === '[]', '全部勾回來');
  await p3.waitForTimeout(1500);
  const glbAll = await glb();
  ok(glbHidden.furn === 29 && glbHidden.lights === glbAll.lights && glbAll.lights > 0 && glbHidden.size > 1e6,
    `匯出 3D 不受顯示影響（藏著時匯出：家具 ${glbHidden.furn}、燈具 ${glbHidden.lights}；全顯示：家具 ${glbAll.furn}、燈具 ${glbAll.lights}）`);
  await ctx.close();
}

console.log('\nB28 插座開關、尺寸線（空白方案，A1 沒有插座）');
{
  const { ctx, page } = await open(`${BASE}/?perf=1`);
  await page.evaluate(() => { const d = window.__app.doc; d.commit();
    d.add({ id: 'w1', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 12 });
    d.add({ id: 's1', kind: 'electrical', layer: 'electrical', item: 'socket2', x: 100, y: 6, angle: 0 });
    d.add({ id: 'k1', kind: 'electrical', layer: 'electrical', item: 'switch1', x: 200, y: 6, angle: 0 });
    d.add({ id: 'm1', kind: 'dimension', layer: 'dims', a: { x: 0, y: 60 }, b: { x: 400, y: 60 }, offset: 0 });
    const v = window.__app.editor.vp; v.scale = 2; v.centerOn(200, 30, 0, 0); });
  let d = await drawn(page);
  ok(count(d, OUTLET) === 2 && count(d, /^dimension:/) === 1, `全勾：插座開關 ${count(d, OUTLET)}、尺寸線 ${count(d, /^dimension:/)}`);
  await tick(page, 'outlets', false);
  await tick(page, 'notes', false);
  d = await drawn(page);
  ok(count(d, OUTLET) === 0 && count(d, /^dimension:/) === 0 && count(d, /^wall:/) === 1, `勾掉插座開關、尺寸與標註：都不畫、牆照畫（${d.join(' ')}）`);
  await tick(page, 'outlets', true);
  await tick(page, 'notes', true);
  // 藏著燈具時新增一盞：燈具自動勾回來，不會加了卻看不到
  await tick(page, 'lights', false);
  await page.evaluate(() => window.__app.doc.add({ id: 'd1', kind: 'electrical', layer: 'electrical', item: 'downlight', x: 200, y: 100, angle: 0 }));
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({ on: document.querySelector('#showMenu input[data-show="lights"]').checked, flash: document.body.innerText.includes('已重新顯示燈具') }));
  d = await drawn(page);
  ok(back.on && count(d, LIGHT) === 1 && back.flash, `藏著燈具時新增嵌燈：燈具自動勾回來、畫得出來、有提示（勾 ${back.on}、提示 ${back.flash}）`);
  await ctx.close();
}

// ---------------------------------------------------------------- B29
console.log('\nB29 LED 鋁擠燈＋崁燈系列：2D／3D 畫得出、照度有貢獻、線燈長度可調、「顯示」勾掉時一起藏（空白方案）');
{
  const NEW = ['linearRecessed', 'linearSurface', 'linearCove', 'linearWash', 'linearShelf', 'dlFrameless', 'dlDeep', 'dlAdjust', 'dlWash', 'dlTwin'];
  const NEWRE = new RegExp(`^electrical:(${NEW.join('|')})$`);
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: 'split' });
  // 燈與電分頁：兩排新燈各 5 顆（按鈕在分頁打開時才建）
  await page.locator('.cat-tab', { hasText: '燈與電' }).click();
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => {
    const out = {};
    for (const id of ['linearRecessed', 'linearSurface', 'linearCove', 'linearWash', 'linearShelf', 'dlFrameless', 'dlDeep', 'dlAdjust', 'dlWash', 'dlTwin'])
      out[id] = !!document.querySelector(`[data-elec="${id}"]`);
    return out;
  });
  ok(Object.values(rows).every(Boolean), `「燈與電」裡十種新燈都有按鈕（${Object.entries(rows).filter(([, v]) => !v).map(([k]) => k).join('、') || '全有'}）`);
  // 600×500 的房間：天花兩條線燈、上牆間接燈槽、左牆洗牆、右牆櫃內層板燈、五種崁燈
  await page.evaluate(() => { const d = window.__app.doc; d.commit();
    const w = (id, a, b) => d.add({ id, kind: 'wall', layer: 'walls', a, b, thickness: 12 });
    w('w1', { x: 0, y: 0 }, { x: 600, y: 0 }); w('w2', { x: 600, y: 0 }, { x: 600, y: 500 });
    w('w3', { x: 600, y: 500 }, { x: 0, y: 500 }); w('w4', { x: 0, y: 500 }, { x: 0, y: 0 });
    d.add({ id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 600, h: 500, name: '客廳', poly: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 500 }, { x: 0, y: 500 }] });
    const e = (id, item, x, y, more = {}) => d.add({ id, kind: 'electrical', layer: 'electrical', item, x, y, angle: 0, ...more });
    e('L1', 'linearRecessed', 300, 150, { length: 300 });
    e('L2', 'linearSurface', 300, 350, { length: 200 });
    e('L3', 'linearCove', 300, 6, { angle: 180, length: 400 });
    e('L4', 'linearWash', 6, 250, { angle: 90, length: 300 });
    e('L5', 'linearShelf', 594, 250, { angle: 270, length: 120, elevation: 150 });
    e('D1', 'dlFrameless', 100, 100); e('D2', 'dlDeep', 500, 100); e('D3', 'dlAdjust', 100, 400);
    e('D4', 'dlWash', 500, 400); e('D5', 'dlTwin', 300, 250);
    d.select(null);
  });
  await page.evaluate(() => document.getElementById('zoomFit')?.click());
  await page.waitForTimeout(800);
  let d = await drawn(page);
  const each = NEW.map(id => [id, d.filter(s => s === `electrical:${id}`).length]);
  ok(each.every(([, n]) => n === 1), `2D 每種新燈畫一次（${each.map(([k, n]) => `${k} ${n}`).join('、')}）`);
  // 安靜畫法真的有墨：每盞燈畫跟不畫，它周圍的像素不一樣
  const inked = await page.evaluate(() => {
    const cv = document.getElementById('canvas'), g = cv.getContext('2d'), v = window.__app.editor.vp, dpr = cv.width / cv.clientWidth;
    const r = window.__app.editor.renderer, orig = r.drawObject, out = [];
    for (const o of window.__app.doc.objects.filter(o => o.kind === 'electrical')) {
      const s = v.toScreen({ x: o.x, y: o.y }), box = () => g.getImageData(Math.round(s.x * dpr) - 8, Math.round(s.y * dpr) - 8, 16, 16).data;
      window.__app.editor.renderNow(); const a = box();
      r.drawObject = function (x, c) { return x.id === o.id ? undefined : orig.call(this, x, c); };
      try { window.__app.editor.renderNow(); } finally { r.drawObject = orig; }
      const b = box(); let diff = 0;
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 8) diff++;
      out.push([o.item, diff]);
    }
    window.__app.editor.renderNow();
    return out;
  });
  ok(inked.every(([, n]) => n > 4), `2D 每盞新燈畫跟不畫看得出差別（差異像素 ${inked.map(([k, n]) => `${k} ${n}`).join('、')}）`);
  await page.screenshot({ path: `${OUT}luxury-b29-2d.png` });

  // 照度：十盞都算進這間房，拿掉任一盞平均照度就下降
  const luxNow = async () => {
    await page.evaluate(() => { const b = document.querySelector('[data-act="lighting"]'); b.click(); b.click(); });
    await page.waitForFunction(() => window.__app.lighting.rooms.length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    return page.evaluate(() => window.__app.lighting.rooms.find(r => r.id === 'r1'));
  };
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());
  await page.waitForFunction(() => window.__app.lighting.rooms.length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const all = await page.evaluate(() => window.__app.lighting.rooms.find(r => r.id === 'r1'));
  ok(all?.lums === 10 && all.avg > 50, `照度面板：客廳算進 ${all?.lums} 盞、平均 ${all?.avg?.toFixed(0)} lx`);
  const drops = [];
  for (const id of ['L1', 'L2', 'L3', 'L4', 'L5', 'D1', 'D2', 'D3', 'D4', 'D5']) {
    const item = await page.evaluate((id) => { const d = window.__app.doc, o = d.objects.find(o => o.id === id); d.commit(); d.remove(id); return o.item; }, id);
    const r = await luxNow();
    drops.push([item, all.avg - r.avg]);
    await page.evaluate(() => window.__app.doc.undo());
  }
  ok(drops.every(([, x]) => x > 0.5), `每種新燈都有照度貢獻（拿掉後平均少 ${drops.map(([k, x]) => `${k} ${x.toFixed(1)}`).join('、')} lx）`);
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());
  ok(await page.evaluate(() => window.__app.doc.objects.filter(o => o.kind === 'electrical').length) === 10, '復原後十盞都在');

  // 3D：每盞燈的零件都建出來
  const want3 = await page.evaluate(async () => {
    const { lightParts } = await import('/src/core/lights3d.ts');
    return window.__app.doc.objects.filter(o => o.kind === 'electrical').reduce((n, o) => n + lightParts(o, 280).length, 0);
  });
  await page.waitForTimeout(1500);
  const got3 = await page.evaluate(() => window.__app.view3d.lightGroup.children.length);
  ok(got3 === want3 && want3 >= 18, `3D 燈具零件 ${got3} 個（應為 ${want3}）`);
  const glow = await page.evaluate(() => window.__app.view3d.lightGroup.children.filter(m => m.material?.type === 'MeshBasicMaterial').length);
  ok(glow >= 11, `3D 發光的零件 ${glow} 個（雙頭格柵兩顆）`);
  await page.screenshot({ path: `${OUT}luxury-b29-split.png` });

  // 屬性面板改長度：打 450 → 線燈變 450 cm、流明照長度跟著變、2D 畫得一樣長
  await page.evaluate(() => window.__app.doc.select('L1'));
  await page.waitForTimeout(400);
  const lenInput = page.locator('#properties .prop', { hasText: '燈長' }).locator('input');
  ok(await lenInput.count() === 1, '選嵌入式鋁擠線燈：屬性面板有「燈長」');
  await lenInput.fill('450');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const o = window.__app.doc.objects.find(o => o.id === 'L1');
    const lm = [...document.querySelectorAll('#properties .prop')].find(r => r.textContent.includes('流明'))?.querySelector('input')?.placeholder;
    return { len: o.length, lm };
  });
  ok(after.len === 450 && after.lm === '3600', `燈長改成 ${after.len} cm、流明預設跟著變 ${after.lm} lm（800 lm/m）`);
  await lenInput.fill('9000');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__app.doc.objects.find(o => o.id === 'L1').length) === 600, '燈長打超過上限只到 600 cm');
  await lenInput.fill('450');
  await page.waitForTimeout(300);
  const wide = await page.evaluate(() => {
    const r = window.__app.editor.renderer, orig = r.drawObject; let w = 0;
    const P = CanvasRenderingContext2D.prototype, rect = P.rect;
    r.drawObject = function (o, c) {
      if (o.id !== 'L1') return orig.call(this, o, c);
      P.rect = function (x, y, rw, rh) { w = Math.max(w, rw); return rect.call(this, x, y, rw, rh); };
      try { return orig.call(this, o, c); } finally { P.rect = rect; }
    };
    try { window.__app.editor.renderNow(); } finally { r.drawObject = orig; }
    return w;
  });
  ok(Math.abs(wide - 450) < 0.01, `2D 照新長度畫（${wide} cm）`);

  // 從面板放一盞：落地就是預設長度
  await page.evaluate(() => window.__app.doc.select(null));
  if (!(await page.locator('[data-elec="linearCove"]').isVisible())) await page.locator('.cat-tab', { hasText: '燈與電' }).click();
  await page.click('[data-elec="linearCove"]');
  const at = await page.evaluate(() => { const s = window.__app.editor.vp.toScreen({ x: 300, y: 494 }), r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y }; });
  await page.mouse.move(at.x, at.y - 3); await page.mouse.click(at.x, at.y - 3);
  await page.waitForTimeout(300);
  const placed = await page.evaluate(() => window.__app.doc.objects.filter(o => o.item === 'linearCove').at(-1));
  ok(placed && placed.length === 240 && placed.elevation === undefined && placed.angle === 0 && Math.abs(placed.y - 494) < 1,
    `從面板放間接燈槽：貼下牆內面、朝房間、預設 240 cm、高度跟天花走（${JSON.stringify({ y: placed?.y, angle: placed?.angle, length: placed?.length, elevation: placed?.elevation })}）`);
  await page.keyboard.press('Escape');

  // 「顯示」勾掉燈具：新燈 2D／3D 一起藏
  await tick(page, 'lights', false);
  await page.waitForTimeout(1200);
  d = await drawn(page);
  const hid3 = await page.evaluate(() => window.__app.view3d.lightGroup.children.length);
  ok(count(d, NEWRE) === 0 && hid3 === 0, `勾掉燈具：新燈 2D 畫了 ${count(d, NEWRE)} 盞、3D 零件 ${hid3} 個`);
  await tick(page, 'lights', true);
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => localStorage.getItem('interior_view_hidden')) === '[]', '勾回來');
  await ctx.close();
}

ok(errs.length === 0, `沒有頁面錯誤（${errs.slice(0, 3).join(' | ') || '0'}）`);
await br.close();
console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
