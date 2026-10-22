// Builds the flat from 平面配置圖 1151022 (docs/plan-1151022.pdf, 1/60) — the
// contractor's CAD sheet of the same A1 單元 that `img0199-restored` was traced
// from a photo of.
//
//   node scripts/trace-pdf1151022.mjs --out /tmp/p.json   # 只輸出檔案
//   node scripts/trace-pdf1151022.mjs --save              # 寫到 plan1151022（新的 id）
//
// Needs the backend on :8791 — rooms come from `/api/rooms/detect`, the same
// detector the editor uses, so the room outlines agree with the walls by
// construction.
//
// **It never writes to any img0199* id.** Those are the owner's documents
// (design-rules 6.1); this one has its own id and nothing else.
//
// ---- where the numbers come from ------------------------------------------
//
// The PDF is vector, so nothing here is read off pixels. `pdftocairo -svg`
// gives every wall as a filled black rectangle in PDF units under
// `matrix(0.12, 0, 0, -0.12, 0, 842)`; one unit is 0.254 cm (1/60 on the sheet:
// 0.12 pt × 60 = 7.2 pt = 0.254 cm). Checked against the sheet's own dimension
// lines, which span face to face:
//
//   1374 ↔ 0.0 → 1374.4 · 1227 ↔ 0.0 → 1226.8 · 480 ↔ 10.2 → 490.2
//   286 ↔ 505.2 → 791.2 · 347 ↔ 856.2 → 1203.5 · 433 ↔ 162.6 → 595.4
//   994 ↔ 244.1 → 1237.7 · 307/277/380 ↔ 244.1/551.2·566.2/842.8·857.8/1237.7
//
// Origin: x = 0 at the left end of the 1374 line, y = 0 at the top of the 1227
// line (the outside of 老媽房's window). y grows downward, like the editor.
//
// Every coordinate below is the *centre* of the two faces the PDF draws
// (design-rules 1.4), and every thickness is the distance between them.
// Hatched walls (新作隔間) are carried with their own 9.9 / 24.2 cm.
//
// ---- columns --------------------------------------------------------------
//
// A column is one wall: centre line along the long side of the black block,
// thickness = the short side (design-rules 2.1–2.3, same as collapseColumns).
// They stand free — neither end is joined to anything — so `health.ts` must
// not ask for them to be "接上" (see `isColumn` there).

import { writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:8791/api';
const PID = 'plan1151022';
const OWNER = 'own_orsxp52fbvey';     // 使用者瀏覽器的 X-Owner，跟 img0199-restored 同一個
const CEIL = 300;

// ---- wall centre lines (cm) ----------------------------------------------
const X = {
  left: 2.7,        // -4.8 / 10.2
  kitchen: 234.55,  // 225.0 / 244.1（19.1 厚）
  shaft: 415.15,    // 410.2 / 420.1（隔間 9.9）
  peterE: 497.7,    // 490.2 / 505.2
  balcony: 558.7,   // 551.2 / 566.2
  mumW: 848.7,      // 841.2 / 856.2
  bruceW: 850.3,    // 842.8 / 857.8
  bathBW: 953.1,    // 945.6 / 960.6
  east: 1211.0,     // 1203.5 / 1218.4
  bruceE: 1245.2,   // 1237.7 / 1252.7
  bathAE: 1381.9,   // 1374.4 / 1389.4
};
const Y = {
  mumN: -7.5,       // -15.0 / 0.0（老媽房三面窗）
  peterN: 86.0,     // 78.5 / 93.5
  dadN: 133.0,      // 125.5 / 140.5
  bathAN: 155.1,    // 147.6 / 162.6
  shaft: 527.0,     // 522.0 / 531.9（隔間 9.9）
  dadS: 587.9,      // 580.4 / 595.4
  peterS: 592.0,    // 587.0 / 596.9（隔間 9.9）
  bathAS: 602.9,    // 595.4 / 610.4
  bruceDoor: 731.9, // 724.4 / 739.4（門框）
  entry: 754.5,     // 747.0 / 762.0
  bruceN: 786.5,    // 779.0 / 794.0
  balconyN: 1047.4, // 1039.9 / 1054.9
  bar: 1048.9,      // 1036.8 / 1061.0（90 公分那段斜線隔間，24.2 厚）
  south: 1234.45,   // 1226.8 / 1242.1（15.3 厚）
  balconyS: 1247.5, // 1240.0 / 1255.0
};

// Peter 房北側是弧形窗：外緣 (0, 44.4)→(343.7, 78.5)，內緣 (0, 59.4)→(343.7, 93.5)，
// 中點的外內緣在 x = 172.7 是 53.3 / 68.3。中心線的弦中點與弧頂差 8.1 cm。
const ARC = { a: { x: X.left, y: 51.9 }, b: { x: 343.7, y: Y.peterN }, bulge: -8.1 };

// [ax, ay, bx, by, thickness]
const WALLS = [
  [X.left, ARC.a.y, X.left, Y.entry, 15],                 // 西外牆
  [ARC.b.x, Y.peterN, X.peterE, Y.peterN, 15],            // Peter 房北牆（弧形窗東側）
  [X.peterE, Y.peterN, X.peterE, Y.peterS, 15],           // Peter／老爸之間
  [X.left, Y.peterS, X.peterE, Y.peterS, 9.9],            // Peter 房南側隔間
  [X.shaft, Y.shaft, X.shaft, Y.peterS, 9.9],             // 管道間（圖上「80」那格）
  [X.shaft, Y.shaft, X.peterE, Y.shaft, 9.9],
  [X.peterE, Y.dadN, X.mumW, Y.dadN, 15],                 // 老爸房北牆
  [X.mumW, Y.mumN, X.mumW, Y.dadS, 15],                   // 老爸／老媽之間
  [X.mumW, Y.mumN, X.east, Y.mumN, 15],                   // 老媽房北（窗）
  [X.east, Y.mumN, X.east, Y.bruceN, 14.9],               // 老媽／衛浴 A、衛浴 B 東牆
  [X.east, Y.bathAN, X.bathAE, Y.bathAN, 15],             // 衛浴 A 北
  [X.bathAE, Y.bathAN, X.bathAE, Y.bathAS, 15],           // 衛浴 A 東
  [X.bathBW, Y.bathAS, X.bathAE, Y.bathAS, 15],           // 衛浴 A 南／衛浴 B 北
  [X.peterE, Y.dadS, X.bathBW, Y.dadS, 15],               // 老爸房南、老媽房門那一線
  [X.bathBW, Y.dadS, X.bathBW, Y.bruceN, 15],             // 衛浴 B 西
  [X.bathBW, Y.bruceN, X.bruceE, Y.bruceN, 15],           // Bruce 房北
  [X.bruceE, Y.bruceN, X.bruceE, Y.south, 15],            // Bruce 房東
  [X.bruceW, Y.south, X.bruceE, Y.south, 15.3],           // Bruce 房南
  [X.bruceW, Y.bruceDoor, X.bruceW, Y.balconyS, 15],      // Bruce 房西／陽台東
  [X.bruceW, Y.bruceDoor, X.bathBW, Y.bruceDoor, 15],     // Bruce 房門
  [X.left, Y.entry, X.kitchen, Y.entry, 15],              // 大門那道
  [X.kitchen, Y.entry, X.kitchen, Y.south, 19.1],         // 廚房西
  [X.kitchen, Y.south, X.balcony, Y.south, 15.3],         // 客廳南
  [X.balcony, Y.balconyN, X.balcony, Y.balconyS, 15],     // 陽台西
  [X.balcony, Y.balconyN, X.bruceW, Y.balconyN, 15],      // 陽台北
  [X.balcony, Y.balconyS, X.bruceW, Y.balconyS, 15],      // 陽台南
  [461.0, Y.bar, X.balcony, Y.bar, 24.2],                 // 客廳與廚房之間 90 公分隔間
];

// Black blocks [x0, x1, y0, y1] straight from the PDF fills.
const COLUMNS = [
  [-4.8, 36.1, 69.6, 173.0],       // Peter 房西北
  [791.2, 856.2, 97.5, 162.6],     // 老爸房東北
  [1203.5, 1268.5, 97.5, 162.6],   // 老媽房東北
  [225.0, 288.0, 709.9, 802.9],    // 大門旁
  [792.7, 857.8, 706.9, 802.9],    // Bruce 房西北
  [1203.5, 1268.0, 698.0, 794.0],  // 衛浴 B 東
  [225.0, 290.1, 1226.8, 1291.8],  // 廚房西南
  [792.7, 857.8, 1226.8, 1291.8],  // 陽台東南
  [1187.7, 1252.7, 1226.8, 1291.8],// Bruce 房東南
];

// Openings: [H|V, wall centre, from, to, label, hinge?, swing?, style?, angle?]
// Spans are the rough openings between the jambs the PDF draws. Hand and swing
// are read off the leaf and arc on the sheet; with angle 0 a door hinged
// 'left' sits at the west jamb and swings north (renderer.ts draws the leaf on
// −x, opening toward −y), so each row below is that convention applied.
const DOORS = [
  // 圖上是子母門；使用者在 img0199-gen 把大門改回單開，照他的
  ['H', Y.entry, 79.0, 204.2, '大門', 'left', 'in', 'single'],
  ['H', Y.peterS, 310.1, 410.2, 'Peter 房', 'left', 'in'],          // 鉸鏈在西側
  ['H', Y.dadS, 712.2, 801.1, '老爸房', 'right', 'in'],             // 鉸鏈在東側
  ['H', Y.dadS, 856.2, 945.6, '老媽房', 'left', 'in'],              // 鉸鏈在西側
  ['H', Y.bruceDoor, 857.8, 945.6, 'Bruce 房', 'right', 'in', null, 180], // 往南開，鉸鏈在西
  ['V', X.bathBW, 617.5, 697.5, '衛浴 B', 'left', 'in'],            // 鉸鏈在北，往東開
  ['V', X.east, 439.4, 518.9, '衛浴 A', 'right', 'in'],             // 鉸鏈在南，往東開
  ['V', X.balcony, 1061.0, 1137.7, '陽台', 'left', 'in', 'single'], // 鉸鏈在北，往東開
];

const WINDOWS = [
  ['H', Y.mumN, 856.2, 1021.8, '老媽房（西）'],
  ['H', Y.mumN, 1021.8, 1203.5, '老媽房（東）'],
  ['V', X.mumW, 0.0, 78.0, '老媽房西側'],
  ['V', X.east, 0.0, 78.0, '老媽房東側'],
  ['H', Y.dadN, 630.9, 791.2, '老爸房'],
  ['H', Y.peterN, 348.7, 432.8, 'Peter 房'],
  ['H', Y.bathAN, 1268.5, 1374.4, '衛浴 A'],
  ['V', X.bathAE, 162.6, 242.6, '衛浴 A 東側'],
  ['V', X.east, 613.9, 693.9, '衛浴 B'],
  ['H', Y.balconyN, 622.3, 771.7, '陽台'],
  ['H', Y.south, 353.1, 453.4, '廚房'],
  ['H', Y.south, 896.1, 1135.6, 'Bruce 房'],
  ['V', X.bruceE, 1147.1, 1226.8, 'Bruce 房東側'],
];

// Rooms are matched to detected regions by which seed point each one contains.
const NAMES = [
  [250, 330, 'Peter 房間', 'wood'],
  [670, 360, '老爸房間', 'wood'],
  [1030, 300, '老媽房間', 'wood'],
  [1296, 380, '衛浴 A', 'tile'],
  [1080, 695, '衛浴 B', 'tile'],
  [1050, 1010, 'Bruce 房間', 'wood'],
  [700, 1140, '陽台', 'terrazzo'],
  [400, 900, '客廳＋廚房', 'wood'],
];

let n = 0;
const id = (k) => `${k}_${++n}`;
const objects = [];
const wall = (ax, ay, bx, by, thickness, extra = {}) => objects.push({
  id: id('wall'), kind: 'wall', layer: 'walls',
  a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness, finish: 'paint', ...extra,
});

for (const [ax, ay, bx, by, t] of WALLS) wall(ax, ay, bx, by, t);
wall(ARC.a.x, ARC.a.y, ARC.b.x, ARC.b.y, 15, { bulge: ARC.bulge });
const r1 = (v) => Math.round(v * 100) / 100;
for (const [x0, x1, y0, y1] of COLUMNS) {
  const w = x1 - x0, h = y1 - y0;
  if (w > h) wall(x0, r1((y0 + y1) / 2), x1, r1((y0 + y1) / 2), r1(h));
  else wall(r1((x0 + x1) / 2), y0, r1((x0 + x1) / 2), y1, r1(w));
}

const opening = (kind, [o, c, a, b, label, hinge, swing, style, angle]) => objects.push({
  id: id(kind), kind, layer: 'openings', label,
  x: o === 'V' ? c : r1((a + b) / 2),
  y: o === 'V' ? r1((a + b) / 2) : c,
  width: r1(b - a), angle: angle ?? (o === 'V' ? 90 : 0),
  ...(hinge ? { hinge } : {}), ...(swing ? { swing } : {}), ...(style ? { style } : {}),
});
for (const d of DOORS) opening('door', d);
for (const w of WINDOWS) opening('window', w);

// The arc is glazing end to end; the window follows it, 5 cm of frame each end.
{
  const { a, b, bulge } = ARC;
  objects.push({
    id: id('window'), kind: 'window', layer: 'openings', label: 'Peter 房弧形窗',
    x: r1((a.x + b.x) / 2), y: r1((a.y + b.y) / 2),
    width: r1(Math.hypot(b.x - a.x, b.y - a.y) - 10),
    angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, bulge,
  });
}

// ---- rooms ----------------------------------------------------------------
const walls = objects.filter((o) => o.kind === 'wall')
  .map((w) => ({ a: w.a, b: w.b, bulge: w.bulge ?? 0 }));
const res = await fetch(`${API}/rooms/detect`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ walls }),
});
if (!res.ok) throw new Error(`/rooms/detect → ${res.status}`);
const { polygons } = await res.json();

const inside = (p, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const area = (poly) => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length];
  return s + p.x * q.y - q.x * p.y;
}, 0)) / 2;

const unnamed = [];
for (const poly of polygons) {
  const hit = NAMES.find(([x, y]) => inside({ x, y }, poly));
  if (!hit) { unnamed.push(area(poly) / 1e4); continue; }
  const pts = poly.map((p) => ({ x: r1(p.x), y: r1(p.y) }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  objects.push({
    id: id('room'), kind: 'room', layer: 'rooms', name: hit[2], floor: hit[3], poly: pts, auto: true,
    x: Math.min(...xs), y: Math.min(...ys),
    w: r1(Math.max(...xs) - Math.min(...xs)), h: r1(Math.max(...ys) - Math.min(...ys)),
  });
}
const named = objects.filter((o) => o.kind === 'room');
const missing = NAMES.filter(([, , nm]) => !named.some((r) => r.name === nm)).map((t) => t[2]);
if (missing.length) throw new Error(`沒有圍成房間：${missing.join('、')}`);
if (named.length !== NAMES.length) throw new Error(`房間數 ${named.length}，應該是 ${NAMES.length}（有兩個名字落在同一區）`);

const plan = {
  // `id` 一定要等於網址上的 id——saveProject 拿它當寫入位址（AGENTS.md「離線鏡像不是快取」）
  id: PID,
  schemaVersion: 1,
  name: 'A1 單元・照 1151022 平面配置圖',
  activeFloorId: 'f1',
  floors: [{ id: 'f1', name: '1F', elevation: 0, height: CEIL, objects }],
  layers: [
    { id: 'walls', name: '牆體', visible: true, locked: false, color: '#c9cfdb' },
    { id: 'rooms', name: '房間', visible: true, locked: false, color: '#6d7890' },
    { id: 'openings', name: '門窗', visible: true, locked: false, color: '#7bc6ff' },
    { id: 'furniture', name: '家具', visible: true, locked: false, color: '#e0b45a' },
    { id: 'dims', name: '尺寸標註', visible: true, locked: false, color: '#8bffb0' },
  ],
};

const kinds = objects.reduce((m, o) => ((m[o.kind] = (m[o.kind] ?? 0) + 1), m), {});
console.log(Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join('，'));
for (const r of named) console.log(`  ${r.name.padEnd(10)} ${(area(r.poly) / 1e4).toFixed(2).padStart(6)} m²`);
if (unnamed.length) console.log(`  （未命名的小區域：${unnamed.map((a) => a.toFixed(2) + ' m²').join('、')}——管道間之類，不建房間）`);

if (process.argv.includes('--out')) {
  writeFileSync(process.argv[process.argv.indexOf('--out') + 1], JSON.stringify(plan));
}
if (process.argv.includes('--save')) {
  const r = await fetch(`${API}/projects/${PID}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Owner': OWNER },
    body: JSON.stringify({ name: plan.name, data: plan }),
  });
  console.log(`PUT /api/projects/${PID} →`, r.status);
  console.log(`   看它: http://localhost:5180/?plan=${PID}`);
}
