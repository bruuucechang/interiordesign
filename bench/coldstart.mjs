// How long the first 3D frame costs, with and without warming.
//
// Building one material is a 512² albedo, a 512² height field and a Sobel pass.
// Paid lazily, that lands as a single stall at the exact moment the user
// presses 切換 3D and is watching. This measures that first build both ways.
//
//   node bench/coldstart.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
const DIST = join(resolve(import.meta.dirname, '..'), 'client/dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png' };
const server = await new Promise(ok => { const s = createServer(async (req,res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/')) { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify(p==='/api/projects'?{projects:[]}:{polygons:[]})); return; }
  let f = join(DIST, p==='/'?'index.html':p); if (!existsSync(f)) f = join(DIST,'index.html');
  res.writeHead(200,{'content-type':MIME[extname(f)]??'application/octet-stream'}); res.end(await readFile(f));
}); s.listen(0,()=>ok(s)); });

// Every finish on one plan — the worst case, and the one that produced the
// 530 ms measurement in the soak.
//
// 清單向 App 要，不要在這裡抄一份：抄的那一份不會跟著新增的材質更新，於是
// 「全部材質都用上」這個前提會安靜地變成假的，而整個量測就是建立在它上面。
const lists = await (async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => {
    const a = window.__app;
    if (!a?.floorMaterials) throw new Error('__app 沒有材質清單 —— main.ts 的 ?perf=1 匯出改過了');
    return { f: a.floorMaterials().map((m) => m.id), w: a.wallMaterials().map((m) => m.id) };
  });
  await b.close();
  return r;
})();
const FLOORS = lists.f, WALLS = lists.w;
const objects = [];
for (let k = 0; k < FLOORS.length; k++) {
  const x = (k % 4) * 420, y = Math.floor(k / 4) * 380;
  objects.push({ id:'r'+k, kind:'room', layer:'rooms', x, y, w:400, h:360, name:'房'+k, floor: FLOORS[k] });
  const cs = [[[x,y],[x+400,y]],[[x+400,y],[x+400,y+360]],[[x+400,y+360],[x,y+360]],[[x,y+360],[x,y]]];
  cs.forEach(([a,b], j) => objects.push({ id:`w${k}_${j}`, kind:'wall', layer:'walls', a:{x:a[0],y:a[1]}, b:{x:b[0],y:b[1]}, thickness:12, finish: WALLS[(k+j) % WALLS.length] }));
}
const plan = { schemaVersion:1, name:'cold', activeFloorId:'f1',
  floors:[{ id:'f1', name:'1F', base:0, height:270, objects }],
  layers:[{id:'walls',name:'牆',color:'#eee',visible:true},{id:'rooms',name:'房',color:'#4c8dff',visible:true}] };

async function run(warm) {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport:{width:1200,height:800} });
  await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
  await page.waitForTimeout(2000);
  const ms = await page.evaluate(async ({ plan, warm }) => {
    const { doc, view3d, warmFinishes } = window.__app;
    doc.load(plan);
    // The app warms on its own 400 ms after a change; with warming off we go
    // straight to 3D before that can happen.
    await new Promise(r => setTimeout(r, warm ? 4000 : 60));
    const t = performance.now();
    view3d.build(doc, true);
    return performance.now() - t;
  }, { plan, warm });
  await b.close();
  return ms;
}

// 預熱本身花多久、每一塊多大 —— 成本是被移走不是消失，那些塊落在閒置時
// 一樣會被感覺到。
//
// 量的是 longtask 不是 requestIdleCallback 的回呼時間。第一版包住 ric 計時，
// 材質改成先抓 CC0 貼圖之後，warmMaterial 只丟出一個 promise 就回來——回呼本身
// 變成 0ms，於是這裡開始回報「0 塊，共 0ms」，看起來像預熱免費了。實際成本搬到
// 圖片解碼與上傳，那些照樣卡主執行緒，只是不在回呼裡面。longtask 兩種寫法都量
// 得到，因為它量的是「主執行緒被佔住超過 50ms」這件事本身。
async function warmCost() {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport:{width:1200,height:800} });
  await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
  await page.waitForTimeout(2000);
  const r = await page.evaluate(async (plan) => {
    const blocks = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) blocks.push(e.duration); })
      .observe({ entryTypes: ['longtask'] });
    const t0 = performance.now();
    window.__app.doc.load(plan);
    await new Promise(r2 => setTimeout(r2, 6000));
    const tex = performance.getEntriesByType('resource').filter((e) => e.name.includes('/textures/'));
    return {
      blocks,
      files: tex.length,
      bytes: tex.reduce((s, e) => s + (e.encodedBodySize || 0), 0),
      lastAt: tex.length ? Math.max(...tex.map((e) => e.responseEnd)) - t0 : 0,
    };
  }, plan);
  await b.close();
  return r;
}

const cold = await run(false);
const warmed = await run(true);
const w = await warmCost();
console.log(`${FLOORS.length + WALLS.length} 種材質全用上，第一次 build：`);
console.log(`  沒有預熱  ${cold.toFixed(0)}ms`);
console.log(`  閒置預熱後 ${warmed.toFixed(0)}ms   (${((1 - warmed / cold) * 100).toFixed(0)}% less)`);
const blocks = w.blocks.sort((a, z) => z - a);
console.log(`\n預熱本身：主執行緒被佔住 ${blocks.length} 次（>50ms），共 ${blocks.reduce((s, x) => s + x, 0).toFixed(0)}ms`);
console.log(`  最長一次 ${blocks[0]?.toFixed(0) ?? 0}ms`);
console.log(`  貼圖 ${w.files} 個檔、${(w.bytes / 1024).toFixed(0)} KB，最後一個在 ${w.lastAt.toFixed(0)}ms 到齊`);
console.log('  （成本是被移到閒置，不是消失——一塊太大照樣會被感覺到）');
server.close();
