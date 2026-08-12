// Builds the A1 unit from IMG_9720.JPG as a plan, and posts it to the backend.
//
//   node scripts/trace-img9720.mjs            # dry run, prints the summary
//   node scripts/trace-img9720.mjs --save     # POST to :8791
//
// The coordinate system comes from the drawing's own dimension chains, not from
// eyeballing the scan. The top chain (496 + 350 + 362 + 173.5 = 1381.5) fixes
// the scale at 1.4708 px/cm; the bottom chain (328 + 299 + 400 = 1027) measures
// 1028.0 cm at that scale, which is a 0.1 % check on an independent part of the
// drawing. Origin: X = 0 at the top chain's left tick, Y = 0 at the top edge of
// the master bedroom's bay.
//
// What is exact and what is not, because it matters when someone builds from
// this: the X grid and the overall envelope come from the printed dimensions.
// The Y bands, the bathroom fittings, the door swings and the curved wall on the
// living room's west side are measured off the scan and are good to a few
// centimetres at best.
//
// The scan is no longer embedded. It was there as an underlay to trace the rest
// against; with the walls settled it is 245 KB of base64 in every save, every
// autosave and every load, for a picture nobody is looking at any more.
// scripts/ still has this file, so it can be put back by re-running an earlier
// revision if the remaining details ever get traced.

import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CEIL = 300;            // 天花板 3 m — 使用者指定
const T = 15;                // 內牆厚（圖上量到約 12–17）
const TOUT = 24;             // 外牆厚

let n = 0;
const id = (k) => `${k}_${++n}`;
const objects = [];

const wall = (ax, ay, bx, by, thickness = T) =>
  objects.push({ id: id('wall'), kind: 'wall', layer: 'walls', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness, finish: 'paint' });

const room = (name, x, y, w, h, floor) =>
  objects.push({ id: id('room'), kind: 'room', layer: 'rooms', x, y, w, h, name, floor });

const door = (x, y, width, angle) =>
  objects.push({ id: id('door'), kind: 'door', layer: 'openings', x, y, width, angle });

const win = (x, y, width, angle) =>
  objects.push({ id: id('window'), kind: 'window', layer: 'openings', x, y, width, angle });

const dim = (ax, ay, bx, by, offset) =>
  objects.push({ id: id('dimension'), kind: 'dimension', layer: 'dims', a: { x: ax, y: ay }, b: { x: bx, y: by }, offset });

// ---- the grid, in centimetres -------------------------------------------
//
// Second pass. The first one placed the walls from the printed dimension chains
// alone and was wrong by up to 60 cm, because the chains and the drawn walls do
// not agree — the right-hand chain does not even agree with itself (453 + 471.5
// = 924.5 against a printed 869.5 for the same span). The scale is still taken
// from the top chain and cross-checked against the bottom one to 0.1 %, but
// every wall below is now the *measured* centre of the drawn pair, with the
// thickness taken from the gap between its two faces.
//
// Where a printed number and the drawing disagree, the drawing wins: it is what
// the walls were drawn on, and it is what the underlay will be compared against.
const XW = 0;         // 客廳 west — very slightly angled, 5 cm over 4.5 m
const X_DIN = 190;    // 餐廳 west (printed chain: 189.7)
const X_LIV = 489;    // 客廳 | 臥室      (faces 483 / 495)
const X_BED = 529;    // 餐廳 | 臥室      (523 / 536)
const X_MB = 788;     // 臥室 | 主臥室    (781 / 794)   ← first pass had 830
const X_B2 = 830;     // 臥室 | 臥室      (823 / 836)
const X_BATH = 1197;  // 主臥室 | 主浴
const X_E2 = 1230;    // lower rooms east (1222 / 1237)
const XE = 1376;      // east edge        (1369 / 1383)

const Y0 = 0;         // top of the master bedroom bay
const Y_TOP = 132;    // north wall of 客廳 / 臥室      ← first pass had 162
const Y_MID = 592;    // 臥室 south                      (585 / 598)
const Y_MBS = 619;    // 主臥室 south — it steps         (613 / 625)
const Y_LOW = 699;    // lower rooms north               (693 / 705)
const Y_BAL = 1034;   // 臥室 | 陽台                     ← first pass had 1067
const YB = 1260;      // south edge                      (1254 / 1266)

// ---- envelope ------------------------------------------------------------
wall(XW, Y_TOP, X_LIV, Y_TOP, TOUT);            // 客廳 north
wall(X_LIV, Y_TOP, X_MB, Y_TOP, TOUT);          // 臥室 north
wall(X_MB, Y0, X_BATH, Y0, TOUT);               // 主臥室 north (bay)
wall(X_MB, Y0, X_MB, Y_TOP, TOUT);
wall(X_BATH, Y0, X_BATH, Y_TOP, TOUT);
wall(X_BATH, Y_TOP, XE, Y_TOP, TOUT);           // 衛浴 north
wall(XE, Y_TOP, XE, Y_MBS, TOUT);               // east
wall(XW, Y_TOP, XW, YB, TOUT);                  // west
wall(XW, YB, X_E2, YB, TOUT);                   // south
wall(X_E2, Y_LOW, X_E2, YB, TOUT);              // lower east
wall(X_BATH, Y_MBS, X_E2, Y_LOW, TOUT);         // the jog between the bands
wall(XE, Y_MBS, X_BATH, Y_MBS, TOUT);

// ---- upper band ----------------------------------------------------------
wall(X_LIV, Y_TOP, X_LIV, Y_MID);               // 客廳 | 臥室
wall(X_MB, Y_TOP, X_MB, Y_MBS);                 // 臥室 | 主臥室
wall(X_BATH, Y_TOP, X_BATH, Y_MBS);             // 主臥室 | 衛浴
wall(X_LIV, Y_MID, X_MB, Y_MID);                // 臥室 south
wall(X_MB, Y_MBS, X_BATH, Y_MBS);               // 主臥室 south（有台階）

// ---- lower band ----------------------------------------------------------
wall(X_DIN, Y_LOW, X_DIN, YB);                  // 餐廳 west (inner)
wall(X_BED, Y_LOW, X_BED, Y_BAL);               // 餐廳 | 臥室
wall(X_B2, Y_LOW, X_B2, YB);                    // 臥室 | 臥室
wall(X_BED, Y_LOW, X_E2, Y_LOW);                // north wall of the lower rooms
wall(X_BED, Y_BAL, X_E2, Y_BAL);                // 臥室 | 陽台
wall(X_DIN, Y_BAL, X_BED, Y_BAL);               // 餐廳 | 廚房

// ---- rooms ---------------------------------------------------------------
room('客廳', XW, Y_TOP, X_LIV - XW, Y_MID - Y_TOP, 'wood');
room('臥室', X_LIV, Y_TOP, X_MB - X_LIV, Y_MID - Y_TOP, 'wood');
room('主臥室', X_MB, Y0, X_BATH - X_MB, Y_MBS - Y0, 'wood');
room('主浴', X_BATH, Y_TOP, XE - X_BATH, Y_MBS - Y_TOP, 'tile');
room('餐廳', X_DIN, Y_LOW, X_BED - X_DIN, Y_BAL - Y_LOW, 'wood');
room('廚房', X_DIN, Y_BAL, X_BED - X_DIN, YB - Y_BAL, 'tile');
room('臥室', X_BED, Y_LOW, X_B2 - X_BED, Y_BAL - Y_LOW, 'wood');
room('臥室', X_B2, Y_LOW, X_E2 - X_B2, Y_BAL - Y_LOW, 'wood');
room('陽台', X_BED, Y_BAL, X_B2 - X_BED, YB - Y_BAL, 'terrazzo');
room('陽台', X_B2, Y_BAL, X_E2 - X_B2, YB - Y_BAL, 'terrazzo');

// ---- openings ------------------------------------------------------------
win((X_MB + X_BATH) / 2, Y0, 300, 0);            // 主臥室 bay
win((X_LIV + X_MB) / 2, Y_TOP, 180, 0);          // 臥室
win(XW, (Y_TOP + Y_MID) / 2, 240, 90);          // 客廳 west
win((X_BED + X_B2) / 2, Y_BAL, 200, 0);          // 臥室 → 陽台
win((X_B2 + X_E2) / 2, Y_BAL, 260, 0);
door(X_LIV, Y_MID - 90, 90, 90);                 // 客廳 ↔ 餐廳 side
door((X_LIV + X_MB) / 2 - 60, Y_MID, 90, 0);     // 臥室
door((X_MB + X_BATH) / 2, Y_MBS, 90, 0);        // 主臥室
door(X_BATH, (Y_TOP + Y_MBS) / 2 + 120, 80, 90); // 主浴
door((X_BED + X_B2) / 2 - 70, Y_LOW, 90, 0);     // 臥室
door((X_B2 + X_E2) / 2 - 90, Y_LOW, 90, 0);      // 臥室
door(X_BED, Y_BAL - 60, 80, 90);                 // 廚房

// ---- the structural column ----------------------------------------------
//
// This is why the printed chain and the drawn wall disagreed. The divider
// between 臥室 and 主臥室 is a 13 cm partition at X 788, but at its north end
// there is a column about 82 × 90, and the chain's tick sits on that column's
// grid line at 846. So the printed 350 is 客廳's grid bay, not the room: the
// room's clear width is 299 — which is exactly what the *bottom* chain prints
// for the room below it.
//
// Modelling the column makes both numbers true at once, and stops the next
// person rediscovering the same 58 cm argument.
wall(807, 90, 807, 175, 82);

// ---- the printed dimension chains ---------------------------------------
//
// The drawing's own numbers, carried into the plan rather than left in a scan.
// They are the structural grid, so they will not all land on partitions — that
// is the point of having them visible.
dim(0, Y_TOP, 496, Y_TOP, -150);
dim(496, Y_TOP, 846, Y_TOP, -150);
dim(846, Y_TOP, 1208, Y_TOP, -150);
dim(1208, Y_TOP, 1381.5, Y_TOP, -150);
dim(190, YB, 518, YB, 150);
dim(518, YB, 817, YB, 150);
dim(817, YB, 1217, YB, 150);
dim(XE, 0, XE, 161.5, 150);
dim(XE, 161.5, XE, 614.5, 150);
dim(XE, 614.5, XE, 1086, 150);
dim(XE, 1086, XE, 1316, 150);

const plan = {
  schemaVersion: 1,
  name: 'A1 單元（IMG_9720 描繪）',
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
console.log(`天花板 ${CEIL} cm，外牆 ${TOUT} / 內牆 ${T}`);
console.log('物件:', Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join('，'));
console.log(`外框 ${XE - XW} × ${YB - Y0} cm`);

if (process.argv.includes('--save')) {
  // PUT with an id we choose — the API has no create-and-assign-id route,
  // saving is idempotent on the id the client owns.
  const pid = 'img9720';
  const r = await fetch(`http://127.0.0.1:8791/api/projects/${pid}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: plan.name, data: plan }),
  });
  console.log(`PUT /api/projects/${pid} →`, r.status, (await r.text()).slice(0, 160));
} else {
  console.log('（乾跑；加 --save 才會寫進資料庫）');
}

if (process.argv.includes('--out')) {
  const { writeFileSync } = await import('node:fs');
  const f = process.argv[process.argv.indexOf('--out') + 1];
  writeFileSync(f, JSON.stringify(plan));
  console.log('已寫出', f);
}
