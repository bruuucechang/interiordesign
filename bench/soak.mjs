// Long-running soak + frame profile, in headless Chromium.
//
// It has to be headless. On this machine the terminal covers Chrome, so
// `document.visibilityState` is 'hidden', rAF fires zero times a second and the
// render loop stops dead — every earlier attempt to measure in a real window
// either timed out or read a frozen scene. Headless has no window to cover.
//
// Headless also has no vsync, which is a feature here: a frame is as long as
// the work in it, so the numbers are work-per-frame rather than "did it fit in
// 16.7 ms". That is the quantity we are actually trying to reduce.
//
//   node bench/soak.mjs --minutes 480          # the full eight-hour run
//   node bench/soak.mjs --minutes 2            # a smoke check
//   node bench/soak.mjs --minutes 2 --objects 400
//
// Writes one JSON line per cycle to bench/results/soak-<start>.jsonl so a run
// that is killed at hour six still leaves six hours of evidence.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'client/dist');

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const MINUTES = arg('minutes', 480);
const OBJECTS = arg('objects', 120);
const CYCLE_MS = arg('cycle', 60_000);      // how often to bank a sample

// ---------------------------------------------------------------- static server

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
};

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    // The app talks to a backend that is not running here. Answer its calls
    // rather than letting them hang: a soak must exercise the renderer, not
    // Chromium's connection timeout.
    if (path.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      // Real shapes, not `{}`. A stub that answers with the wrong shape sends
      // every reader down its offline path, and then the soak is measuring
      // error handling rather than the renderer.
      res.end(JSON.stringify(
        path === '/api/projects' ? { projects: [] }
        : path.startsWith('/api/rooms') ? { polygons: [] }
        : path.startsWith('/api/dimensions') ? { dimensions: [] }
        : {},
      ));
      return;
    }
    let file = join(DIST, path === '/' ? 'index.html' : path);
    if (!existsSync(file)) file = join(DIST, 'index.html');
    try {
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return new Promise((ok) => server.listen(0, () => ok(server)));
}

// ---------------------------------------------------------------- synthetic plan

/**
 * A plan big enough to be work, laid out as a grid of rooms.
 *
 * Real plans on this machine top out at 13 objects, which is far too small to
 * show a per-object cost. Soaking at 120+ is deliberate headroom: the point is
 * to find what degrades, and a plan that never stresses the loop never will.
 */
function plan(n) {
  const objects = [];
  const cols = Math.ceil(Math.sqrt(n / 4));
  let i = 0;
  const id = (k) => `${k}_${++i}`;
  for (let r = 0; r < cols && objects.length < n; r++) {
    for (let c = 0; c < cols && objects.length < n; c++) {
      const x = c * 420, y = r * 380;
      const w = 400, h = 360;
      objects.push({ id: id('wall'), kind: 'wall', layer: 'walls', a: { x, y }, b: { x: x + w, y }, thickness: 12 });
      objects.push({ id: id('wall'), kind: 'wall', layer: 'walls', a: { x, y }, b: { x, y: y + h }, thickness: 12 });
      objects.push({ id: id('room'), kind: 'room', layer: 'rooms', x, y, w, h, name: `房間 ${r}-${c}` });
      objects.push({
        id: id('furniture'), kind: 'furniture', layer: 'furniture',
        item: 'sofa', label: '沙發', x: x + 60, y: y + 60, w: 180, h: 80, angle: (r * 37 + c * 53) % 360,
      });
      if (objects.length < n) {
        objects.push({ id: id('door'), kind: 'door', layer: 'openings', x: x + w / 2, y, width: 90, angle: 0 });
      }
    }
  }
  return {
    schemaVersion: 1,
    name: `soak ${objects.length} 物件`,
    floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects }],
    activeFloorId: 'f1',
    layers: [
      { id: 'walls', name: '牆', color: '#e6e9ef', visible: true },
      { id: 'rooms', name: '房間', color: '#4c8dff', visible: true },
      { id: 'furniture', name: '家具', color: '#ffd479', visible: true },
      { id: 'openings', name: '門窗', color: '#8bffb0', visible: true },
    ],
  };
}

// ---------------------------------------------------------------- driving

/**
 * One cycle of what a person actually does: drag the view around, drag an
 * object, zoom in and out. Pointer events go through Chromium's real input
 * pipeline, so coalescing and event rates behave as they do in a browser.
 */
async function exercise(page) {
  // Page coordinates, not canvas ones. vp.toScreen is relative to the canvas,
  // which sits below a toolbar and beside a sidebar; feeding those numbers to
  // page.mouse puts every event outside the canvas, and the drag quietly
  // becomes a pan. This exercise did exactly that until it was measured.
  const geo = await page.evaluate(() => {
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  });
  const cx = geo.l + geo.w / 2, cy = geo.t + geo.h / 2;

  // pan around empty space
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 0; k < 30; k++) {
    await page.mouse.move(cx + Math.sin(k / 6) * (geo.w / 4), cy + Math.cos(k / 5) * (geo.h / 4));
  }
  await page.mouse.up();

  // zoom out and back in
  for (let k = 0; k < 10; k++) await page.mouse.wheel(0, 120);
  for (let k = 0; k < 10; k++) await page.mouse.wheel(0, -120);

  // drag a multi-selection — the expensive path, and the one a roaming pointer
  // never finds on its own
  const at = await page.evaluate((n) => {
    const objs = window.__app.doc.objects.filter((o) => o.kind === 'furniture').slice(0, n);
    if (!objs.length) return null;
    window.__app.doc.selectMany(objs.map((o) => o.id));
    const o = objs[0];
    const p = window.__app.editor.vp.toScreen({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, 8);
  if (at) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let k = 0; k < 30; k++) await page.mouse.move(at.x + (k % 20) * 5, at.y + Math.sin(k / 4) * 40);
    await page.mouse.up();
    await page.evaluate(() => window.__app.doc.select(null));
  }

  // switch to 3D and back: exercises build(), the resolution ladder and the
  // primary/preview swap, which is where a leak would hide
  await page.evaluate(() => document.getElementById('btnToggle')?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('btnToggle')?.click());
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------- run

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/?perf=1`;
await mkdir(join(ROOT, 'bench/results'), { recursive: true });

const started = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(ROOT, `bench/results/soak-${started}.jsonl`);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--js-flags=--expose-gc'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

// Keep the stack, not just the message. A soak that reports
// "TypeError: reading 'map'" with no location has found a bug and then hidden
// it — build with `vite build --sourcemap --minify false` to get real names.
const errors = [];
const note = (s) => { if (errors.length < 40) errors.push(String(s).split('\n').slice(0, 4).join(' | ').slice(0, 500)); };
page.on('pageerror', (e) => note(e.stack || e));
page.on('console', (m) => { if (m.type() === 'error') note(m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const ready = await page.evaluate(() => !!(window.__perf && window.__app));
if (!ready) {
  console.error('window.__perf / window.__app 不存在——?perf=1 沒生效，或 client/dist 是舊的（先跑 npm run build）');
  process.exit(1);
}

// Load through the document rather than through localStorage: the boot path
// goes via the backend, which is not running here, and a plan that never
// arrives makes for a very fast and very meaningless soak.
await page.evaluate((p) => { window.__app.doc.load(p); window.__app.fit2D(); }, plan(OBJECTS));
await page.waitForTimeout(2500);

const n = await page.evaluate(() => window.__app.doc.objects.length);
if (!n) { console.error('平面圖沒有載入'); process.exit(1); }
console.log(`載入 ${n} 個物件`);

console.log(`soak: ${MINUTES} 分鐘, ${OBJECTS} 物件, 每 ${CYCLE_MS / 1000}s 一筆 → ${out}`);

const deadline = Date.now() + MINUTES * 60_000;
let cycle = 0;
while (Date.now() < deadline) {
  const t0 = Date.now();
  await page.evaluate(() => window.__perf.reset());
  while (Date.now() - t0 < CYCLE_MS && Date.now() < deadline) {
    await exercise(page);
  }
  const sample = await page.evaluate(() => ({
    perf: window.__perf.snapshot(),
    heap: performance.memory ? performance.memory.usedJSHeapSize : null,
    nodes: document.getElementsByTagName('*').length,
  }));
  const row = {
    cycle: cycle++,
    at: new Date().toISOString(),
    elapsedMin: +((Date.now() - (deadline - MINUTES * 60_000)) / 60_000).toFixed(2),
    ...sample,
    errors: errors.splice(0, errors.length),
  };
  await appendFile(out, JSON.stringify(row) + '\n');
  const r2 = row.perf.render2d, r3 = row.perf.render3d;
  console.log(
    `#${row.cycle} ${row.elapsedMin}min  2D ${r2.count}幀 p50 ${r2.p50.toFixed(2)}ms p95 ${r2.p95.toFixed(2)}  ` +
    `3D ${r3.count}幀 p50 ${r3.p50.toFixed(2)}ms  heap ${row.heap ? (row.heap / 1048576).toFixed(0) + 'MB' : '—'}` +
    (row.errors.length ? `  ⚠︎ ${row.errors.length} 個錯誤` : ''),
  );
}

await browser.close();
server.close();
console.log('完成 →', out);
