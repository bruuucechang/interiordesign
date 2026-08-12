// ?plan=<id> against the real backend.
//
// Deep-linking cannot be unit tested: the whole feature is "the URL the browser
// was given reaches loadProject and the result lands in the document", and every
// part of that is wiring. The failure is silent — a blank plan, which is exactly
// what the app shows when you open it normally.
//
// Needs the dev server on :5180 (npm run dev).
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1500, height: 900 } });
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

await page.goto(`${BASE}/?perf=1&plan=img9720`);
await page.waitForTimeout(4000);

const got = await page.evaluate(() => {
  const doc = window.__app.doc;
  const rooms = doc.objects.filter((o) => o.kind === 'room');
  return {
    name: doc.project.name,
    height: doc.activeFloor.height,
    walls: doc.objects.filter((o) => o.kind === 'wall').length,
    rooms: rooms.length,
    named: rooms.map((r) => r.name).filter((n) => n && n !== '房間').slice(0, 4),
    field: document.getElementById('projectName')?.value,
  };
});
check('方案有載入', got.walls > 0, JSON.stringify(got.walls) + ' 道牆');
check('是 A1 那一份', /IMG_9720/.test(got.name ?? ''), got.name);
check('天花板 300cm', got.height === 300, String(got.height));
check('房間名字在', got.named.includes('主臥室'), got.named.join('/'));
check('標題欄跟著更新', /IMG_9720/.test(got.field ?? ''), got.field);

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
