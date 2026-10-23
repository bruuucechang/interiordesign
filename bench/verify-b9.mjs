// B9：外觀小修（U5～U8，見 docs/review-2026-10.md）。四處各截一張圖，另外量得到的就量。
//
//   U5  3D 底部：提示與鍵帽不重疊；開照度面板時兩者都落在面板左邊、置中於可見區
//   U6  房名標籤畫在燈下面（截圖目視）
//   U7  1280 寬滑鼠移到方案名稱上，title 是全名
//   U8  懸空牆端有封口細線（截圖目視）
//
// 需要 npm run dev（:5180 + :8791）。只讀 plan1151022：所有寫入請求一律攔掉。
//
//   node bench/verify-b9.mjs [base-url] [plan-id]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const PLAN = process.argv[3] ?? 'plan1151022';
const OUT = new URL('./results/', import.meta.url).pathname;
const OWNER = 'own_orsxp52fbvey';

const b = await chromium.launch({ timeout: 120000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fails = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${n}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const errs = [];

async function open(width) {
  const page = await b.newPage({ viewport: { width, height: 950 } });
  await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
  await page.addInitScript(([mode, owner]) => {
    try {
      localStorage.setItem('interior_tour_seen', '1');
      localStorage.setItem('interior_view_mode', mode);
      localStorage.setItem('interior_lang', 'zh-Hant');
      localStorage.setItem('interior_owner', owner);
    } catch { /* ignore */ }
  }, ['2d', OWNER]);
  page.on('pageerror', (e) => errs.push(`${width}: pageerror: ` + String(e).split('\n')[0]));
  await page.goto(`${BASE}/?perf=1&plan=${PLAN}`);
  await page.waitForFunction((id) => window.__app?.doc.project.id === id && window.__app.doc.objects.length > 0, PLAN, { timeout: 30000 });
  await page.waitForTimeout(2500);
  return page;
}

// ---------------------------------------------------------------- U5
console.log('U5 3D 底部提示');
for (const w of [1280, 1500, 1920]) {
  // 2D 載入完再切 3D：直接以 3D 開，swiftshader 在 CPU 上畫空場景會把主執行緒塞滿，
  // 方案的 GET 回來了卻一直輪不到套用（量到 manifest 一支要 13 秒），畫面停在空白方案。
  const page = await open(w);
  await page.evaluate(() => document.querySelector('#viewModes [data-mode="3d"]').click());
  await page.waitForTimeout(6000);
  for (const lighting of [false, true]) {
    if (lighting) { await page.evaluate(() => document.querySelector('[data-act="lighting"]').click()); await page.waitForTimeout(3000); }
    const m = await page.evaluate(() => {
      const r = (el) => el && el.getBoundingClientRect();
      const hint = r(document.getElementById('hint3d')), hud = r(document.querySelector('.key-hud'));
      const pane = r(document.getElementById('view3d'));
      const lp = document.getElementById('lightPanel');
      const panelLeft = lp.classList.contains('hidden') ? pane.right : Math.min(pane.right, lp.getBoundingClientRect().left);
      return { hint: hint && { l: hint.left, r: hint.right, t: hint.top, b: hint.bottom }, hud: hud && { l: hud.left, r: hud.right, t: hud.top, b: hud.bottom }, pl: pane.left, vr: panelLeft };
    });
    const { hint, hud } = m;
    const overlap = hint && hud && !(hint.b <= hud.t || hud.b <= hint.t || hint.r <= hud.l || hud.r <= hint.l);
    const inside = hint && hud && hint.l >= m.pl && hint.r <= m.vr && hud.l >= m.pl && hud.r <= m.vr;
    const mid = (m.pl + m.vr) / 2, hudMid = hud && (hud.l + hud.r) / 2;
    const centred = hud && Math.abs(hudMid - mid) < 3;
    check(`${w} ${lighting ? '開照度' : '無面板'}`, !!hint && !!hud && !overlap && inside && centred,
      `重疊=${overlap} 在可見區=${inside} 鍵帽中心=${Math.round(hudMid)}／可見區中心=${Math.round(mid)}`);
    if (w !== 1280) await page.screenshot({ timeout: 120000, path: OUT + `b9-u5-3d-${w}${lighting ? '-lighting' : ''}.png` });
  }
  await page.close();
}

// ---------------------------------------------------------------- U7
console.log('U7 方案名稱');
{
  const page = await open(1280);
  await page.hover('#projectName');
  const m = await page.evaluate(() => { const el = document.getElementById('projectName'); return { v: el.value, t: el.title, cut: el.scrollWidth > el.clientWidth }; });
  check('1280 滑鼠移上去 title＝全名', m.t === m.v && m.v.length > 0, `「${m.t}」 被截=${m.cut}`);
  await page.screenshot({ path: OUT + 'b9-u7-name-1280.png', clip: { x: 0, y: 0, width: 640, height: 60 } });
  await page.close();
}

// ---------------------------------------------------------------- U6 / U8
// 找一間正中央有燈的房，和一個懸空的牆端，各自拉近截圖。
const page = await open(1500);
async function zoomTo(x, y, scale) {
  await page.evaluate(([x, y, scale]) => {
    const vp = window.__app.editor.vp;
    vp.scale = scale;
    vp.origin = { x: x - vp.width / 2 / scale, y: y - vp.height / 2 / scale };
    window.__app.editor.render();
  }, [x, y, scale]);
  await page.waitForTimeout(300);
}
// 燈搬到標籤正中央（只在頁面裡，寫入都攔掉了），房名與面積兩行的中間就是重疊最多的位置。
const u6 = await page.evaluate(() => {
  const objs = window.__app.doc.objects;
  const room = objs.find((o) => o.kind === 'room' && o.poly?.length >= 3);
  const light = objs.find((o) => o.kind === 'electrical' && /light/.test(o.item));
  if (!room || !light) return null;
  let a = 0, cx = 0, cy = 0;
  room.poly.forEach((p, i) => { const q = room.poly[(i + 1) % room.poly.length], c = p.x * q.y - q.x * p.y; a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c; });
  const c = { x: cx / (3 * a), y: cy / (3 * a) };
  light.x = c.x; light.y = c.y;
  return { name: room.name, x: c.x, y: c.y, light: light.item };
});
console.log('U6 房中央的燈', u6 ? `${u6.name}（${u6.light} 搬到標籤上）` : '這份方案沒有');
if (u6) { await zoomTo(u6.x, u6.y, 2.5); await page.screenshot({ path: OUT + 'b9-u6-room-light.png' }); }

// 反例：房名落在床上的那間（審查找到的），房名要壓在家具上面、不能被床蓋掉。
const bedRoom = await page.evaluate(() => {
  const r = window.__app.doc.objects.find((o) => o.kind === 'room' && /老媽/.test(o.name) && o.poly?.length >= 3);
  if (!r) return null;
  let a = 0, cx = 0, cy = 0;
  r.poly.forEach((p, i) => { const q = r.poly[(i + 1) % r.poly.length], c = p.x * q.y - q.x * p.y; a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c; });
  return { x: cx / (3 * a), y: cy / (3 * a) };
});
if (bedRoom) { await zoomTo(bedRoom.x, bedRoom.y, 2.5); await page.screenshot({ path: OUT + 'b9-u6-room-on-bed.png' }); }

const u8 = await page.evaluate(() => {
  const walls = window.__app.doc.objects.filter((o) => o.kind === 'wall');
  const key = (p) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
  const n = new Map();
  for (const w of walls) for (const p of [w.a, w.b]) n.set(key(p), (n.get(key(p)) ?? 0) + 1);
  const seg = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
  for (const w of walls) for (const p of [w.a, w.b]) {
    if (n.get(key(p)) > 1 || w.thickness >= 30 && Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y) <= 120) continue;
    if (walls.some((o) => o !== w && seg(p, o.a, o.b) <= o.thickness / 2 + 0.5)) continue;
    return { x: p.x, y: p.y, t: w.thickness };
  }
  return null;
});
console.log('U8 懸空牆端', u8 ? `(${Math.round(u8.x)}, ${Math.round(u8.y)}) 厚 ${u8.t}` : '這份方案沒有');
if (u8) { await zoomTo(u8.x, u8.y, 4); await page.screenshot({ path: OUT + 'b9-u8-wall-end.png' }); }
await page.close();

await b.close();
for (const e of errs) console.log('  ' + e);
check('沒有頁面錯誤', errs.length === 0, `${errs.length} 筆`);
console.log(fails ? `\n${fails} 項沒過` : '\n全過');
process.exit(fails ? 1 : 0);
