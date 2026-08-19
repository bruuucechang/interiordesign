// Render the palette preview for any model that did not ship one.
//
//   node bench/thumbs.mjs           # 只補缺的
//   node bench/thumbs.mjs --force   # 全部重畫
//
// Poly Haven and Kenney both ship a render per model, so the palette shows the
// real thing. Quaternius does not, and a panel where half the buttons are
// photographs and half are line pictograms reads as half-finished — worse, the
// pictogram is the same rounded rectangle for a wardrobe, a bookcase and a
// chest of drawers, which is the exact problem the previews were added to fix.
//
// Deliberately NOT the app: this is a bare three.js page with `alpha: true`, so
// the background is transparent like the shipped thumbnails. Rendering through
// the app would put a floor, walls and a sky behind every icon.
//
// Headless, same reason as the other harnesses.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MODELS = join(ROOT, 'client/public/models');
const FORCE = process.argv.includes('--force');
const PX = 128;

const manifest = JSON.parse(await readFile(join(MODELS, 'manifest.json'), 'utf8'));
const todo = Object.entries(manifest.models)
  .filter(([id]) => FORCE || !existsSync(join(MODELS, id, 'thumb.png')));
if (!todo.length) { console.log('每個模型都有預覽圖了'); process.exit(0); }
console.log(`${todo.length} 個模型缺預覽圖`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' };

// three comes straight from node_modules — the app's build has it bundled into
// a chunk that cannot be imported from outside.
let PAGE = '';
const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    // 這一頁一定要由這個 server 自己發。用 page.setContent 塞的話 document 的
    // origin 是 about:blank，importmap 指到 http://127.0.0.1 就是跨來源，模組
    // 靜默不執行——沒有 pageerror、沒有 404，只有一個等不到的 __ready。
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE); return;
    }
    const f = p.startsWith('/three/') ? join(ROOT, 'node_modules/three', p.slice(7))
            : p.startsWith('/models/') ? join(MODELS, p.slice(8))
            : null;
    if (!f || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    res.end(await readFile(f));
  });
  s.listen(0, () => ok(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
page.on('pageerror', (e) => console.error('PAGEERROR', String(e).split('\n')[0]));
PAGE = `<!doctype html><meta charset=utf8>
<script type="importmap">{"imports":{"three":"${base}/three/build/three.module.js","three/addons/":"${base}/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
R.setSize(${PX * 3}, ${PX * 3});                       // 3x 再縮小，等於超取樣
R.setClearColor(0x000000, 0);
R.toneMapping = THREE.ACESFilmicToneMapping;
R.outputColorSpace = THREE.SRGBColorSpace;
const pmrem = new THREE.PMREMGenerator(R);
const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
window.__thumb = async (url) => {
  const scene = new THREE.Scene();
  scene.environment = env;
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 4); scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const gltf = await new GLTFLoader().loadAsync(url);
  const o = gltf.scene;
  const box = new THREE.Box3().setFromObject(o);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = 1 / Math.max(size.x, size.y, size.z);       // 每一件都填滿同一個框
  o.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  o.scale.setScalar(s);
  scene.add(o);
  // 等角視角，跟 Kenney 出的那批預覽圖同一個角度，面板才不會一半俯視一半側視
  const cam = new THREE.OrthographicCamera(-0.8, 0.8, 0.8, -0.8, 0.01, 20);
  cam.position.set(2, 1.7, 2); cam.lookAt(0, 0.42, 0);
  R.render(scene, cam);
  return R.domElement.toDataURL('image/png');
};
window.__ready = 1;
</script>`;
await page.goto(base);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });

let ok = 0, bad = 0;
for (const [id, m] of todo) {
  try {
    const data = await page.evaluate((u) => window.__thumb(u), `${base}/models/${id}/${m.file}`);
    await mkdir(join(MODELS, id), { recursive: true });
    await writeFile(join(MODELS, id, 'thumb.png'), Buffer.from(data.split(',')[1], 'base64'));
    ok++;
  } catch (e) {
    console.error(`  ✗ ${id}: ${String(e).split('\n')[0].slice(0, 90)}`);
    bad++;
  }
}
console.log(`${ok} 張畫好${bad ? `，${bad} 張失敗` : ''} → ${PX * 3}px（面板顯示 60px，多的解析度給 Retina）`);
await browser.close();
server.close();
