// B8：四個擋路的介面問題（U1～U4，見 docs/review-2026-10.md）。
//
//   U1  1280～2000 寬，頂列不溢出、縮放控制整顆在畫面內
//   U2  照度面板與健檢面板同時只開一個
//   U3  照度面板開著時「縮放至全部」，每一道牆都落在沒被面板蓋住的畫布裡
//   U4  新方案第一次存檔後網址補上 ?plan=<id>，F5 回到同一份
//
// 需要 npm run dev（:5180 + :8791）。U4 用一個新的 owner 存一份驗證用方案，跑完刪掉。
//
//   node bench/verify-b8.mjs [base-url] [plan-id]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const PLAN = process.argv[3] ?? 'plan1151022';
const OUT = new URL('./results/', import.meta.url).pathname;
// plan1151022 屬於這個 owner（同 verify-b6）。這支只讀它、不改它：沒有任何一步會讓它變髒。
const OWNER = 'own_orsxp52fbvey';

const b = await chromium.launch();
let fails = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${n}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const errs = [];

async function open(width, { url = `${BASE}/?perf=1&plan=${PLAN}`, ctx, lang = 'zh-Hant', owner = OWNER } = {}) {
  const page = await (ctx ?? b).newPage({ viewport: { width, height: 950 } });
  await page.addInitScript(([lang, owner]) => {
    try {
      localStorage.setItem('interior_tour_seen', '1');
      localStorage.setItem('interior_view_mode', '2d');
      localStorage.setItem('interior_lang', lang);
      if (owner) localStorage.setItem('interior_owner', owner);
    } catch { /* ignore */ }
  }, [lang, owner]);
  page.on('pageerror', (e) => errs.push(`${width}: pageerror: ` + String(e).split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    errs.push(`${width}: ${m.text().slice(0, 200)}`);
  });
  await page.goto(url);
  await page.waitForTimeout(3000);
  return page;
}

// ---------------------------------------------------------------- U1
console.log('U1 頂列寬度');
for (const lang of ['zh-Hant', 'en']) {
  for (const w of [1280, 1366, 1440, 1500, 1600, 1680, 1700, 1701, 1760, 1800, 1920, 2000]) {
    const page = await open(w, { lang });
    // B20：縮放收進「檢視」選單，頂列分左中右三區。改量：頁面不橫向溢出、三區都不溢出、
    // 頂列上每一個看得到的控制項都完整落在視窗內、頂列只有一列高。
    const m = await page.evaluate(() => {
      const bar = document.getElementById('topbar');
      const zones = [...bar.querySelectorAll('.tb-left, .tb-center, .tb-right')];
      const ctls = [...bar.querySelectorAll('.tb-left > *, .tb-center > *, .tb-right > *')]
        .filter((e) => e.getBoundingClientRect().width > 0);
      return {
        sw: document.documentElement.scrollWidth, iw: innerWidth,
        over: zones.filter((z) => z.scrollWidth > z.clientWidth + 1).map((z) => z.className),
        out: ctls.filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).length,
        barH: bar.getBoundingClientRect().height, cls: bar.className,
      };
    });
    const ok = m.sw === m.iw && !m.over.length && !m.out && m.barH < 60;
    check(`${lang} ${w}`, ok, `scrollWidth=${m.sw} 溢出=${m.over.join(',') || '無'} 出界=${m.out} 高=${Math.round(m.barH)} ${m.cls}`);
    if (w === 1920 && lang === 'zh-Hant') await page.screenshot({ path: OUT + 'b8-topbar-1920.png', clip: { x: 0, y: 0, width: 1920, height: 60 } });
    await page.close();
  }
}

// 字型不同（盤點時量到 1977px，這台 headless 只有 1718px）、以後再加按鈕，都會讓頂列變寬。
// 斷點擋不住這種事，所以直接把頂列撐寬 400px，看它自己收不收得回來。
for (const w of [1920, 2000]) {
  const page = await open(w);
  await page.evaluate(() => {
    // 撐到右區剛好多出 40px：收掉文字標籤（行走、開燈、說明）就放得下。
    const right = document.querySelector('#topbar .tb-right');
    const used = [...right.children].reduce((w, e) => w + e.getBoundingClientRect().width, 0);
    const pad = document.createElement('span');
    pad.style.cssText = `display:inline-block;width:${right.clientWidth - used + 40}px;flex-shrink:0`;
    right.prepend(pad);
  });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, iw: innerWidth,
    zin: document.querySelector('#topbar .tb-right > :last-child').getBoundingClientRect().right,
    cls: document.getElementById('topbar').className,
  }));
  check(`${w} 頂列右區撐到溢出後自己收標籤`, m.sw === m.iw && m.zin <= m.iw && m.cls.includes('tight'),
    `scrollWidth=${m.sw} ＋右緣=${Math.round(m.zin)} class=${m.cls}`);
  await page.close();
}

// ---------------------------------------------------------------- U2 + U3
console.log('\nU2 面板互斥／U3 縮放至全部');
for (const w of [1280, 1500, 1920]) {
  const page = await open(w);
  const visible = () => page.evaluate(() => ({
    light: !document.getElementById('lightPanel').classList.contains('hidden'),
    health: !document.getElementById('healthPanel').classList.contains('hidden'),
  }));
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());   // B20：在「檢視」選單裡
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-act="health"]').click());   // B20：在「檢視」選單裡
  await page.waitForTimeout(300);
  let v = await visible();
  check(`${w} 開照度再開健檢 → 只剩健檢`, v.health && !v.light, JSON.stringify(v));
  await page.evaluate(() => document.querySelector('[data-act="lighting"]').click());   // B20：在「檢視」選單裡
  await page.waitForTimeout(300);
  v = await visible();
  check(`${w} 再開照度 → 只剩照度`, v.light && !v.health, JSON.stringify(v));

  await page.evaluate(() => document.querySelector('#zoomFit').click());   // B20：在「檢視」選單裡
  await page.waitForTimeout(400);
  const fit = await page.evaluate(() => {
    const { doc, editor } = window.__app;
    const c = editor.canvas.getBoundingClientRect();
    const panel = document.getElementById('lightPanel').getBoundingClientRect();
    const right = Math.min(c.right, panel.left);
    const out = [];
    let pts = 0;
    for (const o of doc.objects) {
      if (o.kind !== 'wall') continue;
      for (const p of [o.a, o.b]) {
        pts++;
        const s = editor.vp.toScreen(p);
        const x = c.left + s.x, y = c.top + s.y;
        if (x < c.left || x > right || y < c.top || y > c.bottom) out.push(`${o.id}@${Math.round(x)},${Math.round(y)}`);
      }
    }
    return { pts, out, right: Math.round(right), left: Math.round(c.left) };
  });
  check(`${w} 照度開著縮放至全部，牆端點都在 ${fit.left}～${fit.right} 內`, fit.pts > 0 && fit.out.length === 0,
    `端點 ${fit.pts}，在外面 ${fit.out.length}${fit.out.length ? '：' + fit.out.slice(0, 4).join(' ') : ''}`);
  await page.screenshot({ path: OUT + `b8-fit-lighting-${w}.png` });
  await page.close();
}

// ---------------------------------------------------------------- U4
console.log('\nU4 存檔後網址帶 ?plan=');
{
  const ctx = await b.newContext();
  const page = await open(1500, { url: `${BASE}/?perf=1`, ctx, owner: null });
  const owner = await page.evaluate(() => localStorage.getItem('interior_owner'));
  const id = await page.evaluate(() => window.__app.doc.project.id);
  await page.evaluate(() => {
    const d = window.__app.doc;
    d.commit();
    d.add({ id: 'w_b8', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, thickness: 12 });
  });
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(2500);
  const search = await page.evaluate(() => location.search);
  check('存檔後網址帶上自己的 id', new URLSearchParams(search).get('plan') === id, `search=${search} id=${id}`);
  check('其他參數留著', new URLSearchParams(search).get('perf') === '1', search);
  await page.reload();
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => ({ id: window.__app.doc.project.id, wall: window.__app.doc.objects.some((o) => o.id === 'w_b8') }));
  check('F5 回到同一份方案', after.id === id && after.wall, JSON.stringify(after));

  // 新建 → 網址的 plan 要拿掉，不然 F5 會跳回上一份
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(() => document.querySelector('[data-act="new"]').click());
  await page.waitForTimeout(500);
  const fresh = await page.evaluate(() => location.search);
  check('新建後網址不再指著舊方案', !new URLSearchParams(fresh).get('plan'), `search=${fresh}`);

  // 收尾：刪掉這個 owner 的所有方案
  await page.evaluate((o) => fetch('/api/projects', { headers: { 'X-Owner': o } })
    .then((r) => r.json())
    .then((d) => Promise.all(d.projects.map((x) => fetch(`/api/projects/${x.id}`, { method: 'DELETE', headers: { 'X-Owner': o } })))), owner);
  await ctx.close();
}

check('\n沒有 console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
console.log(fails ? `\n${fails} 項未通過` : '\n全部通過');
process.exit(fails ? 1 : 0);
