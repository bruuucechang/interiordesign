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
// centimetres at best. The scan is embedded as an underlay at the same scale so
// the rest can be traced against it rather than guessed at again.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CEIL = 300;            // 天花板 3 m — 使用者指定
const T = 15;                // 內牆厚（圖上量到約 12–17）
const TOUT = 24;             // 外牆厚

const img = process.argv.includes('--image')
  ? process.argv[process.argv.indexOf('--image') + 1]
  : '/private/tmp/claude-501/-Users-bruuucemac/609650e9-c1d4-4d0d-9616-85360c42d5f7/scratchpad/underlay.jpg';

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

// ---- the grid, in centimetres -------------------------------------------
// X, upper band (printed chain): 0 | 496 | 846 | 1208 | 1381.5
// X, lower band (printed chain): 190 | 518 | 817 | 1217 | 1354
const XW = 60;        // 客廳 west wall (the curved section is straightened here)
const X_DIN = 190;    // 餐廳 west wall
const X_LIV = 496;    // 客廳 | 臥室
const X_BED = 518;    // 餐廳 | 臥室 (lower)
const X_MB = 830;     // 臥室 | 主臥室 (upper)
const X_B2 = 817;     // 臥室 | 臥室 (lower)
const X_BATH = 1208;  // 主臥室 | 衛浴
const X_E2 = 1217;    // lower rooms east wall
const XE = 1381.5;    // east edge

// Y bands, measured off the scan against the same scale.
const Y0 = 0;         // top of the master bedroom bay
const Y_TOP = 162;    // 161.5 printed — top of the main band
const Y_MID = 596;    // bottom of the upper bedrooms
const Y_LOW = 690;    // top of the lower bedrooms
const Y_BAL = 1067;   // balcony line
const YB = 1248;      // south edge

// ---- envelope ------------------------------------------------------------
wall(XW, Y_TOP, X_LIV, Y_TOP, TOUT);            // 客廳 north
wall(X_LIV, Y_TOP, X_MB, Y_TOP, TOUT);          // 臥室 north
wall(X_MB, Y0, X_BATH, Y0, TOUT);               // 主臥室 north (bay)
wall(X_MB, Y0, X_MB, Y_TOP, TOUT);
wall(X_BATH, Y0, X_BATH, Y_TOP, TOUT);
wall(X_BATH, Y_TOP, XE, Y_TOP, TOUT);           // 衛浴 north
wall(XE, Y_TOP, XE, Y_MID, TOUT);               // east
wall(XW, Y_TOP, XW, YB, TOUT);                  // west
wall(XW, YB, X_E2, YB, TOUT);                   // south
wall(X_E2, Y_LOW, X_E2, YB, TOUT);              // lower east
wall(X_BATH, Y_MID, X_E2, Y_LOW, TOUT);         // the jog between the bands
wall(XE, Y_MID, X_BATH, Y_MID, TOUT);

// ---- upper band ----------------------------------------------------------
wall(X_LIV, Y_TOP, X_LIV, Y_MID);               // 客廳 | 臥室
wall(X_MB, Y_TOP, X_MB, Y_MID);                 // 臥室 | 主臥室
wall(X_BATH, Y_TOP, X_BATH, Y_MID);             // 主臥室 | 衛浴
wall(X_LIV, Y_MID, X_BATH, Y_MID);              // south wall of the upper rooms

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
room('主臥室', X_MB, Y0, X_BATH - X_MB, Y_MID - Y0, 'wood');
room('主浴', X_BATH, Y_TOP, XE - X_BATH, Y_MID - Y_TOP, 'tile');
room('餐廳', X_DIN, Y_LOW, X_BED - X_DIN, Y_BAL - Y_LOW, 'wood');
room('廚房', X_DIN, Y_BAL, X_BED - X_DIN, YB - Y_BAL, 'tile');
room('臥室', X_BED, Y_LOW, X_B2 - X_BED, Y_BAL - Y_LOW, 'wood');
room('臥室', X_B2, Y_LOW, X_E2 - X_B2, Y_BAL - Y_LOW, 'wood');
room('陽台', X_BED, Y_BAL, X_B2 - X_BED, YB - Y_BAL, 'terrazzo');
room('陽台', X_B2, Y_BAL, X_E2 - X_B2, YB - Y_BAL, 'terrazzo');

// ---- openings ------------------------------------------------------------
win((X_MB + X_BATH) / 2, Y0, 300, 0);            // 主臥室 bay
win((X_LIV + X_MB) / 2, Y_TOP, 180, 0);          // 臥室
win(XW, (Y_TOP + Y_MID) / 2, 240, 90);           // 客廳 west
win((X_BED + X_B2) / 2, Y_BAL, 200, 0);          // 臥室 → 陽台
win((X_B2 + X_E2) / 2, Y_BAL, 260, 0);
door(X_LIV, Y_MID - 90, 90, 90);                 // 客廳 ↔ 餐廳 side
door((X_LIV + X_MB) / 2 - 60, Y_MID, 90, 0);     // 臥室
door((X_MB + X_BATH) / 2, Y_MID, 90, 0);         // 主臥室
door(X_BATH, (Y_TOP + Y_MID) / 2 + 120, 80, 90); // 主浴
door((X_BED + X_B2) / 2 - 70, Y_LOW, 90, 0);     // 臥室
door((X_B2 + X_E2) / 2 - 90, Y_LOW, 90, 0);      // 臥室
door(X_BED, Y_BAL - 60, 80, 90);                 // 廚房

// ---- the scan, at the same scale ----------------------------------------
const b64 = readFileSync(img).toString('base64');
objects.unshift({
  id: id('image'), kind: 'image', layer: 'underlay',
  src: `data:image/jpeg;base64,${b64}`,
  x: -24.5, y: -349.5, w: 1733.0, h: 2155.2, opacity: 0.35,
});

const plan = {
  schemaVersion: 1,
  name: 'A1 單元（IMG_9720 描繪）',
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
