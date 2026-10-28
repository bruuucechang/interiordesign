// B21～B24（docs/spec-game-polish.md）：遊戲眼光的第二輪修整，在真的頁面上驗。
//
//   node bench/verify-polish.mjs [http://localhost:5180]     # 要先 npm run dev
//
// Headless、用這台的 Metal（swiftshader 開 3D 太慢）。截圖在 bench/results/polish-*.png。
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
  // 只讀不寫：A1 是使用者的真資料，空白方案也不該留在他的清單裡（同 verify-b19）。
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
const count = (page) => page.evaluate(() => window.__app.doc.objects.length);
const addRoom = (page) => page.evaluate(() => { const d = window.__app.doc; d.commit();
  const W = (id, a, b) => d.add({ id, kind: 'wall', layer: 'walls', a, b, thickness: 12, height: 280 });
  W('w1', { x: 0, y: 0 }, { x: 400, y: 0 }); W('w2', { x: 400, y: 0 }, { x: 400, y: 300 });
  W('w3', { x: 400, y: 300 }, { x: 0, y: 300 }); W('w4', { x: 0, y: 300 }, { x: 0, y: 0 });
  // 房間自己放：API 寫入被擋（rooms/detect 是 POST），自動偵測不會跑
  d.add({ id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: '房間' }); })
  // 空白這層的第一間房會讓鏡頭拉近（B24，400 ms）：等它做完，後面自己設的鏡頭才不會被蓋掉
  .then(() => page.waitForTimeout(600));
const S = (page, x, y) => page.evaluate(([x, y]) => { const v = window.__app.editor.vp, c = document.getElementById('canvas').getBoundingClientRect();
  const p = v.toScreen({ x, y }); return [c.left + p.x, c.top + p.y]; }, [x, y]);
const hint = (page) => page.evaluate(() => { const h = document.getElementById('hint'); return getComputedStyle(h).display === 'none' ? '' : h.textContent; });
const furnCount = (page) => page.evaluate(() => window.__app.doc.objects.filter(o => o.kind === 'furniture').length);

// ---------------------------------------------------------------- B21
console.log('B21 3D 裡的鍵盤指令');
{
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: '3d' });
  await addRoom(page);
  await page.waitForTimeout(500);
  await page.mouse.click(700, 400);
  const n0 = await count(page);
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(200);
  ok(await count(page) < n0, `只看 3D 時 ⌘Z 復原（${n0} → ${await count(page)}）`);
  await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(200);
  ok(await count(page) === n0, '⌘⇧Z 重做回來');
  await page.evaluate(() => window.__app.doc.select('w1'));
  await page.keyboard.press('Delete'); await page.waitForTimeout(200);
  ok(!(await page.evaluate(() => window.__app.doc.objects.some(o => o.id === 'w1'))), '只看 3D 時 Delete 刪掉選取的牆');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.__app.doc.objects.some(o => o.id === 'w1')), 'Ctrl+Z 也能復原');
  // 焦點在下拉選單上：⌘ 組合鍵照常，Delete 不刪（B21 第二輪審查）
  await page.evaluate(() => window.__app.doc.select('w1'));
  await page.focus('#timeOfDay');
  await page.keyboard.press('Delete'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.__app.doc.objects.some(o => o.id === 'w1')), '焦點在下拉選單時 Delete 不刪東西');
  const n1 = await count(page);
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(150);
  ok(await count(page) < n1, '焦點在下拉選單時 ⌘Z 照常復原');
  await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(150);
  await page.mouse.click(700, 400);
  // 3D 移動鍵不能被 2D 搶走：按 W 不會切工具、也不會平移 2D
  const tool0 = await page.evaluate(() => window.__app.editor.toolName);
  await page.keyboard.press('n'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__app.editor.toolName) === tool0, '3D 有焦點時單鍵工具切換（N）仍只給 2D');
  await ctx.close();
}

console.log('\nB21 行走出生點');
{
  const { ctx, page } = await open(`${BASE}/?perf=1&plan=plan1151022`, { plan: true, mode: '3d' });
  await page.waitForTimeout(1500);
  const cam0 = await page.evaluate(() => { const c = window.__app.view3d.camera.position; return [c.x, c.y, c.z]; });
  await page.click('#walkToggle'); await page.waitForTimeout(600);
  const ahead = await page.evaluate(() => {
    // 正前方第一道牆有多遠：沿視線每 5 cm 量一次，看那點離最近的牆中心線
    const a = window.__app, s = a.view3d.walk.state;
    const fx = -Math.sin(s.yaw), fy = -Math.cos(s.yaw);
    const walls = a.doc.project.floors[s.floor].objects.filter(o => o.kind === 'wall');
    const dist = (px, py, w) => { const wx = w.b.x - w.a.x, wy = w.b.y - w.a.y, l2 = wx * wx + wy * wy;
      const t = Math.max(0, Math.min(1, ((px - w.a.x) * wx + (py - w.a.y) * wy) / l2)); return Math.hypot(px - w.a.x - wx * t, py - w.a.y - wy * t) - (w.thickness ?? 12) / 2; };
    for (let d = 0; d <= 400; d += 5) { const px = s.x + fx * d, py = s.y + fy * d; if (walls.some(w => dist(px, py, w) <= 0)) return d; }
    return 400;
  });
  ok(ahead >= 200, `A1 進行走：正前方 ${ahead} cm 內沒有牆（至少 200）`);
  // 3D 的朝向就是 walkSpawn 選的方向（yaw 換算沒有轉反）
  const dot = await page.evaluate(() => {
    const a = window.__app, s = a.view3d.walk.state, v = a.view3d.walk;
    const objs = a.doc.project.floors[s.floor].objects;
    const fx = -Math.sin(s.yaw), fy = -Math.cos(s.yaw);
    const h = v.lastHeading;
    return fx * Math.cos(h) + fy * Math.sin(h);
  });
  ok(dot > 0.99, `行走朝向跟選的方向一致（內積 ${dot.toFixed(3)}）`);
  await page.screenshot({ path: `${OUT}polish-walk-spawn.png` });
  // 靠到牆前看牆面（不該是馬賽克）：往前走到停
  await page.keyboard.down('w'); await page.waitForTimeout(4000); await page.keyboard.up('w');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}polish-wall-closeup.png` });
  await page.keyboard.press('f'); await page.waitForTimeout(600);
  const cam1 = await page.evaluate(() => { const c = window.__app.view3d.camera.position; return [c.x, c.y, c.z]; });
  ok(Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1], cam1[2] - cam0[2]) < 1, `離開行走相機回到原本的俯瞰（差 ${Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1], cam1[2] - cam0[2]).toFixed(1)} cm）`);
  await ctx.close();
}


// ---------------------------------------------------------------- B22
console.log('\nB22 放東西的手感');
{
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: '2d' });
  await addRoom(page);
  await page.evaluate(() => { window.__app.editor.vp.scale = 1.6; window.__app.editor.vp.origin = { x: -150, y: -80 }; window.__app.editor.render(); });
  // 茶几放在地毯上不算重疊（地毯是鋪地的，B22 審查）
  await page.evaluate(() => window.__app.doc.add({ id: 'rug1', kind: 'furniture', layer: 'furniture', item: 'rug', x: 120, y: 30, w: 200, h: 140, angle: 0, label: '地毯' }));
  await page.click('[data-cat="客廳"]');
  await page.click('#catalogShelf .furn-btn:has-text("茶几")');
  let [sx, sy] = await S(page, 220, 100);
  await page.mouse.move(sx, sy, { steps: 4 }); await page.waitForTimeout(150);
  ok(!/地毯/.test(await hint(page)), `茶几滑到地毯上不說重疊（「${await hint(page)}」）`);
  ok(!(await hint(page)).includes('⚠'), `茶几在地毯上沒有任何警告（「${await hint(page)}」）`);
  await page.keyboard.press('Escape');
  await page.click('[data-cat="臥室"]');
  await page.click('#catalogShelf .furn-btn:has-text("單人床")');
  const f0 = await furnCount(page);
  await page.keyboard.down('Shift');
  for (const [x, y] of [[80, 150], [200, 150], [320, 150]]) { const [sx, sy] = await S(page, x, y); await page.mouse.move(sx, sy, { steps: 3 }); await page.mouse.click(sx, sy); }
  await page.keyboard.up('Shift');
  ok(await furnCount(page) === f0 + 3 && await page.evaluate(() => window.__app.editor.toolName) === 'furniture', `按住 Shift 連放三件、東西還在手上（多了 ${await furnCount(page) - f0} 件）`);
  // 疊在剛放的床上：預覽變紅、提示列講原因，照樣放得下去
  [sx, sy] = await S(page, 90, 160);
  await page.mouse.move(sx, sy, { steps: 4 }); await page.waitForTimeout(150);
  const warn = await hint(page);
  ok(/重疊/.test(warn), `疊在床上：提示列寫原因（「${warn}」）`);
  await page.screenshot({ path: `${OUT}polish-overlap-red.png` });
  await page.mouse.click(sx, sy); await page.waitForTimeout(150);
  ok(await furnCount(page) === f0 + 4 && await page.evaluate(() => window.__app.editor.toolName) === 'select', '照樣放得下去，沒按 Shift 就回到選取');
  // 房間外
  await page.click('#catalogShelf .furn-btn:has-text("單人床")');
  [sx, sy] = await S(page, 700, 150);
  await page.mouse.move(sx, sy, { steps: 4 }); await page.waitForTimeout(150);
  ok(/房間/.test(await hint(page)), `放到房間外：提示列寫原因（「${await hint(page)}」）`);
  await page.keyboard.press('Escape');
  // 門點在空地
  await page.click('[data-cat="structure"]');
  await page.click('.tool-btn[data-tool="door"]');
  const doors0 = await page.evaluate(() => window.__app.doc.objects.filter(o => o.kind === 'door').length);
  [sx, sy] = await S(page, 200, 150);
  await page.mouse.move(sx, sy, { steps: 4 }); await page.mouse.click(sx, sy); await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.__app.doc.objects.filter(o => o.kind === 'door').length) === doors0 && /門窗要點在牆上/.test(await hint(page)),
    `門點在房間中間：不放、提示列說最近的牆多遠（「${await hint(page)}」）`);
  await ctx.close();
}
{
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: '3d' });
  await addRoom(page);
  await page.evaluate(() => { const d = window.__app.doc; d.add({ id: 'bed1', kind: 'furniture', layer: 'furniture', item: 'bed_single', x: 150, y: 50, w: 100, h: 200, angle: 0, label: '單人床' }); });
  await page.waitForTimeout(800);
  // 3D 的預覽：滑過已經有床的地方要變紅、提示寫原因（找螢幕上踩到床那一點）
  await page.click('[data-cat="臥室"]');
  await page.click('#catalogShelf .furn-btn:has-text("單人床")');
  const spot = await page.evaluate(() => {
    const v = window.__app.view3d, c = v.renderer.domElement.getBoundingClientRect();
    for (let y = c.top + 40; y < c.bottom - 40; y += 12) for (let x = c.left + 40; x < c.right - 40; x += 12) {
      const p = v.floorPoint({ clientX: x, clientY: y });
      if (p && p.x > 170 && p.x < 230 && p.y > 100 && p.y < 200) return [x, y];
    }
    return null;
  });
  ok(!!spot, '3D 裡找得到床所在的那塊地板');
  if (spot) {
    await page.mouse.move(spot[0], spot[1], { steps: 5 }); await page.waitForTimeout(200);
    const h3 = await page.evaluate(() => document.getElementById('hint3d').textContent);
    ok(/重疊/.test(h3), `3D 預覽疊在床上：提示寫原因（「${h3}」）`);
    await page.screenshot({ path: `${OUT}polish-overlap-3d.png` });
    await page.mouse.move(700, 20, { steps: 3 }); await page.waitForTimeout(200);   // 移到頂列，離開 3D 畫面
    ok(!/⚠/.test(await page.evaluate(() => document.getElementById('hint3d').textContent)), '游標離開 3D 畫面，警告跟著收掉');
  }
  await page.keyboard.press('Escape');
  // 只開 3D：門點在空地要在 3D 底下說（2D 的提示列這時看不到）
  await page.click('[data-cat="structure"]');
  await page.click('.tool-btn[data-tool="door"]');
  const empty = await page.evaluate(() => {
    const v = window.__app.view3d, c = v.renderer.domElement.getBoundingClientRect();
    for (let y = c.bottom - 60; y > c.top + 40; y -= 12) for (let x = c.left + 40; x < c.right - 40; x += 24) {
      const p = v.floorPoint({ clientX: x, clientY: y });
      if (p && (p.x < -300 || p.x > 700 || p.y < -300 || p.y > 600)) return [x, y];
    }
    return null;
  });
  if (empty) {
    const d0 = await page.evaluate(() => window.__app.doc.objects.filter(o => o.kind === 'door').length);
    await page.mouse.click(empty[0], empty[1]); await page.waitForTimeout(200);
    const h3 = await page.evaluate(() => document.getElementById('hint3d').textContent);
    ok(await page.evaluate(() => window.__app.doc.objects.filter(o => o.kind === 'door').length) === d0 && /門窗要點在牆上/.test(h3),
      `只開 3D：門點在空地不放、3D 底下說原因（「${h3}」）`);
  } else ok(false, '3D 裡找不到離牆 3 m 以外的空地');
  await ctx.close();
}

// ---------------------------------------------------------------- B23
console.log('\nB23 房間會自己認得');
{
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: '2d' });
  await addRoom(page);
  await page.evaluate(() => { window.__app.editor.vp.scale = 1.6; window.__app.editor.vp.origin = { x: -150, y: -80 }; window.__app.editor.render(); });
  // 平面圖上畫了哪些字：攔 fillText 重畫一次
  const drawn = () => page.evaluate(() => {
    const P = CanvasRenderingContext2D.prototype, orig = P.fillText, seen = [];
    P.fillText = function (s, ...r) { seen.push(String(s)); return orig.call(this, s, ...r); };
    try { window.__app.editor.renderNow(); } finally { P.fillText = orig; }
    return seen;
  });
  const roomName = () => page.evaluate(() => window.__app.doc.objects.find(o => o.id === 'r1').name);
  const placeFrom = async (cat, name, x, y) => {
    await page.click(`[data-cat="${cat}"]`);
    await page.locator(`#catalogShelf .furn-btn:has-text("${name}")`).first().click();
    const [sx, sy] = await S(page, x, y);
    await page.mouse.move(sx, sy, { steps: 3 }); await page.mouse.click(sx, sy); await page.waitForTimeout(150);
  };
  ok(!(await drawn()).some(s => s.startsWith('缺')), '空房間：沒有「缺」那一行');
  await placeFrom('臥室', '單人床', 120, 150);
  let t = await drawn();
  ok(t.includes('臥室') && t.includes('缺：燈、衣櫃'), `放了床：房名顯示「臥室」、下一行「缺：燈、衣櫃」（畫了：${t.filter(s => /臥室|缺|房間/.test(s)).join(' / ')}）`);
  ok(await roomName() === '房間', `存檔的名字沒被改（${await roomName()}）`);
  await page.screenshot({ path: `${OUT}polish-room-use.png` });
  await placeFrom('lights', '吸頂燈', 260, 150);
  t = await drawn();
  ok(t.includes('缺：衣櫃') && !t.includes('缺：燈、衣櫃'), `放了燈：「缺」只剩衣櫃（${t.filter(s => s.startsWith('缺')).join(' / ')}）`);
  await placeFrom('臥室', '衣櫃', 300, 260);
  t = await drawn();
  ok(t.includes('臥室') && !t.some(s => s.startsWith('缺')), `燈和衣櫃都有了：「缺」那一行消失（${t.filter(s => s.startsWith('缺')).join(' / ') || '沒有'}）`);
  // 屬性面板：選房間看得到用途；改了名就以使用者的為準
  await page.evaluate(() => { window.__app.doc.select('r1'); });
  await page.waitForTimeout(200);
  const panel = await page.evaluate(() => document.getElementById('properties')?.textContent ?? document.body.textContent);
  ok(/用途\s*臥室/.test(panel), '屬性面板寫「用途 臥室」');
  await page.evaluate(() => { const d = window.__app.doc; d.commit(); d.update('r1', { name: '主臥', auto: false }); });
  // 拿掉衣櫃：改過名的房間照樣說缺什麼，房名不換
  await page.evaluate(() => { const d = window.__app.doc; const w = d.objects.find(o => o.kind === 'furniture' && o.item === 'wardrobe'); d.commit(); d.remove(w.id); });
  t = await drawn();
  ok(t.includes('主臥') && !t.includes('臥室') && t.includes('缺：衣櫃'), `改名「主臥」：房名不被換掉、照樣寫缺什麼（${t.filter(s => /臥|缺/.test(s)).join(' / ')}）`);
  await ctx.close();
}

// ---------------------------------------------------------------- B24
// 平面圖上每個標籤的底框（同 renderer.text 的算法），攔 fillText 重畫一次
const labelBoxes = (page) => page.evaluate(() => {
  const P = CanvasRenderingContext2D.prototype, orig = P.fillText, seen = [];
  P.fillText = function (s, x, y, ...r) {
    const w = this.measureText(String(s)).width;
    seen.push({ s: String(s), x: x - w / 2 - 4, y: y - 9, w: w + 8, h: 18 });
    return orig.call(this, s, x, y, ...r);
  };
  try { window.__app.editor.renderNow(); } finally { P.fillText = orig; }
  const v = window.__app.editor.vp;
  return seen.filter(b => b.x + b.w > 0 && b.x < v.width && b.y + b.h > 0 && b.y < v.height);
});
const overlapping = (bs) => {
  const out = [];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j];
    // 半像素容差同 labelLayout：同一間房的兩行換回螢幕是 17.99999 px，貼著不算疊
    const e = 0.5;
    if (a.x < b.x + b.w - e && b.x < a.x + a.w - e && a.y < b.y + b.h - e && b.y < a.y + a.h - e) out.push(`${a.s}×${b.s}`);
  }
  return out;
};

console.log('\nB24 空白方案的開場卡');
{
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: '2d' });
  const cardBox = () => page.evaluate(() => { const c = document.getElementById('startCard'); if (!c) return null;
    const r = c.getBoundingClientRect(), p = document.getElementById('pane2d').getBoundingClientRect();
    return { dx: (r.left + r.width / 2) - (p.left + p.width / 2), dy: (r.top + r.height / 2) - (p.top + p.height / 2),
      text: c.textContent, passive: c.classList.contains('passive') }; });
  let c = await cardBox();
  ok(c && Math.abs(c.dx) < 2 && Math.abs(c.dy) < 2 && c.text.includes('從這裡開始'), `空白方案：平面圖正中間有「從這裡開始」（偏 ${c ? `${c.dx.toFixed(1)},${c.dy.toFixed(1)}` : '沒有卡'}）`);
  ok(c && c.text.includes('畫牆') && c.text.includes('匯入平面圖照片'), '卡上兩顆鈕：畫牆、匯入平面圖照片');
  await page.screenshot({ path: `${OUT}polish-start-card.png` });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(300);
  c = await cardBox();
  ok(c && Math.abs(c.dx) < 2 && Math.abs(c.dy) < 2, '1280 寬：卡照樣在平面圖正中間');
  await page.screenshot({ path: `${OUT}polish-start-card-1280.png` });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  // 「匯入平面圖照片」打開的是底圖的檔案選擇器
  const chooser = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
  await page.click('#startCard [data-start="photo"]');
  const fc = await chooser;
  ok(fc && (await fc.element().evaluate(e => e.id)) === 'imageInput', '「匯入平面圖照片」打開底圖的檔案選擇（#imageInput）');
  await page.click('#startCard [data-start="wall"]');
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => ({ tool: window.__app.editor.toolName,
    open: document.querySelector('[data-cat="structure"]').classList.contains('open') }));
  ok(st.tool === 'wall' && st.open, `「畫牆」拿起直線牆、打開「結構」（工具 ${st.tool}、結構${st.open ? '開' : '沒開'}）`);
  c = await cardBox();
  ok(c && c.passive, '拿著工具時卡變淡、點擊穿過');
  // 第一筆就點在卡的正中間：點得到平面圖
  const pane = await page.evaluate(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.click(pane[0], pane[1]);
  await page.mouse.move(pane[0] + 200, pane[1], { steps: 4 });
  await page.mouse.click(pane[0] + 200, pane[1]);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const walls = await page.evaluate(() => window.__app.doc.objects.filter(o => o.kind === 'wall').length);
  ok(walls >= 1 && !(await cardBox()), `畫下第一道牆（從卡的位置點下去，${walls} 道）後卡消失`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__app.editor.selectTool('select'));
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(200);
  ok(await count(page) === 0 && !!(await cardBox()), '復原到這層什麼都沒有：卡回來');
  await ctx.close();
}

console.log('\nB24 導覽提示在有東西之後收起');
{
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem('interior_lang', 'zh-Hant'); localStorage.setItem('interior_view_mode', '2d');
    localStorage.setItem('interior_owner', 'own_orsxp52fbvey'); });
  await page.goto(`${BASE}/?perf=1`, { timeout: 400000 });
  await page.waitForSelector('.tour-nudge', { timeout: 10000 }).catch(() => null);
  ok(!!(await page.$('.tour-nudge')), '第一次開空白方案：右下角有「第一次用嗎？」');
  await addRoom(page); await page.waitForTimeout(200);
  ok(!(await page.$('.tour-nudge')), '放了第一樣東西：提示自己收起');
  ok(await page.evaluate(() => localStorage.getItem('interior_tour_seen') === '1'), '而且記成看過');
  await ctx.close();
}
{
  // 提示還沒出來（兩秒內）就畫了東西：也算答過，之後不出現
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem('interior_lang', 'zh-Hant'); localStorage.setItem('interior_view_mode', '2d');
    localStorage.setItem('interior_owner', 'own_orsxp52fbvey'); });
  await page.goto(`${BASE}/?perf=1`, { timeout: 400000 });
  await page.waitForFunction(() => !!window.__app, null, { timeout: 60000 });
  await addRoom(page);
  await page.waitForTimeout(2500);
  ok(!(await page.$('.tour-nudge')) && await page.evaluate(() => localStorage.getItem('interior_tour_seen') === '1'), '提示出來前就畫了東西：記成看過、提示不出現');
  await ctx.close();
}

console.log('\nB24 第一間房圍出來時鏡頭拉近一次');
{
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: '2d' });
  const share = (id) => page.evaluate((id) => { const v = window.__app.editor.vp, r = window.__app.doc.objects.find(o => o.id === id);
    return r.w * r.h * v.scale * v.scale / (v.width * v.height); }, id);
  await page.evaluate(() => { const v = window.__app.editor.vp; v.scale = 0.15; v.centerOn(200, 150, 0, 0); window.__app.editor.render(); });
  const s0 = await page.evaluate(() => { const v = window.__app.editor.vp; return 400 * 300 * v.scale * v.scale / (v.width * v.height); });
  await addRoom(page);
  await page.waitForTimeout(100);
  const s1 = await share('r1');
  ok(s0 < 0.3 && s1 > 0.3 && s1 < 0.6, `4×3 m 的房間從占畫面 ${(s0 * 100).toFixed(1)}% 拉近到 ${(s1 * 100).toFixed(1)}%`);
  const centred = await page.evaluate(() => { const v = window.__app.editor.vp, p = v.toScreen({ x: 200, y: 150 }); return [p.x - v.width / 2, p.y - v.height / 2]; });
  ok(Math.abs(centred[0]) < 2 && Math.abs(centred[1]) < 2, `房間在畫面正中（偏 ${centred.map(n => n.toFixed(1)).join(',')} px）`);
  await page.evaluate(() => { const v = window.__app.editor.vp; v.scale = 0.15; window.__app.editor.render(); });
  await page.evaluate(() => { const d = window.__app.doc; d.commit();
    d.add({ id: 'r2', kind: 'room', layer: 'rooms', x: 600, y: 0, w: 300, h: 300, name: '房間' }); });
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => window.__app.editor.vp.scale) === 0.15, '第二間房不再動鏡頭');
  await ctx.close();
}
{
  // 拉近途中使用者自己動了鏡頭：他的為準，動畫停手
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: '2d' });
  await page.evaluate(() => { const v = window.__app.editor.vp; v.scale = 0.15; window.__app.editor.render(); });
  await page.evaluate(() => { const d = window.__app.doc; d.commit();
    d.add({ id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: '房間' }); });
  await page.waitForTimeout(120);
  await page.evaluate(() => { const v = window.__app.editor.vp; v.scale = 0.2; v.origin = { x: -500, y: -500 }; window.__app.editor.render(); });
  await page.waitForTimeout(600);
  const v = await page.evaluate(() => { const v = window.__app.editor.vp; return [v.scale, v.origin.x, v.origin.y]; });
  ok(v[0] === 0.2 && v[1] === -500 && v[2] === -500, `拉近途中自己動了鏡頭：停在使用者設的位置（${v.join(', ')}）`);
  await ctx.close();
}
{
  // 一次進來整間房子（DXF 匯入、貼上）：不是「畫完牆圍出第一間」，鏡頭不動
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: '2d' });
  await page.evaluate(() => { const v = window.__app.editor.vp; v.scale = 0.15; window.__app.editor.render(); });
  await page.evaluate(() => { const d = window.__app.doc; d.commit();
    const W = (id, a, b) => d.add({ id, kind: 'wall', layer: 'walls', a, b, thickness: 12, height: 280 });
    W('w1', { x: 0, y: 0 }, { x: 900, y: 0 }); W('w2', { x: 900, y: 0 }, { x: 900, y: 300 });
    W('w3', { x: 900, y: 300 }, { x: 0, y: 300 }); W('w4', { x: 0, y: 300 }, { x: 0, y: 0 }); W('w5', { x: 400, y: 0 }, { x: 400, y: 300 });
    d.add({ id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: '房間', auto: true }); });
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => window.__app.editor.vp.scale) === 0.15, '整批進來的牆圍出好幾間：第一間偵測到時鏡頭不動');
  await ctx.close();
}
{
  // 打開一份本來就有房間的方案：不動鏡頭
  const { ctx, page } = await open(`${BASE}/?perf=1&plan=plan1151022`, { plan: true, mode: '2d' });
  const v0 = await page.evaluate(() => window.__app.editor.vp.scale);
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => window.__app.editor.vp.scale) === v0, 'A1 打開時（本來就有房間）鏡頭不自己動');
  ok(!(await page.$('#startCard')), 'A1 沒有開場卡');
  // A1 全圖：標籤不疊
  await page.evaluate(() => document.querySelector('[data-act="fit"], #zoomFit')?.click());
  await page.waitForTimeout(400);
  let bs = await labelBoxes(page);
  let bad = overlapping(bs);
  ok(bs.length > 10 && !bad.length, `A1 全圖：畫了 ${bs.length} 個標籤，互相疊到的 ${bad.length} 對${bad.length ? '：' + bad.slice(0, 4).join(' / ') : ''}`);
  await page.screenshot({ path: `${OUT}polish-a1-labels.png` });
  const n0 = bs.length;
  await page.evaluate(() => { const v = window.__app.editor.vp; v.zoomAt({ x: v.width / 2, y: v.height / 2 }, 2.5); window.__app.editor.renderNow(); });
  bs = await labelBoxes(page); bad = overlapping(bs);
  ok(!bad.length, `A1 放大 2.5 倍：${bs.length} 個標籤，疊到的 ${bad.length} 對`);
  // 施工圖 PDF 不避讓：紙本不能放大，每道牆的長度都要在（審查第 2 條）
  const plot = await page.evaluate(async () => {
    const plot = await import('/src/core/plot.ts'), g = await import('/src/core/geometry.ts');
    const P = CanvasRenderingContext2D.prototype, orig = P.fillText, seen = [];
    const project = window.__app.doc.serialize(), extent = plot.projectExtent(project), sheet = plot.chooseSheet(extent.w, extent.h);
    P.fillText = function (...a) { seen.push(String(a[0])); return orig.apply(this, a); };
    try { plot.plotFloorCanvas(project, project.activeFloorId, sheet, extent); } finally { P.fillText = orig; }
    const objs = project.floors.find(f => f.id === project.activeFloorId).objects;
    const pool = [...seen], missing = [];
    for (const w of objs.filter(o => o.kind === 'wall')) { const s = g.fmtLen(g.dist(w.a, w.b)); const i = pool.indexOf(s); if (i < 0) missing.push(s); else pool.splice(i, 1); }
    return missing;
  });
  ok(!plot.length, `A1 施工圖：每道牆的長度都畫出來${plot.length ? '（少了 ' + plot.join(', ') + '）' : ''}`);
  ok(await page.evaluate(() => window.__app.doc.objects.length) === 180, 'A1 還是 180 件（只讀）');
  await ctx.close();
  void n0;
}

console.log('\nB24 小房間的標籤不疊在一起');
{
  const { ctx, page } = await open(`${BASE}/?perf=1`, { mode: '2d' });
  await page.evaluate(() => { const d = window.__app.doc; d.commit();
    const W = (id, a, b) => d.add({ id, kind: 'wall', layer: 'walls', a, b, thickness: 12, height: 280 });
    W('w1', { x: 0, y: 0 }, { x: 150, y: 0 }); W('w2', { x: 150, y: 0 }, { x: 150, y: 150 });
    W('w3', { x: 150, y: 150 }, { x: 0, y: 150 }); W('w4', { x: 0, y: 150 }, { x: 0, y: 0 });
    d.add({ id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 150, h: 150, name: '房間' });
    d.add({ id: 'f1', kind: 'furniture', layer: 'furniture', item: 'bed_single', x: 20, y: 20, w: 90, h: 120, angle: 0, label: '' });
    d.add({ id: 'f2', kind: 'furniture', layer: 'furniture', item: 'nightstand', x: 112, y: 20, w: 35, h: 35, angle: 0, label: '' }); });
  await page.waitForTimeout(700);   // 第一間房的拉近做完
  const at = async (scale) => { await page.evaluate((s) => { const v = window.__app.editor.vp; v.scale = s; v.centerOn(0, 0, 150, 150); }, scale); return labelBoxes(page); };
  const lo = await at(0.6);
  ok(!overlapping(lo).length && lo.some(b => b.s === '臥室'), `1.5×1.5 m 放床與床頭櫃，縮小時：${lo.map(b => b.s).join(' / ')}，沒有疊到的`);
  await page.screenshot({ path: `${OUT}polish-small-room.png` });
  // 每個縮放都要有房名、缺、面積三行（審查：浮點把 18 px 算成 17.99999 時會掉一行）
  await page.evaluate(() => window.__app.doc.update('r1', { w: 400, h: 300 }));
  const dropped = [];
  for (let k = 0; k < 40; k++) {
    const s = 0.3 + k * 0.04;
    const t = (await at(s)).map(b => b.s);
    if (!(t.includes('臥室') && t.some(x => x.startsWith('缺：')) && t.some(x => x.endsWith('m²')))) dropped.push(s.toFixed(2));
  }
  ok(!dropped.length, `房間 4×3 m、縮放 0.30～1.86 掃 40 個：房名／缺／面積三行都在${dropped.length ? '（掉行：' + dropped.join(', ') + '）' : ''}`);
  await page.evaluate(() => window.__app.doc.update('r1', { w: 150, h: 150 }));
  const hi = await at(4);
  ok(!overlapping(hi).length && hi.length > lo.length, `放大到 4 倍：標籤變多（${lo.length} → ${hi.length}）、仍不疊`);
  // 選取中的優先：選了牆，它的長度蓋過房名
  await page.evaluate(() => window.__app.doc.select('w1'));
  await page.evaluate(() => { const v = window.__app.editor.vp; v.scale = 0.6; v.centerOn(0, 0, 150, 150); });
  // 縮到 0.3：房名、缺、面積把整間房蓋滿，牆長本來擠不進去
  const wallAt = async () => { const [mx, my] = await page.evaluate(() => { const v = window.__app.editor.vp, p = v.toScreen({ x: 75, y: 0 }); return [p.x, p.y]; });
    return (await labelBoxes(page)).filter(b => /1\.50/.test(b.s) && Math.abs(b.x + b.w / 2 - mx) < 1 && Math.abs(b.y + 9 - my) < 1); };
  await page.evaluate(() => { window.__app.doc.select(null); const v = window.__app.editor.vp; v.scale = 0.3; v.centerOn(0, 0, 150, 150); });
  const unsel = await wallAt();
  await page.evaluate(() => window.__app.doc.select('w1'));
  const sel = await labelBoxes(page), selWall = await wallAt();
  ok(!unsel.length && selWall.length === 1 && !overlapping(sel).length,
    `縮小到 0.3：沒選時上牆長度讓給房間的字，選了那道牆它就畫出來（${sel.map(b => b.s).join(' / ')}）`);
  await ctx.close();
}

ok(!errs.length, `沒有頁面錯誤${errs.length ? '：' + errs.join(' / ') : ''}`);
await br.close();
console.log(fails ? `\n✘ ${fails} 項沒過` : '\n✔ 全部通過');
process.exit(fails ? 1 : 0);
