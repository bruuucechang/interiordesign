// B4 驗收：照 1151022 平面配置圖描的方案（plan1151022）在 App 裡長什麼樣，
// 跟 PDF 並排一張圖。要開著 `npm run dev`（讀的是資料庫裡那份）。
//
//   node bench/verify-pdf1151022.mjs     → bench/results/pdf1151022-{app,pdf,side}.png
//
// 另外讀工具列上空間健檢的數字：牆端沒接上、門窗不在牆上這類幾何問題要是 0。

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'bench/results');
const OWNER = 'own_orsxp52fbvey';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.addInitScript((owner) => {
  try {
    localStorage.setItem('interior_tour_seen', '1');
    localStorage.setItem('interior_view_mode', '2d');
    localStorage.setItem('interior_lang', 'zh-Hant');
    localStorage.setItem('interior_owner', owner);
  } catch { /* ignore */ }
}, OWNER);
let errors = 0;
page.on('pageerror', (e) => { console.error('PAGEERROR', String(e).split('\n')[0]); errors++; });

await page.goto('http://localhost:5180/?plan=plan1151022');
await page.waitForTimeout(2500);
await page.locator('#canvas').screenshot({ path: join(OUT, 'pdf1151022-app.png') });

await page.evaluate(() => document.querySelector('[data-act="health"]').click());   // B20：在「檢視」選單裡
await page.waitForTimeout(400);
const body = await page.locator('#healthBody').innerText();
const geom = ['沒接上', '不在任何牆上', '還沒圍成'].filter((k) => body.includes(k));
console.log(geom.length ? `✘ 健檢有幾何問題：${geom.join('、')}` : '✔ 健檢沒有牆端／門窗／房間的幾何問題');
await browser.close();

execFileSync('pdftocairo', ['-png', '-r', '110', '-singlefile', join(ROOT, 'docs/plan-1151022.pdf'), join(OUT, 'pdf1151022-pdf')]);
// 並排：PDF 只取圖面那一塊（頁面的 3%–86% × 3%–98%），縮到跟 App 截圖同高
execFileSync(join(ROOT, '.venv/bin/python'), ['-c', `
from PIL import Image
a = Image.open('${OUT}/pdf1151022-pdf.png').convert('RGB'); W, H = a.size
a = a.crop((int(W*.03), int(H*.03), int(W*.86), int(H*.98)))
b = Image.open('${OUT}/pdf1151022-app.png').convert('RGB')
a = a.resize((int(a.width * b.height / a.height), b.height))
o = Image.new('RGB', (a.width + b.width + 20, b.height), 'white')
o.paste(a, (0, 0)); o.paste(b, (a.width + 20, 0)); o.save('${OUT}/pdf1151022-side.png')
`]);
console.log(`截圖：${OUT}/pdf1151022-side.png（左 PDF、右 App）`);
process.exit(geom.length || errors ? 1 : 0);
