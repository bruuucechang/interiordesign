// B6 驗收：plan1151022 全屋排燈之後，App 打開照度圖層長什麼樣。
// 要開著 `npm run dev`，並先跑過 `node scripts/furnish-b6.mjs --save`。
//
//   node bench/verify-b6.mjs     → bench/results/b6-house.png、b6-<房間>.png、b6-<房間>-panel.png
//
// 讀面板上 B6 六個空間的整間平均，跟 scripts/report-b6.mts --db 印的對：
// 面板跟腳本走同一條路，差就代表介面那層沒接對。也數面板上的提醒：B6 的房間要是 0。

import { chromium } from 'playwright';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'bench/results');
const OWNER = 'own_orsxp52fbvey';
// report-b6.mts --db 的整間平均（四捨五入到整數，所以容許 ±1.5）。
const EXPECT = {
  'Peter 房間': ['peter', 229], '客廳＋廚房': ['living', 247], '老爸房間': ['dad', 215],
  '衛浴 A': ['batha', 183], '衛浴 B': ['bathb', 183], '陽台': ['balcony', 108],
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
// 全屋：視窗開寬，讓整層落在照度面板左邊。
await page.setViewportSize({ width: 2400, height: 1300 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'b6-house.png') });
await page.setViewportSize({ width: 1500, height: 1000 });
await page.waitForTimeout(800);

for (const [name, [key, avgWant]] of Object.entries(EXPECT)) {
  const box = page.locator('#lightRooms .lp-room', { has: page.locator('.lp-room-head b', { hasText: name }) });
  await box.click();
  await page.waitForTimeout(800);
  const avg = Number((await box.locator('.lp-stat b').first().textContent()).replace(/,/g, ''));
  check(`${name} 整間平均`, Math.abs(avg - avgWant) <= 1.5, `${avg}（腳本 ${avgWant}）`);
  const pills = await box.locator('.lp-pill').evaluateAll(ps => ps.map(p => p.className));
  check(`${name} 區域全部「夠」`, pills.length > 0 && pills.every(c => /\bok\b/.test(c)), `${pills.length} 個區域`);
  const warns = await box.locator('.lp-warns li', { hasNotText: '沒有發現問題' }).count();
  check(`${name} 沒有提醒`, warns === 0, warns);
  await page.screenshot({ path: join(OUT, `b6-${key}.png`) });
  await box.screenshot({ path: join(OUT, `b6-${key}-panel.png`) });
}
await browser.close();
console.log(`截圖：${OUT}/b6-*.png`);
process.exit(bad ? 1 : 0);
