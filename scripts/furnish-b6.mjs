// B6：全屋排燈。B5 排好的兩間臥室（Bruce、老媽）以外的六個空間——Peter 房、老爸房、
// 客廳＋廚房、衛浴 A、衛浴 B、陽台——照 PDF 擺家具、排燈、分開關群組，加進 plan1151022。
//
//   node scripts/furnish-b6.mjs            # 只印出要加的東西（dry run）
//   node scripts/furnish-b6.mjs --save     # GET plan1151022 → 換掉 b6_* 物件 → PUT
//
// 只碰 id 以 `b6_` 開頭的物件，做法同 furnish-b5.mjs：重跑是安全的，`b5_*`、牆、門窗原封不動。
// 數字（每間平均、區域、健檢）用 `cd client && npx tsx ../scripts/report-b6.mts` 看；
// 每間怎麼排、為什麼，寫在 docs/lighting-plan.md。
//
// ---- 座標 -----------------------------------------------------------------
//
// 一律是方案座標（cm），家具寫成「外框 + 背靠哪面牆」，由 `place()` 換成 App 的
// x／y／w／h／angle（轉 90／270 時 w×h 對調，同 furnish-b5.mjs）。外框是從 PDF
// （220 dpi 點陣，1 cm ≈ 1.444 px，原點同 trace-pdf1151022.mjs）量的，誤差約 ±2 cm。
// 牆面座標抄 trace-pdf1151022.mjs 的 X／Y 表註解（牆心 ± 半牆厚）。
//
// 家具只放 PDF 上畫了的：老爸房與陽台 PDF 是空的，就不放家具，只排一般照明。
// PDF 上打叉的長方形是做到頂的櫃子，高度給 300（跟 B5 一樣，照度分析當成擋住的格子）。

const API = 'http://127.0.0.1:8791/api';
const PID = 'plan1151022';
const OWNER = 'own_orsxp52fbvey';
export const CEIL = 300;

// 背靠哪面牆 → angle（正面 local +y 朝房間），同 furnish-b5.mjs::BACK_ANGLE。
const BACK_ANGLE = { N: 0, E: 90, S: 180, W: 270 };
// T5 照哪個方向 → angle（燈照 local −y），同 furnish-b5.mjs::FACE_ANGLE。
const FACE_ANGLE = { N: 0, E: 90, S: 180, W: 270 };
const r1 = (v) => Math.round(v * 10) / 10;

// [id, item, label, x0, x1, y0, y1, 背靠, 高度?]
const FURNITURE = [
  // Peter 房：床頭靠西牆、兩側床頭櫃，南牆一排 300 的衣櫃（PDF 標 300）
  ['peter_bed', 'bed_double', '床', 10.2, 199, 243, 425.5, 'W'],
  ['peter_ns1', 'nightstand', '床頭櫃', 10.2, 61, 178, 238, 'W'],
  ['peter_ns2', 'nightstand', '床頭櫃', 10.2, 61, 430, 490, 'W'],
  ['peter_wardrobe', 'wardrobe', '衣櫃', 10.2, 311, 522, 587, 'S', 300],
  // 玄關：大門北側的高鞋櫃
  ['foyer_shoes', 'shoe_cabinet', '鞋櫃', 10.2, 62, 597, 747, 'W', 300],
  // 廚房：西牆高櫃、冰箱，L 型流理台（西段＋南段），水槽與爐具在南段
  ['kit_tall', 'tall_cabinet', '高櫃', 244.1, 285.4, 804, 982, 'W', 300],
  ['kit_fridge', 'fridge', '冰箱', 244.1, 325, 982, 1072, 'W'],
  ['kit_counter_w', 'cabinet_kitchen', '流理台', 244.1, 294, 1072, 1167, 'W'],
  ['kit_counter_s', 'cabinet_kitchen', '流理台', 244.1, 551.2, 1167, 1226.8, 'S'],
  ['kit_sink', 'sink', '水槽', 295, 366, 1167, 1226.8, 'S'],
  ['kit_stove', 'stove', '爐具', 454, 551.2, 1167, 1226.8, 'S'],
  // 客廳：東側（Bruce 房西牆）一排做到頂的高櫃
  ['living_tall', 'tall_cabinet', '高櫃', 814.6, 842.8, 804, 1039.9, 'E', 300],
  // 衛浴 A：北段淋浴（玻璃隔間到 347）、東牆洗手台與馬桶
  ['batha_shower', 'shower', '淋浴間', 1218.5, 1374.4, 162.6, 347, 'N'],
  ['batha_vanity', 'vanity', '洗手台', 1314, 1374.4, 365, 518, 'E'],
  ['batha_toilet', 'toilet', '馬桶', 1305, 1374.4, 536, 576, 'E'],
  // 衛浴 B：南牆馬桶、洗手台，東段淋浴（玻璃在 1109）
  ['bathb_toilet', 'toilet', '馬桶', 976, 1017, 710, 779, 'S'],
  ['bathb_vanity', 'vanity', '洗手台', 1044, 1104, 731, 779, 'S'],
  ['bathb_shower', 'shower', '淋浴間', 1109, 1203.5, 610.4, 779, 'E'],
];

// 燈：['down', id, x, y, 迴路] 或 ['t5', id, x, y, 迴路, 照向, 尺, 離地?]（離地沒寫＝天花板下 15）
// 迴路是每間自己的開關群組（1 起算），同 B5。
export const LIGHTS = {
  peter: [
    ['t5', 'p1', 80, 522, 2, 'N', 4], ['t5', 'p2', 230, 522, 2, 'N', 4],
    ['t5', 'p3', 490.2, 220, 1, 'W', 4], ['t5', 'p4', 490.2, 420, 1, 'W', 4],
    ['down', 'p5', 300, 150, 3], ['down', 'p6', 420, 150, 3],
    ['down', 'p7', 300, 330, 3], ['down', 'p8', 420, 330, 3],
    ['down', 'p9', 300, 460, 3], ['down', 'p10', 420, 460, 3],
    ['down', 'p11', 120, 120, 3],
  ],
  dad: [
    ['t5', 'd1', 505.2, 300, 1, 'E', 4], ['t5', 'd2', 841.2, 380, 1, 'W', 4],
    ['down', 'd3', 600, 230, 2], ['down', 'd4', 745, 230, 2],
    ['down', 'd5', 600, 360, 2], ['down', 'd6', 745, 360, 2],
    ['down', 'd7', 600, 490, 2], ['down', 'd8', 745, 490, 2],
  ],
  living: [
    // 玄關
    ['down', 'l1', 130, 640, 1], ['down', 'l2', 130, 710, 1],
    // 走道（臥室門前）
    ['down', 'l3', 320, 660, 1], ['down', 'l4', 450, 660, 1], ['down', 'l5', 580, 660, 1], ['down', 'l6', 720, 660, 1],
    // 客廳
    ['down', 'l7', 400, 830, 2], ['down', 'l8', 540, 830, 2], ['down', 'l9', 680, 830, 2],
    ['down', 'l10', 400, 960, 2], ['down', 'l11', 540, 960, 2], ['down', 'l12', 680, 960, 2],
    // 廚房：流理台正上方
    ['down', 'l13', 285, 1190, 3], ['down', 'l14', 375, 1190, 3], ['down', 'l15', 465, 1190, 3],
    ['down', 'l16', 269, 1110, 3], ['down', 'l17', 380, 1080, 3],
    // 檯面燈：流理台上方的牆，離地 150（南牆窗的兩側各一支、西段一支）
    ['t5', 'l18', 298.5, 1226.8, 4, 'N', 3, 150], ['t5', 'l19', 502, 1226.8, 4, 'N', 3, 150],
    ['t5', 'l22', 244.1, 1119.5, 4, 'E', 3, 150],
    // 東側小廳（老媽房、Bruce 房、衛浴 B 三扇門前）
    ['down', 'l20', 901, 640, 1], ['down', 'l21', 901, 690, 1],
  ],
  batha: [
    ['down', 'a1', 1296, 220, 1], ['down', 'a2', 1296, 300, 1], ['down', 'a3', 1270, 420, 1], ['down', 'a4', 1270, 520, 1],
    // 鏡前燈：洗手台上方的東牆，離地 200
    ['t5', 'a5', 1374.4, 441.5, 2, 'W', 3, 200],
  ],
  bathb: [
    ['down', 'b1', 1010, 680, 1], ['down', 'b2', 1075, 680, 1], ['down', 'b3', 1156, 695, 1],
    // 鏡前燈：洗手台上方的南牆，離地 200
    ['t5', 'b4', 1074, 779, 2, 'N', 2, 200],
  ],
  balcony: [
    ['down', 'y1', 615, 1100, 1], ['down', 'y2', 715, 1150, 1], ['down', 'y3', 800, 1150, 1],
  ],
};

function place([id, item, label, x0, x1, y0, y1, back, height]) {
  const bw = x1 - x0, bh = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const angle = BACK_ANGLE[back], turned = angle === 90 || angle === 270;
  const w = r1(turned ? bh : bw), h = r1(turned ? bw : bh);
  return {
    id: `b6_${id}`, kind: 'furniture', layer: 'furniture', item, label,
    x: r1(cx - w / 2), y: r1(cy - h / 2), w, h, angle,
    ...(height ? { height, elevation: 0 } : {}),
  };
}

function light([type, id, x, y, circuit, face, size, elevation]) {
  const base = { id: `b6_${id}`, kind: 'electrical', layer: 'electrical', x: r1(x), y: r1(y), circuit };
  return type === 'down'
    ? { ...base, item: 'downlight', angle: 0 }
    : { ...base, item: 'batten', angle: FACE_ANGLE[face], size, ...(elevation ? { elevation } : {}) };
}

export const allObjects = () => [...FURNITURE.map(place), ...Object.values(LIGHTS).flat().map(light)];

export async function loadPlan() {
  const res = await fetch(`${API}/projects/${PID}`, { headers: { 'X-Owner': OWNER } });
  if (!res.ok) throw new Error(`GET ${PID} → ${res.status}`);
  const proj = await res.json();
  if (proj.data.id !== PID) throw new Error(`data.id 是 ${proj.data.id}，不是 ${PID}`);
  const floor = proj.data.floors.find((f) => f.id === proj.data.activeFloorId) ?? proj.data.floors[0];
  if (floor.height !== CEIL) throw new Error(`天花板是 ${floor.height}，這支腳本假設 ${CEIL}`);
  return { proj, floor };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { proj, floor } = await loadPlan();
  const add = allObjects();
  const kept = floor.objects.filter((o) => !o.id.startsWith('b6_'));
  const removed = floor.objects.length - kept.length;
  floor.objects = [...kept, ...add];
  const n = add.reduce((m, o) => ((m[o.kind] = (m[o.kind] ?? 0) + 1), m), {});
  console.log(`拿掉舊的 b6_* ${removed} 個，加 ${add.length} 個：`, n);
  if (process.argv.includes('--save')) {
    const put = await fetch(`${API}/projects/${PID}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Owner': OWNER },
      body: JSON.stringify({ name: proj.name, data: proj.data }),
    });
    console.log(`PUT /api/projects/${PID} →`, put.status);
    if (!put.ok) process.exit(1);
  } else {
    console.log('（dry run；加 --save 才會寫進資料庫）');
  }
}
