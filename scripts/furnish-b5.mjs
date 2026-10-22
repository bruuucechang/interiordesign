// B5：兩間臥室照「臥室燈光配置」原型（docs/lighting-prototype.html 的 DEFAULTS）
// 擺家具、T5、崁燈、開關迴路，加進 plan1151022。
//
//   node scripts/furnish-b5.mjs            # 只印出要加的東西（dry run）
//   node scripts/furnish-b5.mjs --save     # GET plan1151022 → 換掉這兩間的 b5_* 物件 → PUT
//
// 只碰 id 以 `b5_` 開頭的物件：先 GET 整份、刪掉上一次加的 b5_*、加新的、PUT 回去。
// 牆、門窗、房間、其他人加的東西原封不動，所以重跑是安全的。
// **不要再跑 trace-pdf1151022.mjs --save**，那支會整份蓋掉，連這裡加的一起。
//
// ---- 座標怎麼換的 ---------------------------------------------------------
//
// 原型每間房是一個室內淨尺寸的長方形，原點在左上（北西）內角。這裡的 LAYOUT 用
// 同一種格式寫，但尺寸換成 PDF 量到的內淨尺寸（`trace-pdf1151022.mjs` 的牆面），
// 天花板換成這份方案的 300；`ORIGIN` 是那個內角在方案裡的位置。
//
//   老媽房間（原型「上方房間」348 × 596）：PDF 內淨 347.3 × 595.4，差不到 1 cm，
//     座標照搬，只把貼東牆、南牆的東西貼回新的牆面。房門在 PDF 上是南牆西段
//     （原型畫在西牆南端），浴室門 PDF 與原型一致。
//   Bruce 房間（原型「你的房間」365 × 415）：PDF 內淨 379.9 × 432.8，大了 15 × 18 cm。
//     規則：貼牆的家具與燈貼著原本那面牆；橫跨兩個東西之間的（衣櫃：門到東牆、
//     西側櫃：門口區到南牆）照樣橫跨；不貼牆的崁燈按比例拉開。房門在西北角的凹口
//     （PDF 上那道門在 y = 731.9，比房間北牆往北 54.6 cm）。
//
// 床頭在原型裡是「離牆最近那一側」，這裡是床的 local −y：兩間的床都靠東牆，
// 所以 angle 90，床本身的 w×h 是原型外框的 h×w（同 client/test/lightzones.test.ts::bedEast）。
// 櫃子是做到頂的（原型把它們當成擋住的格子），高度給 300。

const API = 'http://127.0.0.1:8791/api';
const PID = 'plan1151022';
const OWNER = 'own_orsxp52fbvey';
export const CEIL = 300;

export const ORIGIN = {
  mum: { x: 856.2, y: 0 },      // 老媽房：西牆內面 856.2、北窗內面 0
  bruce: { x: 857.8, y: 794 },  // Bruce 房：西牆內面 857.8、北牆（衛浴 B／衣櫃那道）內面 794
};

// 原型 DEFAULTS 的格式（原型的 grid／zones 可以直接吃），尺寸換成 PDF。
export const LAYOUT = {
  bruce: {
    name: 'Bruce 房間', W: 379.9, D: 432.8, ceil: CEIL,
    openings: [
      { side: 'N', a: 0, b: 87.8, kind: 'door', label: '房門' },
      { side: 'S', a: 38.3, b: 277.8, kind: 'window', label: '窗' },
      { side: 'E', a: 353.1, b: 432.8, kind: 'window', label: '窗' },
    ],
    furniture: [
      { id: 'fa1', kind: 'cabinet', label: '衣櫃', x: 87.8, y: 0, w: 292.1, h: 60 },
      { id: 'fa2', kind: 'cabinet', label: '櫃子', x: 0, y: 95, w: 50, h: 337.8 },
      { id: 'fa3', kind: 'bed', label: '床', x: 189.9, y: 135, w: 190, h: 175 },
      { id: 'fa4', kind: 'desk', label: '書桌', x: 136.9, y: 379.8, w: 243, h: 53 },
    ],
    lights: [
      { id: 'la1', type: 't5', size: 4, orient: 'h', face: 'S', x: 244.9, y: 60, c: 2 },
      { id: 'la2', type: 't5', size: 4, orient: 'v', face: 'W', x: 379.9, y: 248, c: 1 },
      { id: 'la3', type: 't5', size: 4, orient: 'h', face: 'N', x: 244.9, y: 432.8, c: 2 },
      { id: 'la4', type: 't5', size: 4, orient: 'v', face: 'E', x: 50, y: 248, c: 1 },
      { id: 'la5', type: 'down', x: 67.7, y: 109.5, c: 3 }, { id: 'la6', type: 'down', x: 182.1, y: 109.5, c: 3 },
      { id: 'la7', type: 'down', x: 296.6, y: 109.5, c: 3 },
      { id: 'la8', type: 'down', x: 67.7, y: 394.2, c: 3 }, { id: 'la9', type: 'down', x: 182.1, y: 394.2, c: 3 },
      { id: 'la10', type: 'down', x: 296.6, y: 394.2, c: 3 },
    ],
  },
  mum: {
    name: '老媽房間', W: 347.3, D: 595.4, ceil: CEIL,
    openings: [
      { side: 'N', a: 0, b: 347.3, kind: 'window', label: '凸窗' },
      { side: 'S', a: 0, b: 89.4, kind: 'door', label: '房門' },
      { side: 'E', a: 439.4, b: 518.9, kind: 'door', label: '浴室門' },
    ],
    beams: [{ orient: 'h', v: 73, a: 0, b: 347.3, face: 'S', label: '凸窗開口上緣' }],
    furniture: [
      { id: 'fb1', kind: 'cabinet', label: '櫃子', x: 0, y: 98, w: 46, h: 364 },
      { id: 'fb2', kind: 'cabinet', label: '衣櫃', x: 104.3, y: 531.4, w: 243, h: 64 },
      { id: 'fb3', kind: 'bed', label: '床', x: 159.3, y: 193, w: 188, h: 181 },
    ],
    lights: [
      { id: 'lb1', type: 't5', size: 4, orient: 'h', face: 'S', x: 225.3, y: 73, c: 2 },
      { id: 'lb2', type: 't5', size: 4, orient: 'v', face: 'W', x: 347.3, y: 284, c: 1 },
      { id: 'lb3', type: 't5', size: 4, orient: 'h', face: 'N', x: 225.3, y: 531.4, c: 2 },
      { id: 'lb4', type: 't5', size: 4, orient: 'v', face: 'E', x: 46, y: 284, c: 1 },
      { id: 'lb5', type: 'down', x: 166, y: 130, c: 3 }, { id: 'lb6', type: 'down', x: 286, y: 130, c: 3 },
      { id: 'lb7', type: 'down', x: 166, y: 284, c: 3 },
      { id: 'lb8', type: 'down', x: 166, y: 455, c: 3 }, { id: 'lb9', type: 'down', x: 286, y: 455, c: 3 },
    ],
  },
};

// 原型的 face → App 的 angle（燈照的方向是符號的 local −y，見 core/lighting.ts::luminaire）。
const FACE_ANGLE = { N: 0, E: 90, S: 180, W: 270 };
// 櫃子正面（local +y）朝房間：靠哪面牆就轉成背對那面牆。
const BACK_ANGLE = { N: 0, W: 270, S: 180, E: 90 };

const r1 = (v) => Math.round(v * 10) / 10;

/** 一間房的原型配置 → App 物件（方案座標）。 */
export function toObjects(key) {
  const L = LAYOUT[key], o = ORIGIN[key], out = [];
  // 背靠哪面牆：貼著的牆裡面，沿著它最長的那一面（角落的衣櫃靠長邊那面，不是側板）。
  const backWall = (f) => {
    const d = { N: f.y, S: L.D - (f.y + f.h), W: f.x, E: L.W - (f.x + f.w) };
    const along = { N: f.w, S: f.w, W: f.h, E: f.h };
    const near = Object.keys(d).filter((k) => d[k] < 1);
    if (!near.length) throw new Error(`${f.label} 沒有貼牆`);
    return near.sort((a, b) => along[b] - along[a])[0];
  };
  for (const f of L.furniture) {
    const cx = o.x + f.x + f.w / 2, cy = o.y + f.y + f.h / 2;
    const angle = BACK_ANGLE[backWall(f)];
    // 轉 90／270 的時候，物件自己的 w×h 是外框的 h×w。
    const turned = angle === 90 || angle === 270;
    const w = turned ? f.h : f.w, h = turned ? f.w : f.h;
    const item = f.kind === 'cabinet' ? 'wardrobe' : f.kind === 'bed' ? 'bed_double' : 'desk';
    out.push({
      id: `b5_${f.id}`, kind: 'furniture', layer: 'furniture', item, label: f.label,
      x: r1(cx - w / 2), y: r1(cy - h / 2), w, h, angle,
      ...(f.kind === 'cabinet' ? { height: CEIL, elevation: 0 } : {}),
    });
  }
  for (const b of L.beams ?? []) {
    // 原型的樑是一條線（T5 鎖在它朝南那一面）；App 的樑有寬度，讓那一面落在原型的線上。
    const width = 15, c = b.v - (b.face === 'S' ? width / 2 : -width / 2);
    out.push({
      id: `b5_beam_${key}`, kind: 'beam', layer: 'beams', width, height: 40, elevation: CEIL - 40,
      a: { x: o.x + b.a, y: o.y + c }, b: { x: o.x + b.b, y: o.y + c },
    });
  }
  for (const l of L.lights) {
    const base = { id: `b5_${l.id}`, kind: 'electrical', layer: 'electrical', x: r1(o.x + l.x), y: r1(o.y + l.y), circuit: l.c };
    out.push(l.type === 'down'
      ? { ...base, item: 'downlight', angle: 0 }
      : { ...base, item: 'batten', angle: FACE_ANGLE[l.face], size: l.size });
  }
  return out;
}

export const allObjects = () => [...toObjects('bruce'), ...toObjects('mum')];

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await fetch(`${API}/projects/${PID}`, { headers: { 'X-Owner': OWNER } });
  if (!res.ok) throw new Error(`GET ${PID} → ${res.status}`);
  const proj = await res.json();
  const plan = proj.data;
  if (plan.id !== PID) throw new Error(`data.id 是 ${plan.id}，不是 ${PID}`);
  const floor = plan.floors.find((f) => f.id === plan.activeFloorId) ?? plan.floors[0];
  if (floor.height !== CEIL) throw new Error(`天花板是 ${floor.height}，這支腳本假設 ${CEIL}`);
  const add = allObjects();
  const kept = floor.objects.filter((o) => !o.id.startsWith('b5_'));
  const removed = floor.objects.length - kept.length;
  floor.objects = [...kept, ...add];
  const n = add.reduce((m, o) => ((m[o.kind] = (m[o.kind] ?? 0) + 1), m), {});
  console.log(`拿掉舊的 b5_* ${removed} 個，加 ${add.length} 個：`, n);
  if (process.argv.includes('--save')) {
    const put = await fetch(`${API}/projects/${PID}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Owner': OWNER },
      body: JSON.stringify({ name: proj.name, data: plan }),
    });
    console.log(`PUT /api/projects/${PID} →`, put.status);
    if (!put.ok) process.exit(1);
  } else {
    console.log('（dry run；加 --save 才會寫進資料庫）');
  }
}
