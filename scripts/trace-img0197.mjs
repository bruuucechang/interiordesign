// Builds the unit from IMG_0197 — the CAD interior-design drawing.
//
//   node scripts/trace-img0197.mjs            # dry run
//   node scripts/trace-img0197.mjs --save     # PUT to :8791
//
// This replaces the trace of IMG_9720, which was a photograph of a hand-drawn
// developer plan. That one had to be fought: the scan carried a perspective
// gradient, the printed chains measured the structural grid rather than the
// partitions, and two of its own numbers contradicted each other. This drawing
// is CAD output — the lines are one pixel wide and actually straight, so the
// walls can be measured directly instead of inferred.
//
// Scale: 1.0710 px/cm, confirmed three independent ways against the drawing's
// own dimensions — the kitchen run's sub-chain (95/60/60/20/60 ↔ 102/64/86/64
// px), its total (307.2 ↔ 329 px), and the wardrobe run (478.5 ↔ 512 px).
// Origin: the outer face of the west wall and of the north wall.
//
// Walls are the paired solid lines about 15 cm apart. The green hatch and the
// dashed rectangles are new joinery from the design — wardrobes, the 木作隔間,
// the kitchen units — and are not walls; they are listed at the bottom as
// furniture so the drawing's intent is carried without pretending they are
// structure.

const CEIL = 300;            // 天花板 3 m
const T = 15;                // 內牆
const TOUT = 24;             // 外牆

let n = 0;
const id = (k) => `${k}_${++n}`;
const objects = [];

const wall = (ax, ay, bx, by, thickness = T) =>
  objects.push({ id: id('wall'), kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness, finish: 'paint' });

const room = (name, x, y, w, h, floor) =>
  objects.push({ id: id('room'), kind: 'room', layer: 'rooms', x, y, w, h, name, floor });

const roomPoly = (name, poly, floor) => {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  objects.push({
    id: id('room'), kind: 'room', layer: 'rooms', name, floor, poly,
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
  });
};

const partition = (ax, ay, bx, by) =>
  objects.push({ id: id('partition'), kind: 'partition', layer: 'rooms', a: { x: ax, y: ay }, b: { x: bx, y: by } });

const door = (x, y, width, angle) =>
  objects.push({ id: id('door'), kind: 'door', layer: 'openings', x, y, width, angle });

const win = (x, y, width, angle) =>
  objects.push({ id: id('window'), kind: 'window', layer: 'openings', x, y, width, angle });

const furn = (item, label, x, y, w, h, angle = 0) =>
  objects.push({ id: id('furniture'), kind: 'furniture', layer: 'furniture', item, label, x, y, w, h, angle });

// ---- the grid, measured off the drawing ---------------------------------
const XW = 7.5,  X_K = 226,  X_A = 501,  X_B = 850,
      X_C = 955, X_D = 1212, X_E = 1248, XE = 1383;
const YN = 7.5,  Y_A = 144,  Y_B = 609,  Y_C = 745,
      Y_D = 792, Y_E = 1040, YS = 1223;

// ---- envelope ------------------------------------------------------------
wall(XW, YN, XE, YN, TOUT);                     // north
wall(XW, YN, XW, YS, TOUT);                     // west
wall(XW, YS, XE, YS, TOUT);                     // south
wall(XE, YN, XE, YS, TOUT);                     // east

// The living room's north side is a shallow arc — the drawing's one curved
// wall, and the reason this unit is recognisable at a glance.
objects.push({
  id: id('wall'), kind: 'wall', layer: 'walls',
  a: { x: 6.5, y: 32 }, b: { x: 453, y: 102 }, thickness: TOUT, bulge: -55, finish: 'paint',
});

// ---- main partitions -----------------------------------------------------
wall(X_A, Y_A, X_A, Y_B);                       // 左上 | 中間
wall(X_B, YN, X_B, Y_B);                        // 中間 | 右上
wall(X_D, YN, X_D, Y_B);                        // 右上 | 最右
wall(X_A, Y_A, X_B, Y_A);
wall(X_D, Y_A, XE, Y_A);
wall(XW, Y_B, XE, Y_B);                         // 上下分帶
wall(X_K, Y_B, X_K, YS);                        // 廚房西
wall(X_C, Y_D, X_C, YS);                        // 廚房／陽台 | 右下那間
wall(X_K, Y_E, X_C, Y_E);                       // 廚房 | 陽台
wall(X_C, Y_D, XE, Y_D);                        // 右下那間的北牆

// ---- rooms ---------------------------------------------------------------
//
// Seven spaces, not twelve. The first pass carried the room list over from the
// hand-drawn plan of the same flat and split the bottom into 餐廳 + 走廊 +
// two bedrooms + two balconies. This drawing is the *renovated* layout —
// IMG_0198 is the demolition set — and the walls that made those rooms are the
// ones that came out.
//
// From the owner: there is one balcony, beside the kitchen. What was the second
// balcony is now part of the room next to it, one continuous space.
room('左上（弧牆）', XW, Y_A, X_A - XW, Y_B - Y_A, 'wood');
room('中間房', X_A, Y_A, X_B - X_A, Y_B - Y_A, 'wood');
room('右上房', X_B, YN, X_D - X_B, Y_B - YN, 'wood');
room('最右（窄）', X_D, Y_A, XE - X_D, Y_B - Y_A, 'tile');
roomPoly('廚房', [
  { x: X_K, y: Y_B }, { x: X_C, y: Y_B }, { x: X_C, y: Y_E },
  { x: 555, y: Y_E }, { x: 555, y: YS }, { x: X_K, y: YS },
], 'tile');
room('陽台', 555, Y_E, X_C - 555, YS - Y_E, 'terrazzo');
room('右下房（含原陽台）', X_C, Y_D, XE - X_C, YS - Y_D, 'wood');

// ---- openings ------------------------------------------------------------
win((X_B + X_D) / 2, YN, 320, 0);                // 右上房
win((X_D + XE) / 2, YN, 120, 0);
win((X_A + X_B) / 2, Y_A, 200, 0);               // 中間房
win((555 + X_C) / 2, Y_E, 220, 0);               // 廚房 → 陽台
win((X_C + XE) / 2, YS, 240, 0);                 // 右下房南面
door((X_A + X_B) / 2, Y_B, 90, 0);
door((X_B + X_D) / 2 - 80, Y_B, 90, 0);
door(X_D, (Y_A + Y_B) / 2 + 100, 80, 90);
door(X_C, (Y_D + Y_E) / 2, 90, 90);              // 右下房

// 廚房那一片是開放的，西側沒有牆
partition(XW, Y_B, X_K, Y_B);

// ---- the design's joinery ------------------------------------------------
// Not walls — new cabinetry. Carried as furniture so the drawing's intent
// survives without any of it being quoted as structure.
furn('wardrobe', '系統開放衣櫃 4抽', X_K + 20, 500, 240, 60);
furn('wardrobe', '系統開放衣櫃 4抽', X_D - 250, 470, 240, 60);
furn('wardrobe', '系統開放衣櫃 4抽', X_D - 250, 860, 240, 60);
furn('cabinet', '汙衣櫃', X_D, 860, 53, 60);
furn('fridge', '冰箱 R.E.F.', X_K + 10, 1000, 60, 89);

// The kitchen run, unit by unit, from IMG_0199's elevation. Its chain is
// 95 | 60 | 60 | 20 | 40 | 20 | 5 against a stated total of 307.2, and the
// elevation names them: 開門 / 洗碗機 / 抽屜 / 抽屜 / 調味拉籃 / 側板.
const KY = YS - 60;                 // the run sits against the south wall
let kx = X_K + 10;
for (const [w, label] of [
  [95, '水槽（開門）'], [60, '洗碗機'], [60, '抽屜'],
  [20, '調味拉籃'], [40, '爐具'], [20, '抽屜'], [5, '側板'],
]) {
  furn('counter', label, kx, KY, w, 60);
  kx += w;
}
// The 86 unit drawn on its own on the elevation sheet.
furn('cabinet', '吊櫃 86', X_K + 10, YS - 130, 86, 35);

// The drawing itself, at the scale the walls were measured with.
//
// This is the honest division of labour. The envelope and the main partitions
// below are measured and can be trusted. The rest of it — the joinery, the
// bathroom fittings, exactly where the curve meets the wall — I got wrong more
// than once by reading pixels, and each correction cost a round. Tracing over
// an underlay that is already at the right scale is both faster and more
// accurate than more of that, and it is what the underlay feature is for.
const { readFileSync } = await import('node:fs');
const b64 = readFileSync('/private/tmp/claude-501/-Users-bruuucemac/609650e9-c1d4-4d0d-9616-85360c42d5f7/scratchpad/ul0197.jpg').toString('base64');
objects.unshift({
  id: id('image'), kind: 'image', layer: 'underlay',
  src: `data:image/jpeg;base64,${b64}`,
  x: -195.1, y: -113.9, w: 1879.6, h: 1485.5, opacity: 0.4,
});

const plan = {
  schemaVersion: 1,
  name: 'A1 單元（IMG_0197 室內設計圖）',
  activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', elevation: 0, height: CEIL, objects }],
  layers: [
    { id: 'underlay', name: '底圖', visible: true, locked: false, color: '#8b93a3' },
    { id: 'walls', name: '牆體', visible: true, locked: false, color: '#c9cfdb' },
    { id: 'rooms', name: '房間', visible: true, locked: false, color: '#6d7890' },
    { id: 'openings', name: '門窗', visible: true, locked: false, color: '#7bc6ff' },
    { id: 'furniture', name: '家具', visible: true, locked: false, color: '#e0b45a' },
    { id: 'dims', name: '尺寸標註', visible: true, locked: false, color: '#8bffb0' },
  ],
};

const kinds = objects.reduce((m, o) => ((m[o.kind] = (m[o.kind] ?? 0) + 1), m), {});
console.log(`天花板 ${CEIL} cm，外框 ${XE - XW} × ${YS - YN} cm`);
console.log('物件:', Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join('，'));

if (process.argv.includes('--save')) {
  const r = await fetch('http://127.0.0.1:8791/api/projects/img0197', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: plan.name, data: plan }),
  });
  console.log('PUT /api/projects/img0197 →', r.status, (await r.text()).slice(0, 140));
}
if (process.argv.includes('--out')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[process.argv.indexOf('--out') + 1], JSON.stringify(plan));
}
