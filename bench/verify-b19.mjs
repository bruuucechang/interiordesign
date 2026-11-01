// B19 驗收：行走模式（docs/spec-game-mode.md 第三節）。
//
//   node bench/verify-b19.mjs            # 要先 npm run dev（:5180）；--swiftshader 給沒有 GPU 的機器
//
// 在 plan1151022 裡：（行走時的按鍵一律按真的鍵，分割畫面另外測一次）找一扇兩邊各是一間房的門，從一邊對著門走過去要走到另一間；
// 對著一面沒有門窗的牆走 3 秒不能穿過；按 F 進出、按住 W 真的會走；不鎖滑鼠、拖曳轉頭、Esc 一次離開。截圖 bench/results/b19-*.png。

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5180';
const OUT = new URL('./results/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, info = '') => { if (!ok) bad++; console.log(`${ok ? '✔' : '✖'} ${name}${info ? '  ' + info : ''}`); };

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
await page.waitForFunction(() => window.__app?.doc.objects.length > 0 && window.__app.view3d?.walk, null, { timeout: 400000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);

// 純走路（不靠畫格）：直接叫 walk.frame，dt 0.05，W 按著
const walkFor = (seconds, keys = ['w']) => page.evaluate(([s, keys]) => {
  const w = window.__app.view3d.walk, set = new Set(keys);
  for (let t = 0; t < s; t += 0.05) w.frame(0.05, set);
  return w.state;
}, [seconds, keys]);
const standAt = (x, y, dx, dy) => page.evaluate(([x, y, dx, dy]) => {
  const v = window.__app.view3d;
  if (v.walk.active) v.setWalking(false);
  v.controls.target.set(x, 0, y);
  v.setWalking(true);
  // B21：進入行走會挑房間裡最空的點站（walkSpawn），這裡要的是指定位置，直接放過去。
  v.walk.walker = { ...v.walk.walker, x, y };
  v.walk.yaw = Math.atan2(-dx, -dy);   // face plan direction (dx, dy)
  v.walk.frame(0, new Set());
  return v.walk.state;
}, [x, y, dx, dy]);

// 一扇兩邊都是房間的門
const pick = await page.evaluate(() => {
  const objs = window.__app.doc.objects;
  const rooms = objs.filter((o) => o.kind === 'room' && o.poly);
  const inPoly = (p, x, y) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i].y > y) !== (p[j].y > y) && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) c = !c; } return c; };
  const roomAt = (x, y) => rooms.find((r) => inPoly(r.poly, x, y));
  for (const d of objs.filter((o) => o.kind === 'door' && o.width >= 70)) {
    const a = d.angle * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a);
    const A = roomAt(d.x + nx * 60, d.y + ny * 60), B = roomAt(d.x - nx * 60, d.y - ny * 60);
    if (A && B && A !== B) return { x: d.x, y: d.y, nx, ny, from: B.name, to: A.name, toPoly: A.poly, width: d.width };
  }
  return null;
});
check('找到兩邊都是房間的門', !!pick, pick ? `${pick.from} → ${pick.to}（寬 ${pick.width}）` : '');
if (pick) {
  await standAt(pick.x - pick.nx * 120, pick.y - pick.ny * 120, pick.nx, pick.ny);
  const s = await walkFor(2.5);
  const inside = await page.evaluate(([p, x, y]) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i].y > y) !== (p[j].y > y) && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) c = !c; } return c; }, [pick.toPoly, s.x, s.y]);
  check('穿過門走進另一間', inside, `(${Math.round(s.x)}, ${Math.round(s.y)})`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + 'b19-through-door.png' });
}

// 一面沒有門窗的長牆：站在它前面 100 cm 對著走 3 秒
const wall = await page.evaluate(() => {
  const objs = window.__app.doc.objects;
  const ops = objs.filter((o) => o.kind === 'door' || o.kind === 'window');
  const rooms = objs.filter((o) => o.kind === 'room' && o.poly);
  const inPoly = (p, x, y) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i].y > y) !== (p[j].y > y) && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) c = !c; } return c; };
  for (const w of objs.filter((o) => o.kind === 'wall' && !o.bulge)) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (len < 250) continue;
    const ux = (w.b.x - w.a.x) / len, uy = (w.b.y - w.a.y) / len;
    if (ops.some((o) => { const t = (o.x - w.a.x) * ux + (o.y - w.a.y) * uy; const d = Math.abs((o.x - w.a.x) * -uy + (o.y - w.a.y) * ux); return d < 30 && t > -50 && t < len + 50; })) continue;
    const mx = (w.a.x + w.b.x) / 2, my = (w.a.y + w.b.y) / 2;
    for (const s of [1, -1]) {
      const nx = -uy * s, ny = ux * s, sx = mx + nx * 100, sy = my + ny * 100;
      if (rooms.some((r) => inPoly(r.poly, sx, sy))) return { sx, sy, dx: -nx, dy: -ny, mx, my, half: w.thickness / 2 };
    }
  }
  return null;
});
check('找到一面沒有門窗的牆', !!wall);
if (wall) {
  await standAt(wall.sx, wall.sy, wall.dx, wall.dy);
  const s = await walkFor(3);
  const ahead = (s.x - wall.mx) * -wall.dx + (s.y - wall.my) * -wall.dy;   // signed distance on the near side
  check('對著牆走 3 秒穿不過去', ahead >= 25 + wall.half - 0.5, `離牆中線 ${ahead.toFixed(1)} cm`);
  const run = await walkFor(0.5, ['w', 'up']);
  check('跑也穿不過去', (run.x - wall.mx) * -wall.dx + (run.y - wall.my) * -wall.dy >= 25 + wall.half - 0.5);
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + 'b19-at-wall.png' });
}

// 真的鍵盤：F 進出、按住 W 會走
await page.evaluate(() => { const v = window.__app.view3d; if (v.walk.active) v.setWalking(false); document.activeElement?.blur?.(); v.setFly(true); });
await page.keyboard.press('f');
check('按 F 進入行走', await page.evaluate(() => window.__app.view3d.walk.active));
check('行走鈕亮起', await page.evaluate(() => document.getElementById('walkToggle').classList.contains('on')));
const eye = await page.evaluate(() => window.__app.view3d.camera.position.y);
check('眼睛高度 160 cm', Math.abs(eye - 160) < 0.5, `${eye}`);
const p0 = await page.evaluate(() => window.__app.view3d.walk.state);
await page.keyboard.down('w');
await page.waitForTimeout(1500);
await page.keyboard.up('w');
const p1 = await page.evaluate(() => window.__app.view3d.walk.state);
check('按住 W 會走', Math.hypot(p1.x - p0.x, p1.y - p0.y) > 50, `${Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y))} cm`);
check('2D 標出你的位置', await page.evaluate(() => typeof window.__app.editor.marker === 'function'));
await page.keyboard.press('f');
check('再按 F 離開', await page.evaluate(() => !window.__app.view3d.walk.active));
check('離開後 2D 標記收掉', await page.evaluate(() => window.__app.editor.marker === undefined));

// 審查補：行走中選了家具工具、點畫面不能放出家具
const n0 = await page.evaluate(() => window.__app.doc.objects.length);
await page.evaluate(() => { const { editor, view3d: v } = window.__app; editor.currentFurniture = 'sofa'; editor.selectTool('furniture'); v.setWalking(true); });
const box = await page.locator('#view3d canvas').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
check('行走中點畫面不會放出家具', await page.evaluate((n) => window.__app.doc.objects.length === n, n0));
// 2026-11-01：不鎖滑鼠（鎖住就到不了分頁列、別的視窗）；按住左鍵拖曳轉頭；Esc 按一次就離開
check('點畫面不會鎖住滑鼠', await page.evaluate(() => document.pointerLockElement === null));
const yaw0 = await page.evaluate(() => window.__app.view3d.walk.yaw);
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
const yaw1 = await page.evaluate(() => window.__app.view3d.walk.yaw);
check('按住拖曳會轉頭', Math.abs(yaw1 - yaw0) > 0.2, `${(Math.abs(yaw1 - yaw0) * 180 / Math.PI).toFixed(1)}°`);
await page.mouse.move(box.x + box.width / 2 - 300, box.y + box.height / 2, { steps: 8 });
check('沒按住時移動滑鼠不會轉頭', await page.evaluate((y) => window.__app.view3d.walk.yaw === y, yaw1));
await page.keyboard.press('Escape');
check('Esc 按一次就離開行走', await page.evaluate(() => !window.__app.view3d.walk.active));
await page.evaluate(() => window.__app.view3d.setWalking(true));
await page.evaluate(() => window.__app.editor.selectTool('select'));
// 切回 2D：自動離開行走、2D 標記收掉
await page.evaluate(() => document.querySelector('#viewModes [data-mode="2d"]').click());
await page.waitForTimeout(500);
check('切到 2D 自動離開行走', await page.evaluate(() => !window.__app.view3d.walk.active && window.__app.editor.marker === undefined));

// 2026-11-02：之前的「按鍵」都是直接呼叫 walk.frame()，跳過鍵盤事件那段，下面三項一直沒被抓到。
// 這裡一律按真的鍵。
await page.evaluate(() => document.querySelector('#viewModes [data-mode="3d"]').click());
await page.waitForTimeout(800);
await page.evaluate(() => { document.activeElement?.blur?.(); });
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const furn = await page.evaluate(() => { const a = window.__app; const f = a.doc.objects.find((o) => o.kind === 'furniture'); a.doc.select(f.id); return { id: f.id, angle: f.angle }; });
await page.keyboard.press('f');
const held = async (key, ms) => { const a = await page.evaluate(() => window.__app.view3d.walk.state); await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); const b = await page.evaluate(() => window.__app.view3d.walk.state); return { moved: Math.hypot(b.x - a.x, b.y - a.y), turned: (b.yaw - a.yaw) * 180 / Math.PI }; };
const up = await held('ArrowUp', 800);
check('行走時按住 ↑ 會往前走', up.moved > 40, `${Math.round(up.moved)} cm`);
const left = await held('ArrowLeft', 800);
check('行走時按住 ← 原地轉身', left.turned > 20 && left.moved < 1, `${left.turned.toFixed(0)}°、移動 ${left.moved.toFixed(1)} cm`);
await page.keyboard.press('e'); await page.keyboard.press('q'); await page.keyboard.press('e');
check('行走時 Q／E 不會轉到選著的家具', await page.evaluate(([id, a]) => window.__app.doc.objects.find((o) => o.id === id).angle === a, [furn.id, furn.angle]));
await page.keyboard.press('Delete'); await page.keyboard.press('Backspace');
check('行走時 Delete／Backspace 不會刪掉選著的家具', await page.evaluate((id) => window.__app.doc.objects.some((o) => o.id === id), furn.id));
await page.keyboard.press('Escape');

// 分割畫面：滑鼠在 2D 那半邊時，行走照樣拿鍵盤（看 2D 上的位置標記就得把滑鼠移過去）
await page.evaluate(() => document.querySelector('#viewModes [data-mode="split"]').click());
await page.waitForTimeout(1500);
const p2d = await page.locator('#pane2d').boundingBox();
await page.mouse.move(p2d.x + p2d.width / 2, p2d.y + p2d.height / 2);
await page.click('#walkToggle');
await page.mouse.move(p2d.x + p2d.width / 2 + 5, p2d.y + p2d.height / 2 + 5);
check('分割畫面按行走鈕進入', await page.evaluate(() => window.__app.view3d.walk.active));
const o0 = await page.evaluate(() => ({ ...window.__app.editor.vp.origin }));
const sw = await held('w', 800);
const o1 = await page.evaluate(() => ({ ...window.__app.editor.vp.origin }));
check('分割畫面、滑鼠在 2D：按住 W 會走', sw.moved > 40, `${Math.round(sw.moved)} cm`);
check('分割畫面、滑鼠在 2D：W 不會捲動平面圖', o0.x === o1.x && o0.y === o1.y, `位移 ${Math.round(o1.x - o0.x)}, ${Math.round(o1.y - o0.y)}`);
await page.keyboard.press('Escape');
check('分割畫面、滑鼠在 2D：Esc 離開行走', await page.evaluate(() => !window.__app.view3d.walk.active));
const o2 = await page.evaluate(() => ({ ...window.__app.editor.vp.origin }));
await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w');
const o3 = await page.evaluate(() => ({ ...window.__app.editor.vp.origin }));
check('離開行走後 W 回到捲動平面圖', o2.x !== o3.x || o2.y !== o3.y);

check('沒有頁面錯誤', errs.length === 0, errs.join(' | '));
await br.close();
process.exit(bad ? 1 : 0);
