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
  W('w3', { x: 400, y: 300 }, { x: 0, y: 300 }); W('w4', { x: 0, y: 300 }, { x: 0, y: 0 }); });

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

ok(!errs.length, `沒有頁面錯誤${errs.length ? '：' + errs.join(' / ') : ''}`);
await br.close();
console.log(fails ? `\n✘ ${fails} 項沒過` : '\n✔ 全部通過');
process.exit(fails ? 1 : 0);
