// B12：房間內的子區域（S3，見 docs/review-2026-10.md）。
//
//   1  plan1151022 照度面板的「客廳＋廚房」：玄關、走道、東側小廳、客廳、廚房五列排在最前面，
//      每列有平均、最暗、建議與「夠」——數字跟 scripts/report-b6.mts --db 對得上
//   2  點面板上的「廚房」那一列：選到那塊子區域，屬性面板寫「子區域」、名稱、照度目標
//   3  按「＋ 畫子區域」、在 Peter 房裡拖一個矩形：多一個子區域、工具回到平移、
//      Peter 房那張卡多一列「子區域」；畫在家具上面，家具照樣點得到
//
// 需要 npm run dev（:5180 + :8791）。只讀 plan1151022：所有寫入請求一律攔掉。
//
//   node bench/verify-b12.mjs [base-url]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const PLAN = 'plan1151022';
const OWNER = 'own_orsxp52fbvey';
const OUT = new URL('./results/', import.meta.url).pathname;
// scripts/report-b6.mts --db 印出來的（區域取樣 10 cm、全部迴路開、中間色牆面）
const EXPECT = [['玄關', 170], ['走道（臥室門前）', 210], ['東側小廳', 172], ['客廳', 232], ['廚房', 413]];

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
    localStorage.setItem('interior_owner', owner);
    localStorage.removeItem('interior_lighting_view');
  } catch { /* ignore */ }
}, OWNER);
page.on('pageerror', (e) => { console.log('PAGEERROR', String(e).split('\n')[0]); fails++; });
await page.goto(`${BASE}/?perf=1&plan=${PLAN}`);
await page.waitForFunction((id) => window.__app?.doc.project.id === id && window.__app.doc.objects.length > 0, PLAN, { timeout: 30000 });
await page.waitForTimeout(2000);
await page.click('[data-act="lighting"]');
await page.waitForTimeout(1500);

const roomBox = (name) => page.locator('#lightRooms .lp-room', { has: page.locator('.lp-room-head b', { hasText: name }) });

// ---------------------------------------------------------------- 1
console.log('1 面板逐塊列');
{
  const box = roomBox('客廳＋廚房');
  await box.click();
  await page.waitForTimeout(1200);
  const rows = await box.locator('table.zones tbody tr').evaluateAll((trs) => trs.map((tr) =>
    [...tr.cells].map((td, i) => (i === 4 ? td.firstElementChild?.className ?? '' : td.textContent))));
  for (const [i, [name, want]] of EXPECT.entries()) {
    const r = rows[i] ?? [];
    const avg = Number(String(r[1]).replace(/,/g, ''));
    check(`第 ${i + 1} 列是「${name}」、平均 ≈ ${want}、夠`, r[0] === name && Math.abs(avg - want) <= 2 && /\bok\b/.test(r[4]),
      r.length ? `${r[0]}｜${r[1]}｜${r[2]}｜${r[3]}｜${r[4]}` : '沒有這一列');
  }
  await page.screenshot({ path: OUT + 'b12-living.png' });
  await box.screenshot({ path: OUT + 'b12-living-panel.png' });
}

// ---------------------------------------------------------------- 2
console.log('2 點列選到子區域');
{
  const box = roomBox('客廳＋廚房');
  await box.locator('table.zones tbody tr', { hasText: '廚房' }).first().click();
  await page.waitForTimeout(600);
  const prop = await page.evaluate(() => ({
    type: document.querySelector('.prop-type')?.textContent,
    name: [...document.querySelectorAll('.prop')].find((p) => p.querySelector('label')?.textContent === '名稱')?.querySelector('input')?.value,
    lux: [...document.querySelectorAll('.prop')].find((p) => /照度目標/.test(p.querySelector('label')?.textContent ?? ''))?.querySelector('input')?.value,
  }));
  check('屬性面板是子區域「廚房」、目標 150', prop.type === '子區域' && prop.name === '廚房' && prop.lux === '150', JSON.stringify(prop));
  await page.screenshot({ path: OUT + 'b12-select.png' });
}

// ---------------------------------------------------------------- 3
console.log('3 畫一塊新的子區域');
{
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => window.__app.doc.objects.filter((o) => o.kind === 'area').length);
  await page.click('[data-act="draw-area"]');
  const tool = await page.evaluate(() => window.__app.editor.toolName);
  check('按鈕切到畫子區域', tool === 'area', tool);
  // Peter 房的床頭櫃那一帶：世界座標 → 畫布上的螢幕座標
  const at = (x, y) => page.evaluate(([x, y]) => {
    const s = window.__app.editor.vp.toScreen({ x, y }), r = document.getElementById('canvas').getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, [x, y]);
  const a = await at(20, 150), z = await at(200, 300);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps: 4 });
  await page.mouse.move(z.x, z.y, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({
    n: window.__app.doc.objects.filter((o) => o.kind === 'area').length,
    tool: window.__app.editor.toolName,
    type: document.querySelector('.prop-type')?.textContent,
  }));
  check('多一塊子區域、回到平移、屬性面板開著它', after.n === before + 1 && after.tool === 'select' && after.type === '子區域', JSON.stringify(after));
  const box = roomBox('Peter 房間');
  await box.click();
  await page.waitForTimeout(1200);
  const first = await box.locator('table.zones tbody tr').first().evaluate((tr) => [...tr.cells].map((td) => td.textContent));
  check('Peter 房間第一列是新畫的子區域、有數字', first[0] === '子區域' && Number(first[1]) > 0, first.join('｜'));
  await page.screenshot({ path: OUT + 'b12-drawn.png' });
  // 床（b6_peter_bed）就在新子區域裡面，點它要選到床，不是子區域
  await page.keyboard.press('Escape');
  const bed = await page.evaluate(() => window.__app.doc.objects.find((o) => o.id === 'b6_peter_bed'));
  const p = await at(bed.x + bed.w / 2, bed.y + bed.h / 2);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => document.querySelector('.prop-type')?.textContent);
  check('子區域裡的床照樣點得到', t === '家具', t);
}

await b.close();
console.log(`截圖：${OUT}b12-*.png`);
process.exit(fails ? 1 : 0);
