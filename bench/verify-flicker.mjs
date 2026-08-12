// Orbits the 3D camera and looks for flicker.
//
// Two things reported it: the floor texture breaking up, and walls vanishing.
// Both are frame-to-frame instability, which no unit test can see — the scene
// graph is identical either way, it is the depth buffer and a visibility rule
// that change their minds. So: take frames along a slow orbit, and measure how
// much of each frame differs from the one before in a *speckled* way (many
// small scattered changes) rather than a smooth one (the camera moved).
//
//   node bench/verify-flicker.mjs <plan.json>
//   node bench/verify-flicker.mjs <plan.json> --walk
//
// **What this can and cannot show.** The still-camera control is trustworthy:
// frames come back byte-identical, so there is no temporal noise. The moving
// comparison is not — at any step large enough to matter the image changes
// because the camera moved, and at a step small enough not to, sub-pixel
// resampling along every edge looks the same as speckle. It measured 0.247%
// before a set of depth-precision fixes and 0.242% after, which says nothing
// about either. `--walk` currently times out on the screenshot.
//
// It is kept because the control is worth having and because the next person
// should not have to rediscover that the moving half does not work.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = resolve(import.meta.dirname, '..'), DIST = join(ROOT, 'client/dist');
const PLAN = process.argv[2];
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json' };
const server = await new Promise(ok => { const s = createServer(async (req,res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/api/')) { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify(p==='/api/projects'?{projects:[]}:{polygons:[]})); return; }
  let f = join(DIST, p==='/'?'index.html':p); if (!existsSync(f)) f = join(DIST,'index.html');
  res.writeHead(200,{'content-type':MIME[extname(f)]??'application/octet-stream'}); res.end(await readFile(f));
}); s.listen(0,()=>ok(s)); });

const plan = JSON.parse(await readFile(PLAN, 'utf8'));
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 900, height: 640 } });
await page.goto(`http://127.0.0.1:${server.address().port}/?perf=1`);
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.view-modes button[data-mode="3d"]').click());
await page.waitForTimeout(800);
await page.evaluate(p => window.__app.doc.load(p), plan);
await page.waitForTimeout(3000);

// A tenth of a degree between frames, not ten degrees: at ten the whole image
// changes because the camera moved, and no amount of speckle analysis can pull
// flicker back out of that. Plus a control run with the camera completely
// still — anything that differs there is flicker and nothing else.
// Two viewpoints, because they fail differently.
//
//   orbit — outside, looking down. This is what a screenshot looks like.
//   walk  — inside at eye level, panning. This is what a person actually does,
//           and it is where depth precision fails: a floor seen at a grazing
//           angle stretches a few centimetres of geometry across most of the
//           screen, so any depth argument it is having becomes the whole view.
const WALK = process.argv.includes('--walk');
const N = 40, R = 1900, H = 900, STEP = 0.1;
const frames = [];
for (let i = 0; i < N; i++) {
  await page.evaluate(({ i, R, H, STEP, WALK }) => {
    const v = window.__app.view3d;
    const a = (0.7 + i * STEP * Math.PI / 180);
    if (WALK) {
      // Standing in the living room at eye level, turning slowly.
      v.camera.position.set(250, 160, 350);
      v.controls.target.set(250 + Math.cos(a) * 600, 120, 350 + Math.sin(a) * 600);
    } else {
      v.camera.position.set(688 + Math.cos(a) * R, H, 630 + Math.sin(a) * R);
      v.controls.target.set(688, 40, 630);
    }
    v.controls.update();
  }, { i, R, H, STEP, WALK });
  await page.waitForTimeout(260);
  // Whole page, not the canvas element: Playwright waits for an element to be
  // "stable" before shooting it, and a canvas that is rendering every frame
  // never is. The surrounding UI is static so it contributes nothing to the
  // diff anyway.
  frames.push(PNG.sync.read(await page.screenshot()));
}
// 對照組：相機完全不動
const still = [];
for (let i = 0; i < 6; i++) { await page.waitForTimeout(300); still.push(PNG.sync.read(await page.screenshot())); }
await b.close(); server.close();

// Speckle: pixels that changed a lot while most of their neighbourhood did not.
function speckle(a, c) {
  const w = a.width, h = a.height;
  let changed = 0, total = w * h;
  const diff = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const j = i * 4;
    const d = Math.abs(a.data[j] - c.data[j]) + Math.abs(a.data[j+1] - c.data[j+1]) + Math.abs(a.data[j+2] - c.data[j+2]);
    if (d > 60) { diff[i] = 1; changed++; }
  }
  // isolated changed pixels = flicker; contiguous regions = the camera moved
  let isolated = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!diff[i]) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (diff[i + dy * w + dx]) n++;
    if (n <= 3) isolated++;
  }
  return { changedPct: changed / total * 100, specklePct: isolated / total * 100 };
}

let worst = 0, worstAt = -1, sum = 0;
for (let i = 1; i < frames.length; i++) {
  const s = speckle(frames[i - 1], frames[i]);
  sum += s.specklePct;
  if (s.specklePct > worst) { worst = s.specklePct; worstAt = i; }
}
console.log(`${WALK ? '室內視角' : '外部軌道'}：${N} 格，每格轉 ${STEP}°`);
console.log(`  細碎閃爍像素  平均 ${(sum/(frames.length-1)).toFixed(3)}%  最大 ${worst.toFixed(3)}%（第 ${worstAt} 格）`);
let sWorst = 0;
for (let i = 1; i < still.length; i++) sWorst = Math.max(sWorst, speckle(still[i-1], still[i]).changedPct);
console.log(`  對照組（相機不動）最大變動 ${sWorst.toFixed(3)}%`);
console.log(worst < 0.25 ? '\n· 沒有明顯閃爍' : `\n⚠︎ 第 ${worstAt} 格附近有閃爍`);

// 把最糟的那一對與差異圖存下來 —— 知道「在閃什麼」比知道「有在閃」有用
if (process.argv.includes('--dump') && worstAt > 0) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const dir = join(ROOT, 'bench/results/shots');
  mkdirSync(dir, { recursive: true });
  const a = frames[worstAt - 1], c = frames[worstAt];
  const out = new PNG({ width: a.width, height: a.height });
  for (let i = 0; i < a.width * a.height; i++) {
    const j = i * 4;
    const d = Math.abs(a.data[j] - c.data[j]) + Math.abs(a.data[j+1] - c.data[j+1]) + Math.abs(a.data[j+2] - c.data[j+2]);
    const on = d > 60;
    out.data[j] = on ? 255 : 20; out.data[j+1] = on ? 0 : 20; out.data[j+2] = on ? 0 : 20; out.data[j+3] = 255;
  }
  writeFileSync(join(dir, 'flicker-a.png'), PNG.sync.write(a));
  writeFileSync(join(dir, 'flicker-diff.png'), PNG.sync.write(out));
  console.log('已存 flicker-a.png / flicker-diff.png');
}
