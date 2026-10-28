// B20 遊戲式建造介面：兩種寬度、幾種狀態各截一張，並掃頂列與型錄列有沒有重疊。
//
//   node bench/shot-b20.mjs [http://localhost:5180] [--lang en]
//
// 截圖在 bench/results/b20-*.png。重疊掃的是「同一列裡兩個看得到的控制項的框有交集」
// 與「控制項超出自己那一區」——頂列放不下時以前是被擠出畫面，眼睛看不一定看得出來。
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const BASE = args.find(a => !a.startsWith('--')) ?? 'http://localhost:5180';
const EN = args.includes('--en');
const OUT = new URL('./results/', import.meta.url).pathname;
const br = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };

async function overlaps(page, where) {
  return page.evaluate((where) => {
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden]') && !el.closest('.hidden'); };
    const out = [];
    for (const sel of ['#topbar .tb-left > *', '#topbar .tb-center > *', '#topbar .tb-right > *', '#catalog > *', '.cat-list > *', '.floor-dock > *']) {
      const els = [...document.querySelectorAll(sel)].filter(vis);
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
          out.push(`${where}: ${sel} #${i} 撞 #${j}（${els[i].textContent.trim().slice(0, 12)}｜${els[j].textContent.trim().slice(0, 12)}）`);
      }
      for (const el of els) { const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 0.5 || r.left < -0.5) out.push(`${where}: ${sel} 超出視窗（${el.textContent.trim().slice(0, 12)}）`); }
    }
    // the three zones of the top bar must not run into each other
    const z = ['.tb-left', '.tb-center', '.tb-right'].map(s => document.querySelector(s));
    for (const el of [...z, document.querySelector('.cat-list')]) if (el.scrollWidth > el.clientWidth + 1) out.push(`${where}: ${el.className} 溢出 ${el.scrollWidth - el.clientWidth}px`);
    return out;
  }, where);
}

for (const [w, h] of [[1440, 900], [1280, 800]]) {
  const ctx = await br.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript((en) => { localStorage.setItem('interior_tour_seen', '1'); localStorage.setItem('interior_view_mode', 'split'); localStorage.setItem('interior_owner', 'own_orsxp52fbvey'); localStorage.setItem('interior_lang', en ? 'en' : 'zh-Hant'); }, EN);
  await page.goto(`${BASE}/?perf=1&plan=plan1151022`, { timeout: 400000 });
  await page.waitForFunction(() => window.__app?.doc.objects.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const tag = `${w}${EN ? '-en' : ''}`;
  await page.screenshot({ path: `${OUT}b20-${tag}-idle.png` });
  let o = await overlaps(page, `${tag} 待機`);
  ok(!o.length, `${tag} 待機沒有重疊${o.length ? '：' + o.join('；') : ''}`);
  ok(await page.$eval('#right', e => e.classList.contains('closed')), `${tag} 沒選東西時屬性收起來`);
  ok(await page.$eval('#hint', e => getComputedStyle(e).display === 'none'), `${tag} 選取工具待機時 2D 提示列不出現`);

  await page.click('[data-cat="客廳"]');
  await page.waitForTimeout(600);
  ok(await page.$$eval('#catalogShelf .furn-btn', l => l.length) > 10, `${tag} 點「客廳」展開第二排`);
  o = await overlaps(page, `${tag} 型錄展開`);
  ok(!o.length, `${tag} 型錄展開沒有重疊${o.length ? '：' + o.join('；') : ''}`);
  // select a piece of furniture on the plan so the drawer slides out
  await page.evaluate(() => { const a = window.__app; const f = a.doc.objects.find(o => o.kind === 'furniture'); a.doc.select(f.id); });
  await page.waitForTimeout(400);
  ok(!(await page.$eval('#right', e => e.classList.contains('closed'))), `${tag} 選了東西屬性滑出來`);
  await page.screenshot({ path: `${OUT}b20-${tag}-catalog-selected.png` });
  o = await overlaps(page, `${tag} 抽屜開著`);
  ok(!o.length, `${tag} 抽屜開著沒有重疊${o.length ? '：' + o.join('；') : ''}`);
  // a menu open
  await page.click('#viewMenu .menu-btn');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}b20-${tag}-menu.png` });
  await page.keyboard.press('Escape');
  await page.click('[data-cat="structure"]');
  await page.click('.tool-btn[data-tool="wall"]');
  await page.waitForTimeout(300);
  ok(await page.$eval('#hint', e => getComputedStyle(e).display !== 'none'), `${tag} 拿起牆工具時提示列出現`);
  ok(await page.$eval('#wallRef', e => e.getBoundingClientRect().width > 0), `${tag} 結構那排看得到牆基準`);
  await page.screenshot({ path: `${OUT}b20-${tag}-structure.png` });
  ok(!errs.length, `${tag} 沒有頁面錯誤${errs.length ? '：' + errs.join(' / ') : ''}`);
  await ctx.close();
}
await br.close();
console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
