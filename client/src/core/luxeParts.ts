// 溫潤奢華（B30）：一套程式產生的傢俱，先算零件、再上材質。
//
// 零件是純資料——每塊一個軸對齊的盒子（或圓柱）、一種材質名——所以「尺寸對不對」
// 不用起 WebGL 就量得到：test/luxeParts.test.ts 對每一件量外框是不是剛好填滿
// 目錄的寬×深×高、沒有零件伸出去。3D 那邊（furnitureBuilders.ts 的 luxeModel）只負責
// 把材質名換成真的材質。
//
// 座標跟 furnitureBuilders 一樣：平面置中（x ∈ [-w/2, w/2]、z ∈ [-h/2, h/2]），
// y 從地板往上，正面朝 +z。
//
// 風格的定義（spec-luxury.md 第三節，使用者裁示「溫潤木質低調奢華」）：淡橡木、米白布紗、
// 亮面米色石材檯面、淺灰石紋、霧面香檳金屬只用在很少的地方（把手溝、淋浴拉門框、沖水板）。
// 櫃子一律無把手：門片之間留 6mm 黑縫，靠縫跟香檳金屬的嵌入式拉溝讀出是門。

export type LuxeMat =
  | 'oak'          // 淡橡木皮
  | 'linen'        // 米白布紗
  | 'taupe'        // 淺灰褐布（抱枕、地毯邊、床尾毯）
  | 'sheet'        // 白色寢具
  | 'wool'         // 地毯
  | 'stone'        // 亮面米色石材
  | 'stoneGrey'    // 淺灰石紋
  | 'champagne'    // 霧面香檳金屬
  | 'shadow'       // 門縫、踢腳凹槽
  | 'glass'
  | 'ceramic'
  | 'steel'        // 水槽
  | 'hob';         // 黑玻璃爐面

export interface Part {
  mat: LuxeMat;
  x: [number, number];
  y: [number, number];
  z: [number, number];
  /** 圓角半徑，0／沒寫＝直角。 */
  r?: number;
  /** 圓柱（外框就是 x／z 的範圍，可以是橢圓）。 */
  cyl?: boolean;
}

type Span = [number, number];
const P = (mat: LuxeMat, x: Span, y: Span, z: Span, r = 0, cyl = false): Part => ({ mat, x, y, z, ...(r ? { r } : {}), ...(cyl ? { cyl } : {}) });

/** 門縫，cm。 */
export const GAP = 0.6;

/**
 * 一排多少扇門：系統櫃一扇 45～60cm（太寬的門會垂、太窄不好拿），取最接近 55 的整數份，
 * 所以實際落在 41～69cm 之間。
 */
export function doorCount(width: number, leaf = 55): number {
  return Math.max(1, Math.round(width / leaf));
}

/** 推拉門幾片：一片 80～120cm，至少兩片（一片推不開）。 */
export function slideLeaves(width: number): number {
  return Math.max(2, Math.round(width / 90));
}

/**
 * 一排門片，後面墊一層黑底讓門縫看得出來。x0..x1 平均分成 n 扇、每扇左右各讓半條縫。
 * `pull`：在每扇的開門側加一條香檳金屬的嵌入拉溝（兩扇一對時拉溝在中間相對），門片退 3mm 讓拉溝露臉；
 * 沒有 `pull` 時門片正面就在 zFront。
 */
function doorRow(out: Part[], x0: number, x1: number, y0: number, y1: number, zBack: number, zFront: number, n: number,
  pull?: { y: Span }) {
  out.push(P('shadow', [x0, x1], [y0, y1], [zBack - 0.2, zBack]));
  const dw = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + dw * i + GAP / 2, b = x0 + dw * (i + 1) - GAP / 2;
    out.push(P('oak', [a, b], [y0 + GAP / 2, y1 - GAP / 2], [zBack, pull ? zFront - 0.3 : zFront]));
    if (pull) {
      // 單扇時拉溝在右邊；兩扇一對（0-1、2-3…）時在相鄰的那一側
      const right = n === 1 || i % 2 === 0;
      out.push(P('champagne', right ? [b - 1.4, b - 0.4] : [a + 0.4, a + 1.4], pull.y, [zFront - 0.3, zFront]));
    }
  }
}

// ---- 各件 ------------------------------------------------------------------

function bed(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const hb = 10;                                            // 床頭板厚
  o.push(P('shadow', [-W + 6, W - 6], [0, 8], [-D + hb + 4, D - 8]));          // 內縮踢腳：床像浮著
  o.push(P('oak', [-W, W], [8, 30], [-D + hb, D], 1.5));                        // 床架
  o.push(P('oak', [-W, W], [0, H - 1], [-D, -D + 4], 1));                       // 床頭木背板
  o.push(P('champagne', [-W, W], [H - 1, H], [-D, -D + 4]));                    // 頂端一條香檳金屬收邊
  o.push(P('linen', [-W + 5, W - 5], [32, H - 6], [-D + 4, -D + hb], 3));       // 布面軟包
  o.push(P('sheet', [-W + 4, W - 4], [30, 52], [-D + hb + 1, D - 3], 5));       // 床墊
  o.push(P('linen', [-W + 2, W - 2], [36, 55], [-D + hb + 62, D - 1], 4));      // 被子垂到兩側
  o.push(P('sheet', [-W + 2.5, W - 2.5], [52, 57], [-D + hb + 56, -D + hb + 70], 2)); // 反折的被頭
  o.push(P('taupe', [-W + 1, W - 1], [54, 56.5], [D - 55, D - 25], 1));        // 床尾毯
  const n = w >= 140 ? 2 : 1, pw = (w - 16 - (n - 1) * 6) / n;
  for (let i = 0; i < n; i++) {
    const a = -W + 8 + i * (pw + 6);
    o.push(P('sheet', [a, a + pw], [52, 64], [-D + hb + 4, -D + hb + 38], 5));  // 枕頭
  }
  return o;
}

function nightstand(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  o.push(P('shadow', [-W + 3, W - 3], [0, 6], [-D + 2, D - 4]));
  o.push(P('oak', [-W, W], [6, H - 2], [-D, D - 2.4]));
  const n = 2, top = H - 2, dh = (top - 6) / n;
  for (let i = 0; i < n; i++) {
    const y0 = 6 + dh * i, y1 = y0 + dh;
    doorRow(o, -W, W, y0, y1, D - 2.2, D - 0.3, 1);
    o.push(P('champagne', [-W + 4, W - 4], [y1 - 1.6, y1 - 0.8], [D - 0.3, D]));  // 抽屜頂的拉溝
  }
  o.push(P('stone', [-W, W], [H - 2, H], [-D, D], 0.4));                        // 石材面
  return o;
}

function wardrobe(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  o.push(P('shadow', [-W + 2, W - 2], [0, 8], [-D, D - 5]));
  o.push(P('oak', [-W, W], [8, H], [-D, D - 2.4]));
  doorRow(o, -W, W, 8, H, D - 2.2, D, doorCount(w), { y: [95, 145] });
  return o;
}

function wardrobeSlide(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const n = slideLeaves(w), lw = Math.min(w, w / n + 4);       // 每片多 4cm，跟鄰片重疊
  const ov = n === 1 ? 0 : lw - (w - lw) / (n - 1);
  o.push(P('oak', [-W, W], [6, H - 4], [-D, D - 5.8]));          // 櫃身（夾在上下軌之間，不跟軌道的面疊在一起）
  o.push(P('oak', [-W, W], [0, 6], [-D, D], 0.5));               // 下軌
  o.push(P('oak', [-W, W], [H - 4, H], [-D, D], 0.5));           // 上軌
  o.push(P('shadow', [-W, W], [6, H - 4], [D - 5.8, D - 5.6]));
  for (let i = 0; i < n; i++) {
    const c = n === 1 ? 0 : -W + lw / 2 + i * (w - lw) / (n - 1);
    const z: Span = i % 2 ? [D - 5.5, D - 3.3] : [D - 2.5, D - 0.3];   // 兩條軌，前後錯開
    o.push(P('oak', [c - lw / 2, c + lw / 2], [6.3, H - 4.3], z));
    // 拉溝在推得開的那一側、離邊超過跟鄰片的重疊，不然後軌那片的拉溝被前片整條擋住
    const edge = i === n - 1 ? c - lw / 2 + ov + 2 : c + lw / 2 - ov - 3;
    o.push(P('champagne', [edge, edge + 1], [90, 150], [z[1], z[1] + 0.3]));
  }
  return o;
}

function desk(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const t = 3;
  o.push(P('oak', [-W, W], [H - t, H], [-D, D], 0.8));                         // 桌面
  o.push(P('oak', [-W, -W + 4], [0, H - t], [-D, D]));                         // 兩片實木側板當腳
  o.push(P('oak', [W - 4, W], [0, H - t], [-D, D]));
  o.push(P('oak', [-W + 4, W - 4], [H - 35, H - t], [-D, -D + 2]));            // 擋板
  const dw = Math.min(70, w * 0.45);
  o.push(P('oak', [-dw / 2, dw / 2], [H - t - 9, H - t], [-D + 2, D - 4]));    // 抽屜盒
  o.push(P('champagne', [-dw / 2 + 3, dw / 2 - 3], [H - t - 9.1, H - t - 8.2], [D - 4, D - 3.7]));  // 底下的拉溝（比抽屜盒多凸 3mm、低 1mm）
  return o;
}

/** 高櫃、鞋櫃：下門＋中間一格石材底的開放平台（放鑰匙、香氛）＋上門。 */
function tallCab(w: number, h: number, H: number, plinth: number, niche: Span): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const t = 2, n = doorCount(w);
  o.push(P('shadow', [-W + 2, W - 2], [0, plinth], [-D, D - 5]));
  o.push(P('oak', [-W + t, W - t], [plinth, H], [-D, -D + t]));                  // 背板（夾在兩側板之間）
  o.push(P('oak', [-W, -W + t], [plinth, H], [-D, D]));                          // 兩側
  o.push(P('oak', [W - t, W], [plinth, H], [-D, D]));
  o.push(P('oak', [-W + t, W - t], [plinth, niche[0]], [-D + t, D - 2.4]));      // 下櫃身
  doorRow(o, -W + t, W - t, plinth, niche[0], D - 2.2, D - 0.3, n);
  o.push(P('champagne', [-W + t, W - t], [niche[0] - 1, niche[0] - 0.4], [D - 0.3, D]));  // 下門頂的拉溝
  o.push(P('stoneGrey', [-W + t, W - t], [niche[0], niche[0] + 2], [-D + t, D]));  // 平台石材
  o.push(P('oak', [-W + t, W - t], [niche[1], H], [-D + t, D - 2.4]));           // 上櫃身
  doorRow(o, -W + t, W - t, niche[1], H, D - 2.2, D - 0.3, n);
  return o;
}

interface KitchenOpts { sink?: boolean; hob?: boolean }
const COUNTER = 90, COUNTER_T = 4;

/** 廚房下櫃：石材檯面、抽屜在上門在下，兩條香檳金屬的嵌入拉溝（gola）取代把手。 */
function kitchenBase(w: number, h: number, H: number, opts: KitchenOpts = {}): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const top = COUNTER - COUNTER_T, n = doorCount(w, 60);
  o.push(P('shadow', [-W + 1, W - 1], [0, 10], [-D, D - 6]));
  o.push(P('oak', [-W, W], [10, top], [-D, D - 3.4]));
  o.push(P('champagne', [-W + 0.1, W - 0.1], [top - 3, top], [D - 4, D - 3]));   // 檯面下的拉溝（兩端內縮 1mm，不跟櫃身側面疊）
  doorRow(o, -W, W, top - 17, top - 3, D - 3.2, D - 1, n);                    // 抽屜
  o.push(P('champagne', [-W + 0.1, W - 0.1], [top - 20, top - 17], [D - 4, D - 3]));   // 抽屜與門之間的拉溝
  doorRow(o, -W, W, 10, top - 20, D - 3.2, D - 1, n);                         // 門
  // 石材檯面（前緣比門多出 1cm）；有爐面時讓爐面跟檯面齊平，檯面低 1mm 免得兩個面疊在一起閃
  o.push(P('stone', [-W, W], [top, opts.hob ? COUNTER - 0.1 : COUNTER], [-D, D], 0.4));
  if (opts.sink) {
    const sw = Math.min(70, w - 20);
    o.push(P('steel', [-sw / 2, sw / 2], [COUNTER - 0.3, COUNTER + 0.05], [-D + 10, D - 10]));   // 下嵌水槽
    o.push(P('champagne', [-1.5, 1.5], [COUNTER, H], [-D + 4, -D + 7], 0, true));                // 龍頭
    o.push(P('champagne', [-1.2, 1.2], [H - 3, H], [-D + 4, -D + 22], 1));                         // 出水口
  }
  if (opts.hob) {
    const hw = Math.min(76, w - 10);
    o.push(P('hob', [-hw / 2, hw / 2], [COUNTER - 0.4, COUNTER], [-D + 5, D - 5], 0.5));
  }
  return o;
}

function upperCab(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  o.push(P('oak', [-W, W], [2.5, H], [-D, D - 2.4]));
  // 門片比櫃身往下多 2.5cm：手從底下扳，不用把手
  doorRow(o, -W, W, 0, H, D - 2.2, D, doorCount(w, 45));
  return o;
}

function island(w: number, h: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const top = COUNTER - COUNTER_T, end = 4, seat = Math.min(30, h * 0.3);   // 背面留 30cm 給吧檯椅放腳
  o.push(P('stone', [-W, W], [top, COUNTER], [-D, D], 0.4));
  o.push(P('stone', [-W, -W + end], [0, top], [-D, D]));                      // 瀑布側板
  o.push(P('stone', [W - end, W], [0, top], [-D, D]));
  o.push(P('shadow', [-W + end, W - end], [0, 10], [-D + seat + 2, D - 6]));
  o.push(P('oak', [-W + end, W - end], [10, top], [-D + seat, D - 3.4]));
  o.push(P('champagne', [-W + end + 0.1, W - end - 0.1], [top - 3, top], [D - 4, D - 3]));
  doorRow(o, -W + end, W - end, 10, top - 3, D - 3.2, D - 1, doorCount(w - 2 * end, 60));
  return o;
}

/** 嵌入冰箱：外面是跟高櫃同一套的木門片，香檳金屬長拉條讓人認得出是冰箱。 */
function fridge(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  o.push(P('shadow', [-W + 2, W - 2], [0, 8], [-D, D - 5]));
  o.push(P('oak', [-W, W], [8, H], [-D, D - 2.4]));
  const split = 8 + (H - 8) * 0.36;                                            // 下冷凍、上冷藏
  doorRow(o, -W, W, 8, split, D - 2.2, D - 0.3, 1);
  doorRow(o, -W, W, split, H, D - 2.2, D - 0.3, 1);
  o.push(P('champagne', [W - 5, W - 3], [split - 32, split - 4], [D - 0.3, D], 0.5));
  o.push(P('champagne', [W - 5, W - 3], [split + 6, split + 66], [D - 0.3, D], 0.5));
  return o;
}

/** 壁掛馬桶：後面一道淺灰石紋的假牆藏水箱，香檳金屬沖水板。 */
function toilet(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const wall = 6;
  o.push(P('stoneGrey', [-W, W], [0, H], [-D, -D + wall]));
  o.push(P('champagne', [-11, 11], [H - 18, H - 4], [-D + wall, -D + wall + 0.6], 0.5));
  o.push(P('ceramic', [-W + 1, W - 1], [22, 40], [-D + wall, D - 4], 9));     // 懸空的馬桶本體
  o.push(P('ceramic', [-W + 2, W - 2], [22, 38], [D - 14, D], 9));            // 前端收圓
  o.push(P('ceramic', [-W + 1, W - 1], [40, 42.5], [-D + wall + 2, D], 9));   // 薄座圈
  return o;
}

/**
 * 懸空浴櫃：石材檯面、下嵌白瓷盆、香檳金屬龍頭，後面跟馬桶同一道淺灰石紋假牆藏管線。
 * 假牆也是讓它「落地」的那一塊：3D 的高度是從模型最低點量的（furniture3d `getModelHeight`），
 * 整件懸空的話 105cm 會被當成 75cm、拉成 147cm。
 */
function vanity(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const top = 85, t = 3, bottom = 30, wall = 3;
  o.push(P('stoneGrey', [-W, W], [0, H], [-D, -D + wall]));
  o.push(P('oak', [-W, W], [bottom, top - t], [-D + wall, D - 2.4]));
  doorRow(o, -W, W, bottom, top - t, D - 2.2, D - 0.3, Math.max(1, Math.round(w / 60)));
  o.push(P('champagne', [-W, W], [top - t - 1.2, top - t], [D - 0.3, D]));
  o.push(P('stone', [-W, W], [top - t, top], [-D + wall, D], 0.4));
  const bw = Math.min(46, w * 0.55);
  o.push(P('ceramic', [-bw / 2, bw / 2], [top - 0.3, top + 0.05], [-D + 8, D - 6], 0, true));   // 下嵌盆的開口
  o.push(P('champagne', [-1.5, 1.5], [top, H], [-D + wall, -D + wall + 3], 0, true));
  o.push(P('champagne', [-1.1, 1.1], [H - 2.5, H], [-D + wall, -D + wall + 12], 1));
  return o;
}

/** 玻璃淋浴間：淺灰石紋止水墩、正面清玻璃＋香檳金屬細框、頂噴。 */
function shower(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  o.push(P('stoneGrey', [-W, W], [0, 4], [-D, D]));
  const fixed = w * 0.45;                                                      // 固定片＋拉門
  o.push(P('glass', [-W + 1.5, -W + fixed], [4, H - 2], [D - 1, D - 0.2]));      // 玻璃夾在側框之間
  o.push(P('glass', [-W + fixed - 4, W - 1.5], [4, H - 2], [D - 1.8, D - 1]));
  o.push(P('champagne', [-W, W], [H - 2, H], [D - 2, D]));                     // 頂框
  o.push(P('champagne', [-W, -W + 1.5], [4, H - 2], [D - 2, D]));              // 側框
  o.push(P('champagne', [W - 1.5, W], [4, H - 2], [D - 2, D]));
  o.push(P('champagne', [-W + fixed + 4, -W + fixed + 6], [90, 130], [D - 0.2, D], 0.5));  // 拉門把
  o.push(P('champagne', [-1, 1], [H - 12, H - 10], [-D, -D + 30]));            // 頂噴的臂
  o.push(P('champagne', [-12, 12], [H - 13, H - 12], [-D + 18, -D + 42], 1));  // 頂噴
  return o;
}

/** L 型布沙發，貴妃在右側。沒有腳：內縮的黑色踢腳讓它像浮在地毯上。 */
function sofaL(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const sd = Math.min(95, h * 0.6), cw = Math.min(90, w * 0.35), back = 22, arm = 18, seatY = 42;
  o.push(P('shadow', [-W + 5, W - 5], [0, 6], [-D + 5, -D + sd - 5]));
  o.push(P('shadow', [W - cw + 5, W - 5], [0, 6], [-D + sd - 5, D - 5]));
  o.push(P('linen', [-W + 0.5, W - 0.5], [6, seatY - 10], [-D + 0.5, -D + sd], 3));   // 主座底座（內縮半公分，不跟靠背、扶手的外面疊在一起）
  o.push(P('linen', [W - cw, W - 0.5], [6, seatY - 10], [-D + sd, D], 3));      // 貴妃底座（接在主座前面，不重疊）
  o.push(P('linen', [-W, W], [6, H], [-D, -D + back], 6));                    // 靠背
  o.push(P('linen', [-W + 0.3, -W + arm], [6, seatY + 18], [-D + back - 4, -D + sd + 0.5], 5));   // 左扶手（比底座多凸半公分）
  const run = w - cw - arm, n = Math.max(1, Math.round(run / 80)), cwid = run / n;
  for (let i = 0; i < n; i++) {
    const a = -W + arm + cwid * i;
    o.push(P('linen', [a + 0.5, a + cwid - 0.5], [seatY - 10, seatY], [-D + back, -D + sd], 4));   // 座墊
  }
  o.push(P('linen', [W - cw + 0.5, W - 0.5], [seatY - 10, seatY], [-D + back, D], 4));             // 貴妃座墊
  o.push(P('taupe', [-W + arm + 8, -W + arm + 52], [seatY, seatY + 32], [-D + back, -D + back + 14], 6));
  o.push(P('taupe', [W - cw + 10, Math.max(W - cw + 11, W - 14)], [seatY, seatY + 30], [-D + back, -D + back + 14], 6));
  return o;
}

function coffee(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const t = 4, inset = Math.min(10, w * 0.12, h * 0.15);
  o.push(P('champagne', [-W + inset, W - inset], [0, 1], [-D + inset, D - inset]));    // 一圈細金屬底座
  o.push(P('oak', [-W + inset, W - inset], [1, H - t], [-D + inset, D - inset], 2));
  o.push(P('stone', [-W, W], [H - t, H], [-D, D], 1.5));
  return o;
}

function tvStand(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const t = 3, plinth = 12;
  o.push(P('shadow', [-W + 5, W - 5], [0, plinth], [-D + 2, D - 6]));
  o.push(P('oak', [-W, W], [plinth, H - t], [-D, D - 2.4]));
  doorRow(o, -W, W, plinth, H - t, D - 2.2, D - 0.3, doorCount(w, 60));
  o.push(P('champagne', [-W, W], [H - t - 1.2, H - t], [D - 0.3, D]));
  o.push(P('stoneGrey', [-W, W], [H - t, H], [-D, D], 0.4));
  return o;
}

function rug(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, b = Math.min(8, w * 0.05, h * 0.05);
  return [
    P('taupe', [-W, W], [0, H - 0.3], [-D, D], 0.5),
    P('wool', [-W + b, W - b], [0, H], [-D + b, D - b], 0.5),
  ];
}

function dining(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const t = 4, leg = 8, lx = W - Math.min(35, w * 0.2);
  o.push(P('oak', [-W, W], [H - t, H], [-D, D], 1.5));
  for (const s of [-1, 1]) {
    o.push(P('oak', [s * lx - leg / 2, s * lx + leg / 2], [1, H - t], [-D + 15, D - 15]));          // 實木板腳
    o.push(P('champagne', [s * lx - leg / 2 - 1, s * lx + leg / 2 + 1], [0, 1], [-D + 14, D - 14]));  // 腳底的金屬墊板
  }
  o.push(P('oak', [-lx, lx], [H - t - 8, H - t], [-2, 2]));                   // 中間的橫撐
  return o;
}

function chair(w: number, h: number, H: number): Part[] {
  const W = w / 2, D = h / 2, o: Part[] = [];
  const seat = 46, leg = 3.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * (W - 3), cz = sz * (D - 3);
    o.push(P('oak', [cx - leg / 2, cx + leg / 2], [0, seat - 6], [cz - leg / 2, cz + leg / 2], 0, true));
  }
  o.push(P('oak', [-W, W], [seat - 8, seat - 5], [-D, D], 1));                // 木座框
  o.push(P('linen', [-W + 1, W - 1], [seat - 5, seat], [-D + 2, D], 2.5));    // 布座墊
  o.push(P('oak', [-W, W], [seat - 5, H], [-D, -D + 3], 1));                  // 木背框
  o.push(P('linen', [-W + 3, W - 3], [seat + 4, H - 3], [-D + 3, -D + 6], 2.5));  // 布靠墊
  return o;
}

// ---- 目錄 ------------------------------------------------------------------

/**
 * 每一件的零件。key 是目錄 id；id 的開頭刻意跟舊款同一個（`bed_`、`wardrobe`、`toilet`、
 * `vanity`、`fridge`、`shower_`、`dining`、`desk`），健檢的淨空規則與照明分區是照開頭認的
 * （health.ts `needsFor`、lightzones.ts `isBed`／`isDesk`），換成新款不該讓那些檢查失效。
 */
export const LUXE_PARTS: Record<string, (w: number, h: number, H: number) => Part[]> = {
  bed_lx: bed,
  nightstand_lx: nightstand,
  wardrobe_lx: wardrobe,
  wardrobe_lx_slide: wardrobeSlide,
  desk_lx: desk,
  tall_cabinet_lx: (w, h, H) => tallCab(w, h, H, 8, [90, 130]),
  shoe_cabinet_lx: (w, h, H) => tallCab(w, h, H, 15, [95, 125]),
  cabinet_kitchen_lx: (w, h, H) => kitchenBase(w, h, H),
  cabinet_kitchen_lx_sink: (w, h, H) => kitchenBase(w, h, H, { sink: true }),
  cabinet_kitchen_lx_hob: (w, h, H) => kitchenBase(w, h, H, { hob: true }),
  upper_cabinet_lx: upperCab,
  kitchen_island_lx: (w, h) => island(w, h),
  fridge_lx: fridge,
  toilet_lx: toilet,
  vanity_lx: vanity,
  shower_lx: shower,
  sofa_l_lx: sofaL,
  coffee_lx: coffee,
  tv_lx: tvStand,
  rug_lx: rug,
  dining_lx: dining,
  chair_lx: chair,
};

/** 零件的外框（x、y、z 的最小最大）。沒有零件時回 null。 */
export function partsBounds(parts: readonly Part[]): { x: Span; y: Span; z: Span } | null {
  if (!parts.length) return null;
  const lo = (k: 'x' | 'y' | 'z') => Math.min(...parts.map(p => p[k][0]));
  const hi = (k: 'x' | 'y' | 'z') => Math.max(...parts.map(p => p[k][1]));
  return { x: [lo('x'), hi('x')], y: [lo('y'), hi('y')], z: [lo('z'), hi('z')] };
}
