// 這個 App 在比作者自己的資料大一個數量級的圖上，還跑得動嗎？
//
//   node bench/scale.mjs [base-url]
//
// CLAUDE.md 寫過「真實資料規模：146 份存檔，最大的只有 13 個物件。物件數量不是效能
// 維度。」——那個結論的前提是**作者自己的資料**。一個真的案子是幾百個物件、多樓層，
// 而沒有人量過。這支就是去量。
//
// 量三條路徑，因為它們壞掉的方式完全不同：
//
//   2D 重繪        每幀都跑。超過 16.7ms 就是掉幀，使用者感覺得到「拖起來很重」
//   屬性面板重畫    每次**文件變動**都跑。這裡曾經是 324 道牆 48.8ms——每動一下掉三幀
//   3D 重建        切換檢視與改動時跑，一次性但會卡住主執行緒
//
// 第二條是這支腳本第一次跑就抓到的：`findFaceSteps` 比對每一對牆（O(n²)），而呼叫它
// 的面板在每一次文件變動時重建，包含絕大多數根本沒動到牆的變動。修法是照牆本身做
// memo，加上把列數上限訂在 12 並說出還有幾處。

import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const SIZES = [
  { walls: 27, furn: 12, label: '作者自己的圖' },
  { walls: 200, furn: 100, label: '一戶完整標註' },
  { walls: 600, furn: 300, label: '大一個數量級' },
  { walls: 1200, furn: 800, label: '再大一倍' },
];

/** 每幀 16.7ms 是 60fps 的預算；面板重畫沒有每幀，但超過一幀就看得出來。 */
const FRAME_MS = 16.7;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(() => {
  // Benches are not testing onboarding, and the first-run tour would eat the
  // first Escape (its capture listener) and cover the app with an overlay.
  try { localStorage.setItem('interior_tour_seen', '1'); } catch { /* ignore */ }
});

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__app, null, { timeout: 20000 });

// 心跳會在量測中途把測試資料寫進資料庫，而那是使用者的資料庫。
await page.evaluate(() => {
  const hi = setInterval(() => {}, 999999);
  for (let i = 1; i <= hi; i++) clearInterval(i);
  clearInterval(hi);
});

const rows = [];
for (const size of SIZES) {
  const r = await page.evaluate(async ({ walls, furn }) => {
    const ed = window.__app.editor, doc = window.__app.doc;
    const { refreshProps } = await import('/src/ui/properties.ts');
    const base = doc.serialize();
    const objs = [];
    const cols = Math.ceil(Math.sqrt(walls / 2));
    let i = 0;
    for (let c = 0; c < cols && i < walls; c++)
      for (let k = 0; k < cols && i < walls; k++, i++) {
        const x = c * 400, y = k * 400;
        objs.push({ id: 'w' + i, kind: 'wall', layer: 'walls',
          a: { x, y }, b: { x, y: y + 400 }, thickness: i % 2 ? 15 : 24 });
      }
    for (let f = 0; f < furn; f++)
      objs.push({ id: 'f' + f, kind: 'furniture', layer: 'furniture', item: 'sofa',
        x: (f % 40) * 200, y: Math.floor(f / 40) * 200, w: 158, h: 66, angle: 0, label: '沙發' });

    doc.load({ ...base, floors: [{ ...base.floors[0], objects: objs }] });
    ed.resetView();
    doc.select(null);

    const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const time = (fn, n = 10) => {
      fn();                                        // 暖機：第一次含建構與編譯
      const t = [];
      for (let k = 0; k < n; k++) { const s = performance.now(); fn(); t.push(performance.now() - s); }
      return { p50: +median(t).toFixed(2), max: +Math.max(...t).toFixed(2) };
    };

    const draw = time(() => ed.renderNow());
    const panel = time(() => refreshProps(ed, doc));
    const total = doc.objects.length;
    doc.load(base);
    ed.resetView();
    return { total, draw, panel };
  }, size);
  rows.push({ ...size, ...r });
}

await browser.close();

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('規模', 16)}${pad('物件', 7)}${pad('2D重繪 p50/max', 18)}${pad('面板重畫 p50/max', 20)}`);
console.log('-'.repeat(62));
let bad = 0;
for (const r of rows) {
  const flag = (v) => (v > FRAME_MS ? ' ⚠' : '');
  if (r.draw.p50 > FRAME_MS || r.panel.p50 > FRAME_MS) bad++;
  console.log(
    pad(r.label, 16) + pad(r.total, 7)
    + pad(`${r.draw.p50}/${r.draw.max}${flag(r.draw.p50)}`, 18)
    + pad(`${r.panel.p50}/${r.panel.max}${flag(r.panel.p50)}`, 20),
  );
}
if (errors.length) {
  console.log('\n頁面丟出的例外：');
  for (const e of errors) console.log('  ' + e);
}
console.log(
  bad
    ? `\n⚠ ${bad} 個規模的中位數超過一幀（${FRAME_MS}ms）——那是使用者感覺得到的`
    : `\n每個規模的中位數都在一幀（${FRAME_MS}ms）以內`,
);
process.exit(bad || errors.length ? 1 : 0);
