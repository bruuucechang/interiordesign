// Esc cancels — in every view, and from a field in two presses.
//
//   node bench/verify-esc.mjs [base-url] [plan-id]
//
// Not unit-testable: the whole behaviour is which listener sees the key first
// and which guards it has to get past. It regressed silently once already —
// `Escape` sat *after* the `inputEnabled` guard, so it worked in 2D and did
// nothing in 3D or split, which is precisely where you are when you have just
// placed something and want out of it.
//
// Needs the dev server on :5180 and the backend on :8791.
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const PLAN = process.argv[3] ?? 'img0199-gen';

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.addInitScript(() => {
  // Benches are not testing onboarding, and the first-run tour would eat the
  // first Escape (its capture listener) and cover the app with an overlay.
  try { localStorage.setItem('interior_tour_seen', '1'); } catch { /* ignore */ }
});

const errs = [];
p.on('pageerror', (e) => errs.push('例外: ' + String(e).split('\n')[0]));
await p.goto(`${BASE}/?plan=${PLAN}&perf=1`, { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);

let fails = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${n}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const selected = () => p.evaluate(() => window.__app.doc.selectedIds.length);
const pick = () => p.evaluate(() => {
  const o = window.__app.doc.objects.find((z) => z.kind === 'furniture')
    ?? window.__app.doc.objects[0];
  if (!o) throw new Error('這份方案沒有任何物件可以選');
  window.__app.doc.select(o.id);
});

const inView = async (name, mode) => {
  if (mode) { await p.click(`[data-mode="${mode}"]`, { timeout: 180000, force: true }); await p.waitForTimeout(mode === '3d' ? 9000 : 5000); }
  await pick();
  const before = await selected();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const after = await selected();
  check(`${name}：Esc 取消選取`, before > 0 && after === 0, `${before} → ${after}`);
};

await inView('2D 主檢視', null);
await inView('3D 主檢視', '3d');
await inView('分割檢視', 'split');

// 在欄位裡打字時，第一次 Esc 只離開欄位——因為你在改一個數字而按 Esc，並不代表
// 你想連選取一起丟掉。第二次才取消。
await p.click('[data-mode="2d"]', { timeout: 180000, force: true });
await p.waitForTimeout(2500);
await pick();
await p.waitForTimeout(600);
const focused = await p.evaluate(() => {
  const i = document.querySelector('input[type="number"], .props input, #properties input');
  if (!i) return false;
  i.focus(); return document.activeElement === i;
});
if (!focused) {
  check('焦點在屬性欄位裡', false, '找不到可聚焦的屬性欄位 —— 面板結構改過了');
} else {
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const midSel = await selected();
  const stillFocused = await p.evaluate(() => document.activeElement?.tagName === 'INPUT');
  check('欄位裡按 Esc：先離開欄位、選取還在', !stillFocused && midSel > 0, `focus=${stillFocused} sel=${midSel}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check('再按一次才取消選取', (await selected()) === 0);
}

check('全程沒有例外', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
await b.close();
process.exit(fails ? 1 : 0);
