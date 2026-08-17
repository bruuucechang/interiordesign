// 把「四道牆圍成一根柱子」換成一根實心的牆。
//
//   node scripts/solid-columns.mjs <plan-id> [--apply]
//
// 柱子在這份圖裡是使用者自己的畫法：四道牆包住原圖上的黑塊。那在 2D 沒問題，但在
// 3D 它畫出來比黑塊**大一整個牆厚**（每邊各 7.5cm），所以柱子會凸出它嵌著的那道牆。
// 牆角補上半厚度之後缺口沒了、變成完整的長方體，這件事就更明顯。
//
// 一根柱子不需要新的物件種類：一道 `thickness` 等於短邊、中心線沿長邊的牆，本來就
// 是一個實心長方體，而且 2D 的填充、房間偵測、選取與編輯全部照舊。
//
// 尺寸取**原圖量到的黑塊**（＝四道牆中心線圍出來的矩形），不是它們的內圈。實測柱面
// 相對相鄰牆面：四道牆的版本凸出 8.4–12.1cm，內圈縮進 2.9–6.6cm（另一種縫），
// 中心線矩形是 +0.9–+4.6cm，幾乎齊平。
import { readFileSync } from 'node:fs';

const API = 'http://127.0.0.1:8791';
const id = process.argv[2];
const apply = process.argv.includes('--apply');
if (!id) { console.error('用法: node scripts/solid-columns.mjs <plan-id> [--apply]'); process.exit(2); }

const res = await fetch(`${API}/api/projects/${id}`);
if (!res.ok) { console.error(`讀不到 ${id}（HTTP ${res.status}）`); process.exit(2); }
const stored = await res.json();
const floor = stored.data.floors[0];
const walls = floor.objects.filter((o) => o.kind === 'wall');

const near = (a, b) => Math.abs(a - b) < 0.6;
const horiz = (w) => near(w.a.y, w.b.y);
const vert = (w) => near(w.a.x, w.b.x);
const xs = (w) => [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)];
const ys = (w) => [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)];

// 一根柱子＝兩道等長的水平牆 ＋ 兩道等長的垂直牆，四個端點兩兩相接，而且都短。
const found = [];
const taken = new Set();
for (const top of walls) {
  if (taken.has(top.id) || !horiz(top)) continue;
  const [x0, x1] = xs(top);
  if (x1 - x0 > 200) continue;
  const pair = walls.find((w) => w !== top && horiz(w) && !taken.has(w.id)
    && near(...xs(w).map((v, i) => [v, [x0, x1][i]]).flat().slice(0, 2))
    && near(xs(w)[0], x0) && near(xs(w)[1], x1) && Math.abs(w.a.y - top.a.y) > 20 && Math.abs(w.a.y - top.a.y) < 200);
  if (!pair) continue;
  const [y0, y1] = [Math.min(top.a.y, pair.a.y), Math.max(top.a.y, pair.a.y)];
  const sides = walls.filter((w) => vert(w) && !taken.has(w.id)
    && near(ys(w)[0], y0) && near(ys(w)[1], y1) && (near(w.a.x, x0) || near(w.a.x, x1)));
  if (sides.length !== 2) continue;
  found.push({ x0, x1, y0, y1, members: [top, pair, ...sides] });
  for (const m of [top, pair, ...sides]) taken.add(m.id);
}

console.log(`${id}：牆 ${walls.length} 道，找到 ${found.length} 根四道牆的柱子`);
const keep = floor.objects.filter((o) => !taken.has(o.id));
let n = 0;
for (const c of found) {
  const w = c.x1 - c.x0, h = c.y1 - c.y0;
  const thickness = Math.round(Math.min(w, h) * 10) / 10;
  const solid = w >= h
    ? { a: { x: c.x0, y: (c.y0 + c.y1) / 2 }, b: { x: c.x1, y: (c.y0 + c.y1) / 2 } }
    : { a: { x: (c.x0 + c.x1) / 2, y: c.y0 }, b: { x: (c.x0 + c.x1) / 2, y: c.y1 } };
  keep.push({
    id: `column_${++n}`, kind: 'wall', layer: c.members[0].layer,
    ...solid, thickness, finish: c.members[0].finish ?? 'paint',
  });
  console.log(`  (${c.x0.toFixed(0)},${c.y0.toFixed(0)})–(${c.x1.toFixed(0)},${c.y1.toFixed(0)})`
    + `  ${w.toFixed(1)}×${h.toFixed(1)} → 一道厚 ${thickness} 的牆，四道換一道`);
}
if (!found.length) { console.log('沒有可換的柱子'); process.exit(0); }
floor.objects = keep;
console.log(`牆 ${walls.length} → ${walls.length - found.length * 4 + found.length} 道；物件總數 → ${floor.objects.length}`);

if (!apply) { console.log('\n（乾跑。加 --apply 才會寫回去）'); process.exit(0); }
const put = await fetch(`${API}/api/projects/${id}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: stored.name, data: stored.data }),
});
console.log(`PUT /api/projects/${id} →`, put.status);
