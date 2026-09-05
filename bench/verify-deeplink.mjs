// ?plan=<id> against the real backend.
//
// Deep-linking cannot be unit tested: the whole feature is "the URL the browser
// was given reaches loadProject and the result lands in the document", and every
// part of that is wiring. The failure is silent — a blank plan, which is exactly
// what the app shows when you open it normally.
//
// Needs the dev server on :5180 (npm run dev) and the backend on :8791.
//
//   node bench/verify-deeplink.mjs [base-url] [plan-id]
//
// 不要在這裡寫死方案的內容。第一版斷言「名字含 IMG_9720、天花板 300、有一間叫
// 主臥室」——那份圖後來被刪掉了，於是這支永遠回報 6 項失敗，而一個永遠失敗的
// 驗證等於沒有驗證。現在改成先跟後端要同一份，再比對 App 載進來的是不是它：
// 這才是這個功能要驗的事——「網址要的東西有沒有落進文件」——而且方案改了、
// 換了、刪了都不會讓它說謊。
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const API = process.argv[4] ?? 'http://localhost:8791';
const PLAN = process.argv[3] ?? 'img0199';

const res = await fetch(`${API}/api/projects/${PLAN}`);
if (!res.ok) {
  console.error(`找不到方案 ${PLAN}（HTTP ${res.status}）—— 傳一個存在的 id 進來，`
    + `或先確認後端在 ${API}`);
  process.exit(2);
}
const stored = await res.json();
const want = {
  name: stored.name,
  height: stored.data.floors[0].height,
  walls: stored.data.floors[0].objects.filter((o) => o.kind === 'wall').length,
  rooms: stored.data.floors[0].objects.filter((o) => o.kind === 'room').map((r) => r.name),
};
console.log(`對照 ${PLAN}：${want.name}，牆 ${want.walls} 道、房 ${want.rooms.length} 間、天花板 ${want.height}cm\n`);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1500, height: 900 } });
await page.addInitScript(() => {
  // Benches are not testing onboarding, and the first-run tour would eat the
  // first Escape (its capture listener) and cover the app with an overlay.
  try { localStorage.setItem('interior_tour_seen', '1'); } catch { /* ignore */ }
});

const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).split('\n')[0]));
// The unknown-plan case deliberately asks for a 404, so that one is expected.
let expect404 = false;
page.on('console', (m) => {
  const txt = m.text();
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  if (expect404 && txt.includes('404')) return;
  errs.push(m.type() + ': ' + txt.slice(0, 200));
});

let fails = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${n}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

await page.goto(`${BASE}/?perf=1&plan=${PLAN}`);
await page.waitForTimeout(4000);

const got = await page.evaluate(() => {
  const doc = window.__app.doc;
  const rooms = doc.objects.filter((o) => o.kind === 'room');
  return {
    name: doc.project.name,
    height: doc.activeFloor.height,
    walls: doc.objects.filter((o) => o.kind === 'wall').length,
    rooms: rooms.length,
    rooms: rooms.map((r) => r.name),
    field: document.getElementById('projectName')?.value,
  };
});
check('牆的數量對得上', got.walls === want.walls, `${got.walls} / ${want.walls}`);
check('載到的是同一份', got.name === want.name, `${got.name} / ${want.name}`);
check('天花板高度對得上', got.height === want.height, `${got.height} / ${want.height}`);
check('房間名字對得上', got.rooms.length === want.rooms.length
  && want.rooms.every((n) => got.rooms.includes(n)), got.rooms.join('/'));
check('標題欄跟著更新', got.field === want.name, got.field);

// 不存在的 id 不能靜靜地開一張空白圖
expect404 = true;
await page.goto(`${BASE}/?perf=1&plan=沒這個方案`);
await page.waitForTimeout(1500);
const bad = await page.evaluate(() => ({
  walls: window.__app.doc.objects.filter((o) => o.kind === 'wall').length,
  toast: document.body.innerText.includes('找不到方案'),
}));
check('不存在的 id 會說找不到', bad.toast, `walls=${bad.walls}`);
// 而且訊息要留著 —— flash 是 1.2 秒就消失的，那對「你正看著一張空白圖」
// 這種失敗不夠用。
await page.waitForTimeout(3000);
check('訊息不會自己消失', await page.evaluate(() => document.body.innerText.includes('找不到方案')));

check('全程沒有例外', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
await b.close();
process.exit(fails ? 1 : 0);
