// 家具在 3D 的大小要等於它宣告的 w/h，而且拉伸要跟著變。
//
//   node bench/verify-stretch.mjs [base-url]
//
// 模型是等比縮放時這件事會安靜地失守：照片測量的模型目錄尺寸就是模型尺寸，縮放
// 倍率剛好 1，所以看不出來；而 Kenney 那套做在固定格線上，尺寸跟真實無關，取
// min() 之後 94 件裡有 19 件比宣告的短超過 10cm，最糟的是 180cm 的廚櫃渲成 54cm。
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
await p.addInitScript(() => {
  // Benches are not testing onboarding, and the first-run tour would eat the
  // first Escape (its capture listener) and cover the app with an overlay.
  try { localStorage.setItem('interior_tour_seen', '1'); } catch { /* ignore */ }
});

const errs = [];
p.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await p.goto(`${BASE}/?perf=1`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);

let fails = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? '✔' : '✖'} ${n}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

// 真的去量場景裡的實例，不要用算式反推——那會變成套套邏輯。furnGroup 底下每個
// 子物件就是一件家具，順序跟 doc 裡的家具一致。包圍盒用 geometry 的 position 屬性
// 加 matrixWorld 自己算，因為頁面裡沒有 THREE 可以用。
const r = await p.evaluate(async () => {
  const a = window.__app;
  const man = await (await fetch('models/manifest.json')).json();
  const pick = ['cabinet_kitchen', 'wardrobe', 'shoe_cabinet', 'sofa', 'dining', 'tv_wall'];
  const items = a.FURNITURE.filter((f) => pick.includes(f.id));
  const objs = [{ id: 'r', kind: 'room', layer: 'rooms', x: 0, y: 0, w: 2200, h: 1000, name: 'x', floor: 'wood' }];
  let x = 60;
  items.forEach((it, i) => {
    objs.push({ id: `f${i}`, kind: 'furniture', layer: 'furniture', item: it.id, label: it.id, angle: 0, x, y: 60, w: it.w, h: it.h, ...(it.height ? { height: it.height } : {}) });
    x += it.w + 80;
  });
  const w0 = items.find((f) => f.id === 'cabinet_kitchen') ?? items[0];
  objs.push({ id: 'stretched', kind: 'furniture', layer: 'furniture', item: w0.id, label: 'stretched', angle: 0, x: 60, y: 600, w: w0.w * 2, h: w0.h, ...(w0.height ? { height: w0.height } : {}) });
  document.querySelector('.view-modes button[data-mode="3d"]').click();
  a.doc.load({ schemaVersion: 1, name: 's', activeFloorId: 'f1',
    floors: [{ id: 'f1', name: '1F', base: 0, height: 270, objects: objs }],
    layers: [{ id: 'rooms', name: '房', color: '#4c8dff', visible: true },
             { id: 'furniture', name: '家具', color: '#e0b45a', visible: true }] });
  await new Promise((r2) => setTimeout(r2, 26000));

  const measure = (node) => {
    node.updateMatrixWorld(true);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    node.traverse((n) => {
      const pos = n.geometry?.attributes?.position;
      if (!pos) return;
      const m = n.matrixWorld.elements;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const v = [m[0] * x + m[4] * y + m[8] * z + m[12],
                   m[1] * x + m[5] * y + m[9] * z + m[13],
                   m[2] * x + m[6] * y + m[10] * z + m[14]];
        for (let k = 0; k < 3; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; }
      }
    });
    return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  };
  const furn = a.doc.objects.filter((z) => z.kind === 'furniture');
  const kids = a.view3d.furnGroup.children;
  const out = [];
  furn.forEach((o, i) => {
    const node = kids[i];
    if (!node) { out.push({ id: o.label, missing: true }); return; }
    const [bw, bh, bd] = measure(node);
    out.push({ id: o.label, want: [o.w, o.h], got: [+bw.toFixed(1), +bd.toFixed(1)], height: +bh.toFixed(0),
               hasModel: !!man.models[o.item] });
  });
  return { out, baseW: w0.w, baseH: w0.height ?? null };
});

for (const m of r.out) {
  if (m.missing) { check(`${m.id} 有實例`, false); continue; }
  check(`${m.id} 的 3D 大小等於宣告值`,
    Math.abs(m.got[0] - m.want[0]) < 2 && Math.abs(m.got[1] - m.want[1]) < 2,
    `量到 ${m.got[0]}×${m.got[1]}／宣告 ${m.want[0]}×${m.want[1]}，高 ${m.height}`);
}
const st = r.out.find((m) => m.id === 'stretched');
check('拉寬成兩倍時模型跟著變寬', st && Math.abs(st.got[0] - r.baseW * 2) < 2,
  st ? `${st.got[0]} / ${r.baseW * 2}` : '');
// 檯面不該因為拉長而變高
const base = r.out.find((m) => m.id === 'cabinet_kitchen');
check('拉寬不會把高度一起拉高', st && base && Math.abs(st.height - base.height) <= 2,
  st && base ? `拉寬後 ${st.height} / 原本 ${base.height}` : '');
check('全程沒有例外', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
await b.close();
process.exit(fails ? 1 : 0);
