// 照度圖層：放兩盞燈、拖一盞，熱圖要跟著動，而且重算一次 < 50 ms。
//
//   npm run build && node bench/verify-lighting.mjs
//
// 全程用真的滑鼠事件：點「照度」、用水電工具點兩下放崁燈、用選取工具拖一盞。
// 單元測試釘得住數學，釘不住「拖的當下圖有沒有跟著變、會不會卡」。
// 另外驗 B2 一起收的三件：屬性面板改流明會反映到數字、T5 點兩端選得到、
// T5 貼牆吸到牆面。截圖存 bench/results/lighting-*.png。
//
// Headless，理由同 soak.mjs。

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'client/dist');
const OUT = join(ROOT, 'bench/results');
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' };

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(p === '/api/projects' ? { projects: [] } : { polygons: [] }));
      return;
    }
    const f = join(DIST, p === '/' ? 'index.html' : p);
    if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    res.end(await readFile(f));
  });
  s.listen(0, () => ok(s));
});

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(() => {
  try {
    localStorage.setItem('interior_tour_seen', '1');
    localStorage.setItem('interior_view_mode', '2d');
    localStorage.setItem('interior_lang', 'zh-Hant');   // the checks read Chinese labels; headless Chromium reports en-US
    localStorage.removeItem('interior_lighting_view');
  } catch { /* ignore */ }
});

let fail = 0;
page.on('pageerror', (e) => { console.error('PAGEERROR', String(e).split('\n')[0]); fail++; });
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fail++;
};

await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForFunction(() => window.__app?.doc);

// 400×400 的房間，24 cm 的牆。房間不交給後端偵測（這裡沒有後端），直接寫進去。
await page.evaluate(() => {
  const W = (id, a, b) => ({ id, kind: 'wall', layer: 'walls', a, b, thickness: 24, finish: 'paint' });
  window.__app.doc.load({
    schemaVersion: 1, name: 'lighting', activeFloorId: 'f1',
    floors: [{ id: 'f1', name: '1F', base: 0, height: 280, objects: [
      W('wt', { x: 0, y: 0 }, { x: 400, y: 0 }), W('wr', { x: 400, y: 0 }, { x: 400, y: 400 }),
      W('wb', { x: 400, y: 400 }, { x: 0, y: 400 }), W('wl', { x: 0, y: 400 }, { x: 0, y: 0 }),
      { id: 'r1', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 400, h: 400, name: '臥室', auto: false },
    ] }],
    layers: [{ id: 'rooms', name: '房間', color: '#4c8dff', visible: true },
             { id: 'walls', name: '牆', color: '#eee', visible: true },
             { id: 'electrical', name: '水電', color: '#ffd166', visible: true }],
  });
  const { editor } = window.__app;
  editor.vp.centerOn(200, 200, 700, 700);
  editor.renderNow();
});

const toScreen = (x, y) => page.evaluate(([x, y]) => {
  const r = document.getElementById('canvas').getBoundingClientRect();
  const s = window.__app.editor.vp.toScreen({ x, y });
  return { x: r.left + s.x, y: r.top + s.y };
}, [x, y]);
const probe = () => page.evaluate(() => {
  const L = window.__app.lighting;
  return { open: L.open, rooms: L.rooms, ms: L.ms };
});
const at = (x, y) => page.evaluate(([x, y]) => window.__app.lighting.at(x, y), [x, y]);

await page.click('[data-act="lighting"]');
await page.waitForTimeout(200);
check('面板開著、熱圖有掛上', await page.isVisible('#lightPanel') && (await probe()).open);
check('沒有燈時面板說怎麼開始', (await page.textContent('#lightCircuits')).includes('還沒有燈'));

// ---- 放兩盞崁燈
await page.evaluate(() => { const e = window.__app.editor; e.currentElectrical = 'downlight'; e.selectTool('electrical'); });
for (const [x, y] of [[120, 200], [280, 120]]) {
  const s = await toScreen(x, y);
  await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.mouse.up();
}
await page.evaluate(() => window.__app.editor.selectTool('select'));
await page.waitForTimeout(400);

let p = await probe();
check('兩盞都算進臥室', p.rooms[0]?.lums === 2, JSON.stringify(p.rooms[0]));
check('停著用 5 cm 格點', p.rooms[0]?.step === 5);
const before = { lamp: await at(280, 120), target: await at(280, 320), avg: p.rooms[0].avg };
await page.locator('#canvas').screenshot({ path: join(OUT, 'lighting-before.png') });
check('面板列出房間數字', (await page.textContent('#lightRooms')).includes('平均 lux'));

// ---- 拖第二盞：(280,120) → (280,320)，分 12 步
const from = await toScreen(280, 120), to = await toScreen(280, 320);
await page.mouse.move(from.x, from.y); await page.mouse.down();
const dragMs = [], dragSteps = new Set();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(from.x, from.y + (to.y - from.y) * i / 12);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const q = await probe();
  dragMs.push(q.ms); dragSteps.add(q.rooms[0]?.step);
}
await page.mouse.up();
await page.waitForTimeout(500);   // 換回細格點的那一次重畫

p = await probe();
const after = { lamp: await at(280, 120), target: await at(280, 320), avg: p.rooms[0].avg };
await page.locator('#canvas').screenshot({ path: join(OUT, 'lighting-after.png') });
const worst = Math.max(...dragMs);
check('拖曳中用 8 cm 粗格點', dragSteps.has(8), [...dragSteps].join(','));
check('拖曳中每次重算 < 50 ms', worst < 50, `最慢 ${worst.toFixed(1)} ms`);
check('放開後換回 5 cm', p.rooms[0]?.step === 5);
check('熱圖跟著燈走：原位置變暗', after.lamp < before.lamp * 0.7, `${before.lamp.toFixed(0)} → ${after.lamp.toFixed(0)} lux`);
check('熱圖跟著燈走：新位置變亮', after.target > before.target * 1.5, `${before.target.toFixed(0)} → ${after.target.toFixed(0)} lux`);

// 畫面上也真的變了：燈新位置的像素比拖之前亮
const pixel = (x, y) => page.evaluate(([x, y]) => {
  const cv = document.getElementById('canvas');
  const { vp } = window.__app.editor;
  const s = vp.toScreen({ x, y });
  const d = cv.getContext('2d').getImageData(Math.round(s.x * vp.dpr), Math.round(s.y * vp.dpr), 1, 1).data;
  return d[0] + d[1] + d[2];
}, [x, y]);
const pxNew = await pixel(250, 330), pxOld = await pixel(250, 110);
check('畫面：新位置旁邊比舊位置旁邊亮', pxNew > pxOld, `${pxNew} vs ${pxOld}`);

// ---- 點選不是拖曳：選一盞燈不該讓熱圖掉到粗格點
await page.evaluate(() => window.__app.doc.select(null));
await page.evaluate(() => { const d = window.__app.doc; d.select(d.objects.filter(o => o.kind === 'electrical')[0].id); });
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
check('選取一盞燈，熱圖維持 5 cm', (await probe()).rooms[0]?.step === 5);

// ---- 屬性面板：改流明，數字要變
const lampId = await page.evaluate(() => window.__app.doc.objects.filter(o => o.kind === 'electrical')[1].id);
await page.evaluate((id) => window.__app.doc.select(id), lampId);
await page.waitForTimeout(150);
const lmInput = page.locator('#properties .prop', { hasText: '流明' }).locator('input');
check('屬性面板有流明欄、預設值是 placeholder', (await lmInput.getAttribute('placeholder')) === '720');
await lmInput.fill('1440');
await page.locator('#canvas').hover();   // 焦點離開屬性面板，面板才會重畫
await page.waitForTimeout(500);
const bright = (await probe()).rooms[0].avg;
check('流明加倍，平均跟著升', bright > after.avg * 1.3, `${after.avg.toFixed(0)} → ${bright.toFixed(0)}`);
const stored = await page.evaluate((id) => window.__app.doc.objects.find(o => o.id === id).lumens, lampId);
check('存進物件', stored === 1440);
for (const label of ['迴路', '色溫']) check(`屬性面板有「${label}」`, await page.locator('#properties .prop', { hasText: label }).count() > 0);

// ---- 迴路：把第二盞換到迴路 2 再關掉，只剩一盞
await page.evaluate((id) => { const d = window.__app.doc; d.update(id, { circuit: 2 }); }, lampId);
await page.waitForTimeout(400);
await page.locator('#lightCircuits label', { hasText: '迴路 2' }).locator('input').uncheck();
await page.waitForTimeout(400);
check('關掉迴路 2 只剩一盞', (await probe()).rooms[0].lums === 1);
await page.locator('#lightCircuits label', { hasText: '迴路 2' }).locator('input').check();

// ---- T5：貼下牆，吸到牆面，兩端點得到
await page.evaluate(() => { const e = window.__app.editor; e.currentElectrical = 'batten'; e.selectTool('electrical'); });
const t5at = await toScreen(200, 380);
await page.mouse.move(t5at.x, t5at.y); await page.mouse.down(); await page.mouse.up();
await page.evaluate(() => { window.__app.editor.selectTool('select'); window.__app.doc.select(null); });
const t5 = await page.evaluate(() => window.__app.doc.objects.find(o => o.item === 'batten'));
check('T5 吸到牆面（牆心 400 − 半牆厚 12 = 388）', Math.abs(t5.y - 388) < 0.01, `y=${t5.y}`);
check('T5 照向房間（上方）', ((t5.angle % 360) + 360) % 360 === 0, `angle=${t5.angle}`);
const end = await toScreen(t5.x + 55, t5.y - 3);
await page.mouse.click(end.x, end.y);
await page.waitForTimeout(150);
check('點 T5 的端點選得到它', await page.evaluate((id) => window.__app.doc.selectedIds.includes(id), t5.id));
check('T5 屬性面板有長度與照向', await page.locator('#properties .prop', { hasText: 'T5 長度' }).count() === 1
  && await page.locator('#properties .prop', { hasText: '照向' }).count() === 1);
await page.screenshot({ path: join(OUT, 'lighting-panel.png') });

// ---- 重的那一間：原型的「你的房間」，4 支 T5、6 盞崁燈、2 座做到頂的櫃子，拖一盞崁燈
await page.evaluate(() => {
  const W = (id, a, b) => ({ id, kind: 'wall', layer: 'walls', a, b, thickness: 12, finish: 'paint' });
  const E = (id, item, x, y, angle, circuit) => ({ id, kind: 'electrical', layer: 'electrical', item, x, y, angle, circuit, ...(item === 'batten' ? { size: 4 } : {}) });
  const C = (id, x, y, w, h) => ({ id, kind: 'furniture', layer: 'furniture', item: 'wardrobe', x, y, w, h, angle: 0, label: '櫃子', height: 280 });
  window.__app.doc.load({
    schemaVersion: 1, name: 'roomA', activeFloorId: 'f1',
    floors: [{ id: 'f1', name: '1F', base: 0, height: 280, objects: [
      // 原型量的是室內淨尺寸，所以牆面（不是牆心）在 0／365／415，房間照偵測器沿牆心畫（B5 起照度算到牆面）。
      W('wt', { x: -6, y: -6 }, { x: 371, y: -6 }), W('wr', { x: 371, y: -6 }, { x: 371, y: 421 }),
      W('wb', { x: 371, y: 421 }, { x: -6, y: 421 }), W('wl', { x: -6, y: 421 }, { x: -6, y: -6 }),
      { id: 'ra', kind: 'room', layer: 'rooms', x: -6, y: -6, w: 377, h: 427, name: '你的房間', auto: false },
      C('c1', 85, 0, 280, 60), C('c2', 0, 95, 50, 320),
      E('t1', 'batten', 230, 60, 180, 2), E('t2', 'batten', 365, 248, 270, 1), E('t3', 'batten', 230, 415, 0, 2), E('t4', 'batten', 50, 248, 90, 1),
      E('d1', 'downlight', 65, 105, 0, 3), E('d2', 'downlight', 175, 105, 0, 3), E('d3', 'downlight', 285, 105, 0, 3),
      E('d4', 'downlight', 65, 378, 0, 3), E('d5', 'downlight', 175, 378, 0, 3), E('d6', 'downlight', 285, 378, 0, 3),
    ] }],
    layers: [{ id: 'rooms', name: '房間', color: '#4c8dff', visible: true },
             { id: 'walls', name: '牆', color: '#eee', visible: true },
             { id: 'furniture', name: '家具', color: '#e0b45a', visible: true },
             { id: 'electrical', name: '水電', color: '#ffd166', visible: true }],
  });
  const { editor } = window.__app;
  editor.selectTool('select');
  editor.vp.centerOn(182, 207, 650, 650);
  editor.renderNow();
});
await page.waitForTimeout(500);
const fine = (await probe());
check('你的房間：全開平均 317 ±5%（跟 B1 的引擎測試同一個數）', Math.abs(fine.rooms[0].avg - 316.77) < 16, fine.rooms[0].avg.toFixed(2));
check('你的房間：5 cm 整間重算 < 50 ms', fine.ms < 50, `${fine.ms.toFixed(1)} ms`);
const a0 = await toScreen(175, 378), a1 = await toScreen(175, 250);
await page.mouse.move(a0.x, a0.y); await page.mouse.down();
const heavy = [];
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(a0.x, a0.y + (a1.y - a0.y) * i / 10);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  heavy.push((await probe()).ms);
}
await page.mouse.up();
await page.waitForTimeout(500);
check('你的房間：拖崁燈時每次重算 < 50 ms', Math.max(...heavy) < 50, `最慢 ${Math.max(...heavy).toFixed(1)} ms`);
await page.screenshot({ path: join(OUT, 'lighting-roomA.png') });

// ---- B3：區域、開法比較、提醒。原型「你的房間」完整的配置（加上床、書桌、房門），
// 面板上的區域平均要跟原型差 ±5%，開法比較 7 列，健檢的照明提醒跟原型同樣 5 條。
await page.evaluate(() => {
  const W = (id, a, b) => ({ id, kind: 'wall', layer: 'walls', a, b, thickness: 12, finish: 'paint' });
  const E = (id, item, x, y, angle, circuit) => ({ id, kind: 'electrical', layer: 'electrical', item, x, y, angle, circuit, ...(item === 'batten' ? { size: 4 } : {}) });
  const F = (id, item, label, x, y, w, h, angle = 0, height) => ({ id, kind: 'furniture', layer: 'furniture', item, x, y, w, h, angle, label, ...(height ? { height } : {}) });
  window.__app.doc.load({
    schemaVersion: 1, name: 'roomA-full', activeFloorId: 'f1',
    floors: [{ id: 'f1', name: '1F', base: 0, height: 280, objects: [
      // 原型量的是室內淨尺寸，所以牆面（不是牆心）在 0／365／415，房間照偵測器沿牆心畫（B5 起照度算到牆面）。
      W('wt', { x: -6, y: -6 }, { x: 371, y: -6 }), W('wr', { x: 371, y: -6 }, { x: 371, y: 421 }),
      W('wb', { x: 371, y: 421 }, { x: -6, y: 421 }), W('wl', { x: -6, y: 421 }, { x: -6, y: -6 }),
      { id: 'ra', kind: 'room', layer: 'rooms', x: -6, y: -6, w: 377, h: 427, name: '你的房間', auto: false },
      { id: 'dr', kind: 'door', layer: 'doors', x: 42.5, y: -6, width: 85, angle: 0 },
      F('c1', 'wardrobe', '衣櫃', 85, 0, 280, 60, 0, 280), F('c2', 'wardrobe', '櫃子', 0, 95, 50, 320, 0, 280),
      // 原型的床外框 190×175、床頭朝東：床本身 175×190 轉 90°
      F('bed', 'bed_double', '床', 182.5, 127.5, 175, 190, 90), F('desk', 'desk', '書桌', 122, 362, 243, 53),
      E('t1', 'batten', 230, 60, 180, 2), E('t2', 'batten', 365, 248, 270, 1), E('t3', 'batten', 230, 415, 0, 2), E('t4', 'batten', 50, 248, 90, 1),
      E('d1', 'downlight', 65, 105, 0, 3), E('d2', 'downlight', 175, 105, 0, 3), E('d3', 'downlight', 285, 105, 0, 3),
      E('d4', 'downlight', 65, 378, 0, 3), E('d5', 'downlight', 175, 378, 0, 3), E('d6', 'downlight', 285, 378, 0, 3),
    ] }],
    layers: [{ id: 'rooms', name: '房間', color: '#4c8dff', visible: true },
             { id: 'walls', name: '牆', color: '#eee', visible: true },
             { id: 'doors', name: '門窗', color: '#eee', visible: true },
             { id: 'furniture', name: '家具', color: '#e0b45a', visible: true },
             { id: 'electrical', name: '水電', color: '#ffd166', visible: true }],
  });
  const { editor } = window.__app;
  editor.vp.centerOn(182, 207, 650, 650);
  editor.renderNow();
});
await page.waitForTimeout(800);
const zoneRows = await page.$$eval('#lightRooms .lp-tbl.zones tbody tr', trs => trs.map(tr => [...tr.cells].map(td => td.textContent)));
const PROTO = { '床（床面）': 322.99, '書桌桌面': 331.47, '衣櫃前': 318.26, '櫃子前': 315.28, '門口': 202.28 };
check('區域表：五個區域', zoneRows.length === 5, zoneRows.map(r => r[0]).join('、'));
for (const [name, want] of Object.entries(PROTO)) {
  const row = zoneRows.find(r => r[0] === name);
  const got = row ? Number(row[1].replace(/,/g, '')) : NaN;
  check(`區域「${name}」平均跟原型 ±5%`, Math.abs(got - want) <= want * 0.05, `${got} vs ${want}`);
}
const comboRows = await page.$$eval('#lightRooms .lp-tbl.combos tbody tr', trs => trs.map(tr => [...tr.cells].map(td => td.textContent)));
check('開法比較：三個迴路 7 種組合', comboRows.length === 7);
const allOn = comboRows.at(-1) ?? [];
check('開法比較：全開的床／書桌跟原型 ±5%', Math.abs(Number(allOn[4]) - 323) <= 16 && Math.abs(Number(allOn[5]) - 331.5) <= 17, allOn.join(' | '));
const warns = await page.$$eval('#lightRooms .lp-warns li b', bs => bs.map(b => b.textContent));
check('面板提醒：跟原型同樣 5 條（床頭後 1、離枕頭近 2、離櫃子近 2）', warns.length === 5, warns.join('、'));
await page.locator('#lightPanel').screenshot({ path: join(OUT, 'lighting-zones-panel.png') });
// 只動床：格點不變（床不擋光），區域表與提醒還是要跟著更新
const bedRow = async () => (await page.$$eval('#lightRooms .lp-tbl.zones tbody tr', trs => trs.map(tr => [...tr.cells].map(td => td.textContent)))).find(r => r[0] === '床（床面）')?.[1];
const bedBefore = await bedRow();
await page.evaluate(() => window.__app.doc.update('bed', { x: 90, y: 160 }));
await page.waitForTimeout(600);
const bedAfter = await bedRow();
check('只移床，區域表的床面數字跟著變', bedAfter && bedAfter !== bedBefore, `${bedBefore} → ${bedAfter}`);
await page.evaluate(() => window.__app.doc.update('bed', { x: 182.5, y: 127.5 }));
await page.waitForTimeout(600);
await page.locator('#lightRooms .lp-room').first().screenshot({ path: join(OUT, 'lighting-zones-room.png') });
await page.click('[data-act="health"]');
await page.waitForTimeout(400);
const healthLight = await page.$$eval('#healthBody .hf.lighting', els => els.length);
check('空間健檢裡也有這 5 條照明提醒', healthLight === 5, String(healthLight));
check('健檢底下講明照明數字是一般值', (await page.textContent('#healthBody')).includes('床面 100'));
await page.screenshot({ path: join(OUT, 'lighting-zones-health.png') });
await page.click('[data-act="close-health"]');

// ---- 關掉：熱圖拿掉
await page.click('[data-act="close-lighting"]');
await page.waitForTimeout(150);
check('關掉面板熱圖就拿掉', !(await probe()).open && await page.evaluate(() => !window.__app.editor.heat));

await browser.close();
server.close();
console.log(fail ? `\n✘ ${fail} 項沒過` : '\n✔ 全部通過');
process.exit(fail ? 1 : 0);
