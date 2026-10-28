// B5 驗收：plan1151022 的兩間臥室（照原型佈置）在 App 裡打開照度圖層長什麼樣。
// 要開著 `npm run dev`，並先跑過 `node scripts/furnish-b5.mjs --save`。
//
//   node bench/verify-b5.mjs     → bench/results/b5-{bruce,mum}.png、b5-{bruce,mum}-panel.png
//
// 讀面板上兩間的整間平均與區域表，跟 scripts/compare-b5.mts 算的同一份數字對：
// 面板跟腳本走的是同一條路，差就代表介面那層沒接對。

import { chromium } from 'playwright';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'bench/results');
const OWNER = 'own_orsxp52fbvey';
// compare-b5.mts 的 App 欄（內縮到牆面之後）。
const EXPECT = {
  // B11 挪了三盞崁燈（D1＋D3），之前是 276.8／282.9／282.3／277.4／271.5／151.6。
  'Bruce 房間': { avg: 279.3, zones: { '床（床面）': 282.9, '書桌桌面': 284.5, '衣櫃前': 282.4, '櫃子前': 273.9, '門口': 154.2 } },
  '老媽房間': { avg: 231.5, zones: { '床（床面）': 261.7, '櫃子前': 233.4, '衣櫃前': 232.4, '門口 1': 133.5, '門口 2': 230.7 } },
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.addInitScript((owner) => {
  try {
    localStorage.setItem('interior_tour_seen', '1');
    localStorage.setItem('interior_view_mode', '2d');
    localStorage.setItem('interior_lang', 'zh-Hant');
    localStorage.setItem('interior_owner', owner);
    localStorage.removeItem('interior_lighting_view');
  } catch { /* ignore */ }
}, OWNER);
let bad = 0;
page.on('pageerror', (e) => { console.error('PAGEERROR', String(e).split('\n')[0]); bad++; });
const check = (name, ok, got = '') => { console.log(`${ok ? '✔' : '✘'} ${name}${got !== '' ? `：${got}` : ''}`); if (!ok) bad++; };

await page.goto('http://localhost:5180/?plan=plan1151022');
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());   // B20：在「檢視」選單裡
await page.waitForTimeout(1500);

for (const [name, want] of Object.entries(EXPECT)) {
  const box = page.locator('#lightRooms .lp-room', { has: page.locator('.lp-room-head b', { hasText: name }) });
  await box.click();
  await page.waitForTimeout(800);
  const avg = Number((await box.locator('.lp-stat b').first().textContent()).replace(/,/g, ''));
  check(`${name} 整間平均`, Math.abs(avg - want.avg) <= 1, `${avg}（腳本 ${want.avg}）`);
  const rows = await box.locator('.lp-tbl.zones tbody tr').evaluateAll(trs => trs.map(tr => [...tr.cells].map(td => td.textContent)));
  for (const [z, v] of Object.entries(want.zones)) {
    const r = rows.find(r => r[0].startsWith(z));
    check(`${name} ${z}`, r && Math.abs(Number(r[1]) - v) <= 1, r ? `${r[1]}（腳本 ${v}）` : '面板上沒有這一列');
  }
  const key = name.startsWith('Bruce') ? 'bruce' : 'mum';
  await page.screenshot({ path: join(OUT, `b5-${key}.png`) });
  await box.screenshot({ path: join(OUT, `b5-${key}-panel.png`) });
}
await browser.close();
console.log(`截圖：${OUT}/b5-*.png`);
process.exit(bad ? 1 : 0);
