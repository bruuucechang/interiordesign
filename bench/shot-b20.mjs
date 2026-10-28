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
  // B20 審查 1：抽屜滑進來之後，3D 提示要讓到它左邊（--panel-inset 要等動畫跑完再量）。
  await page.evaluate(() => window.__app.editor.selectTool('furniture'));
  await page.waitForTimeout(500);
  const cover = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const h = r('#hint3d'), d = r('#right'), f = r('#floors'), k = r('.key-hud');
    return { shown: h.width > 0, hintDrawer: hit(h, d), hudFloors: hit(k, f), hudDrawer: hit(k, d), floorsDrawer: hit(f, d) };
  });
  ok(cover.shown && !cover.hintDrawer && !cover.hudDrawer && !cover.hudFloors && !cover.floorsDrawer,
    `${tag} 抽屜開著時 3D 提示、鍵帽、樓層鈕互不重疊 ${JSON.stringify(cover)}`);
  await page.keyboard.press('Escape');
  // B20 審查 2：照度面板開著時樓層鈕還點得到。
  for (const drawer of [true, false]) {
    if (!drawer) await page.evaluate(() => { const d = window.__app.doc; d.select(null); });
    await page.evaluate(() => { if (document.getElementById('lightPanel').classList.contains('hidden')) document.querySelector('[data-act="lighting"]').click(); });
    await page.waitForTimeout(600);
    const reach = await page.evaluate(() => {
      const b = document.querySelector('.floor-btn.active').getBoundingClientRect();
      return !!document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('.floor-dock');
    });
    ok(reach, `${tag} 開著照度${drawer ? '＋抽屜' : ''}時樓層鈕點得到`);
  }
  await page.evaluate(() => document.querySelector('[data-act="close-lighting"]').click());
  await page.waitForTimeout(300);
  // B20 審查 3：刪除樓層的 ✕ 跟按鈕之間沒有縫（慢慢移過去不會掉）。
  await page.evaluate(() => window.__app.doc.addFloor());
  await page.waitForTimeout(300);
  const act = page.locator('.floor-btn.active');
  const bb = await act.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.move(bb.x - 9, bb.y + bb.height / 2, { steps: 40 });
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.floor-btn.active .floor-del')).display !== 'none'),
    `${tag} 慢慢移到刪除樓層的 ✕ 時它還在`);
  await page.evaluate(() => { const d = window.__app.doc; d.removeFloor(d.project.activeFloorId); });
  await page.waitForTimeout(300);
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
// B20 第二輪審查：分割拉到 70%（3D 那格很窄）又開著抽屜時，提示不塌成直排、鍵帽不壓樓層鈕。
{
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { localStorage.setItem('interior_tour_seen', '1'); localStorage.setItem('interior_view_mode', 'split');
    localStorage.setItem('interior_view_split', '70'); localStorage.setItem('interior_owner', 'own_orsxp52fbvey'); localStorage.setItem('interior_lang', 'zh-Hant'); });
  await page.goto(`${BASE}/?perf=1&plan=plan1151022`, { timeout: 400000 });
  await page.waitForFunction(() => window.__app?.doc.objects.length > 50, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { const a = window.__app; a.editor.selectTool('furniture'); a.doc.select(a.doc.objects.find(o => o.kind === 'furniture').id); });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const hit = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const h = r('#hint3d'), k = r('.key-hud'), f = r('#floors'), d = r('#right');
    return { h: Math.round(h.height), hudFloors: hit(k, f), hintDrawer: hit(h, d), hintFloors: hit(h, f) };
  });
  ok(m.h > 0 && m.h < 40 && !m.hudFloors && !m.hintDrawer && !m.hintFloors, `1280 分割 70%＋抽屜：3D 提示一行、不壓樓層鈕與抽屜 ${JSON.stringify(m)}`);
  await page.screenshot({ path: `${OUT}b20-1280-split70-drawer.png` });
  await ctx.close();
}

// 導覽提示（B20 審查 4、5、9）：空白方案第一次才出現、不蓋住風格選單與樓層鈕、
// 按「看導覽」就記成看過；網址帶 ?plan= 的不出現。
{
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('interior_lang', 'zh-Hant'));
  await page.goto(`${BASE}/?perf=1`);
  await page.waitForSelector('.tour-nudge', { timeout: 15000 }).catch(() => {});
  ok(!!(await page.$('.tour-nudge')), '空白方案第一次開：右下角出現導覽提示');
  const clear = await page.evaluate(() => {
    const at = (el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); };
    return { style: at(document.querySelector('.style-select'))?.classList.contains('style-select'),
      floor: !!at(document.querySelector('.floor-btn'))?.closest('.floor-dock') };
  });
  ok(clear.style && clear.floor, `導覽提示不蓋住風格選單與樓層鈕 ${JSON.stringify(clear)}`);
  await page.click('.tour-nudge .primary');
  ok(await page.evaluate(() => localStorage.getItem('interior_tour_seen') === '1'), '按「看導覽」就記成看過');
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.removeItem('interior_tour_seen'));
  await page.goto(`${BASE}/?perf=1&plan=does-not-exist`);
  await page.waitForTimeout(3000);
  ok(!(await page.$('.tour-nudge')), '網址帶 ?plan= 時不出現導覽提示');
  await ctx.close();
}
await br.close();
console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
