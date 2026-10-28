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
  d.add({ id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 300, name: '房間' }); });
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

ok(!errs.length, `沒有頁面錯誤${errs.length ? '：' + errs.join(' / ') : ''}`);
await br.close();
console.log(fails ? `\n✘ ${fails} 項沒過` : '\n✔ 全部通過');
process.exit(fails ? 1 : 0);
