// B13：屬性面板拿掉 `as any` 之後還改得動（S5，見 docs/review-2026-10.md）。
//
// 選牆、門、家具、T5、子區域各一個，改一個欄位，確認存檔物件真的變了，屬性面板截圖
// 到 bench/results/b13-<kind>.png 目視。報表 T5 分尺寸（S4）由 server/tests/test_report.py 驗。
//
// 需要 npm run dev（:5180 + :8791）。只讀 plan1151022：所有寫入請求一律攔掉。
//
//   node bench/verify-b13.mjs [base-url]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const PLAN = 'plan1151022';
const OWNER = 'own_orsxp52fbvey';
const OUT = new URL('./results/', import.meta.url).pathname;

let fails = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${n}${extra !== '' ? '  ' + extra : ''}`); if (!ok) fails++; };

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
await page.addInitScript((owner) => {
  try {
    localStorage.setItem('interior_tour_seen', '1');
    localStorage.setItem('interior_view_mode', '2d');
    localStorage.setItem('interior_lang', 'zh-Hant');
    localStorage.setItem('interior_unit', 'cm');
    localStorage.setItem('interior_owner', owner);
  } catch { /* ignore */ }
}, OWNER);
page.on('pageerror', (e) => { console.log('PAGEERROR', String(e).split('\n')[0]); fails++; });
await page.goto(`${BASE}/?perf=1&plan=${PLAN}`);
await page.waitForFunction((id) => window.__app?.doc.project.id === id && window.__app.doc.objects.length > 0, PLAN, { timeout: 30000 });
await page.waitForTimeout(1500);

/** Select the first object matching `kind` (and `item`), return its id. */
const selectFirst = (kind, item) => page.evaluate(([kind, item]) => {
  // The panel deliberately skips rebuilding while one of its inputs has focus.
  document.activeElement?.blur();
  const { doc } = window.__app;
  const o = doc.objects.find((x) => x.kind === kind && (!item || x.item === item));
  doc.select(o.id);
  return o.id;
}, [kind, item]);
const field = (id, key) => page.evaluate(([id, key]) => window.__app.doc.objects.find((x) => x.id === id)?.[key], [id, key]);
/** The input in the properties row whose label starts with `label`. */
const input = (label) => page.locator('#properties .prop', { has: page.locator('label', { hasText: label }) }).locator('input').first();

const cases = [
  { kind: 'wall', label: '厚度', key: 'thickness', value: 21 },
  { kind: 'door', label: '高度', key: 'height', value: 205 },
  { kind: 'furniture', label: '離地板距離', key: 'elevation', value: 7 },
  { kind: 'area', label: '照度目標', key: 'lux', value: 333 },
];
for (const c of cases) {
  const id = await selectFirst(c.kind);
  await page.waitForTimeout(300);
  await input(c.label).fill(String(c.value));
  await page.waitForTimeout(200);
  const got = await field(id, c.key);
  check(`${c.kind}：「${c.label}」改成 ${c.value}`, got === c.value, `→ ${c.key} = ${got}`);
  await page.locator('#properties').screenshot({ path: OUT + `b13-${c.kind}.png` });
}

{
  const id = await selectFirst('electrical', 'batten');
  await page.waitForTimeout(300);
  const before = await field(id, 'size');
  const want = before === 2 ? 3 : 2;
  await page.locator('#properties .mat-btn', { hasText: `${want} 尺` }).click();
  await page.waitForTimeout(200);
  const got = await field(id, 'size');
  check(`T5：長度按「${want} 尺」`, got === want, `${before ?? '未填'} → ${got}`);
  await input('流明').fill('1234');
  await page.waitForTimeout(200);
  check('T5：流明改成 1234', (await field(id, 'lumens')) === 1234);
  await page.locator('#properties').screenshot({ path: OUT + 'b13-batten.png' });
}

await b.close();
console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
