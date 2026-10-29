// 「A1 豪宅版」（B31，docs/spec-luxury.md 第四節）：從 A1 另存一份，換燈、換傢俱、補客餐廳。
//
// 純函式：A1 的方案進，豪宅版出——不碰 A1 本身（深拷貝再改）。bench/make-luxury.mjs 讀 A1、
// 叫這支、先用健檢驗「每間房照明提醒為 0」才 PUT 成另一份方案；A1 不進 repo（repo 是公開的），
// 所以 test/luxuryPlan.test.ts 只用小方案驗轉換規則。
//
// 燈的配法（agent 定，參考台灣豪宅案的常見做法）：
//   · 基礎照明：天花溝槽鋁擠線燈（linearRecessed）＋牆邊間接燈槽（linearCove），避開枕頭
//     上方 40° 以內（健檢的眩光規則），所以床頭那一圈天花不放燈，靠遠處的線燈與反射光。
//   · 重點：書桌、流理台、浴櫃鏡前、門口用崁燈（深嵌防眩、無邊框、雙頭）。
//   · 頂天衣櫃與鞋櫃：櫃門上緣裝洗牆線燈（linearWash）往櫃前打。
// 數字都是起點，最後由健檢判（每間房照明提醒為 0）。
//
// 為什麼以間接燈槽為主：均勻度是「最暗一點 ÷ 平均」，而 A1 的房間外框把幾根柱子包在裡面，
// 柱子裡的格點被牆擋住、只拿得到反射光。直射的燈加越多平均越高、最暗那點不動，均勻度反而
// 掉；燈槽打在牆上，反射的比例高。走道兩根柱子旁各補一盞崁燈，照得到柱子背面那一側。

import type { Electrical, ElectricalId, Furniture, Obj, Project } from '../model/schema';

export const LUXURY_ID = 'plan1151022lx';
export const LUXURY_NAME = 'A1 豪宅版';
export const SOURCE_ID = 'plan1151022';

/** 米白牆（乳膠漆的暖白版）、淡橡木地板的材質 id（core/materials.ts）。 */
export const WALL_COLOR = '#ece6db';
export const FLOOR_OAK = 'oakpale';

/** 角度（度）：線燈沿本地 x，照本地 −y；angle 0＝往北照、90＝往東、180＝往南、270＝往西。 */
type L = [id: string, item: ElectricalId, x: number, y: number, angle: number, length?: number, circuit?: number];

const LIGHTS: L[] = [
  // ---- Peter 房間（床頭靠西牆，枕頭約在 35,334）
  ['lx_p_cove', 'linearCove', 490.2, 307.5, 270, 425, 1],
  ['lx_p_wash', 'linearWash', 160, 522, 0, 150, 3],
  ['lx_p_coveN', 'linearCove', 167.5, 68.4, 185.71, 325, 1],
  ['lx_p_coveN2', 'linearCove', 418, 93.5, 180, 140, 1],
  ['lx_p_coveC', 'linearCove', 36.2, 104, 90, 60, 1],

  // ---- 老爸房間（空房）
  ['lx_d_coveW', 'linearCove', 505.2, 362.5, 90, 420, 1],
  ['lx_d_coveE', 'linearCove', 841.2, 372.5, 270, 400, 1],
  ['lx_d_coveN', 'linearCove', 645, 140.5, 180, 250, 1],
  ['lx_d_door', 'dlFrameless', 756, 540, 0, undefined, 2],

  // ---- 老媽房間（床頭靠東牆，枕頭約在 1178,131）
  ['lx_m_cove', 'linearCove', 856.2, 415, 90, 300, 1],
  ['lx_m_coveN', 'linearCove', 1020, 0, 180, 300, 1],
  ['lx_m_coveB', 'linearCove', 970, 58, 0, 200, 1],
  ['lx_m_desk1', 'dlDeep', 1040, 380, 0, undefined, 2],
  ['lx_m_desk2', 'dlDeep', 1150, 380, 0, undefined, 2],
  ['lx_m_wash', 'linearWash', 1082, 531.4, 0, 150, 3],

  // ---- 衛浴 A
  ['lx_ba_line', 'linearRecessed', 1280, 475, 90, 210, 1],
  ['lx_ba_shower', 'dlDeep', 1296, 255, 0, undefined, 1],
  ['lx_ba_mirror', 'dlFrameless', 1290, 441, 0, undefined, 2],

  // ---- 衛浴 B
  ['lx_bb_line', 'linearRecessed', 1030, 650, 0, 120, 1],
  ['lx_bb_mirror', 'dlFrameless', 1074, 705, 0, undefined, 2],
  ['lx_bb_shower', 'dlFrameless', 1156, 713, 0, undefined, 1],

  // ---- Bruce 房間（床頭靠東牆，枕頭約在 1212,1009）
  ['lx_b_line', 'linearRecessed', 980, 995, 90, 230, 1],
  ['lx_b_coveS', 'linearCove', 1050, 1226.8, 0, 270, 1],
  ['lx_b_desk1', 'dlDeep', 1020, 1180, 0, undefined, 2],
  ['lx_b_desk2', 'dlDeep', 1090, 1190, 0, undefined, 2],
  ['lx_b_wash1', 'linearWash', 1090, 854, 180, 270, 3],
  ['lx_b_wash2', 'linearWash', 907.8, 1107, 90, 215, 3],
  ['lx_b_door', 'dlFrameless', 905, 775, 0, undefined, 2],

  // ---- 客廳＋廚房：玄關
  ['lx_f_wash', 'linearWash', 62, 672, 90, 135, 3],
  ['lx_f_dl1', 'dlFrameless', 150, 640, 0, undefined, 1],
  ['lx_f_dl2', 'dlFrameless', 150, 710, 0, undefined, 1],
  // 走道與東側小廳（dlW／dlE 在兩根柱子的北端，見檔頭）
  ['lx_h_dlW', 'dlFrameless', 246, 690, 0, undefined, 1],
  ['lx_h_dlE', 'dlFrameless', 838, 698, 0, undefined, 1],
  ['lx_h_coveN', 'linearCove', 605, 595.4, 180, 200, 1],
  ['lx_h_coveN2', 'linearCove', 452, 597, 180, 70, 1],
  ['lx_h_line', 'linearRecessed', 550, 675, 0, 300, 1],
  ['lx_e_dl', 'dlFrameless', 900, 660, 0, undefined, 1],
  // 客廳
  ['lx_l_tvwash', 'linearWash', 814.6, 922, 270, 230, 3],
  ['lx_l_coveS', 'linearCove', 700, 1039.9, 0, 260, 1],
  ['lx_l_coveS2', 'linearCove', 510, 1036.8, 0, 90, 1],
  ['lx_l_tallwash', 'linearWash', 285.5, 893, 90, 160, 3],
  // 餐廳
  ['lx_dn_line', 'linearSurface', 415, 880, 0, 140, 2],
  // 廚房
  ['lx_k_line', 'linearRecessed', 400, 1190, 0, 280, 1],
  ['lx_k_dl1', 'dlFrameless', 330, 1195, 0, undefined, 2],
  ['lx_k_dl2', 'dlFrameless', 410, 1195, 0, undefined, 2],
  ['lx_k_dl3', 'dlFrameless', 500, 1195, 0, undefined, 2],
  ['lx_k_dl4', 'dlFrameless', 270, 1110, 0, undefined, 2],
];

/** A1 的傢俱目錄 id → 新款。不在 RESIZE 裡的照原位原尺寸。 */
const SWAP: Record<string, string> = {
  bed_double: 'bed_lx',
  nightstand: 'nightstand_lx',
  desk: 'desk_lx',
  shoe_cabinet: 'shoe_cabinet_lx',
  tall_cabinet: 'tall_cabinet_lx',
  fridge: 'fridge_lx',
  cabinet_kitchen: 'cabinet_kitchen_lx',
  sink: 'cabinet_kitchen_lx_sink',
  stove: 'cabinet_kitchen_lx_hob',
  shower: 'shower_lx',
  toilet: 'toilet_lx',
  vanity: 'vanity_lx',
};
/** 寬 180 以上的衣櫃用推拉門，窄的用對開。 */
const wardrobeFor = (w: number) => (w >= 180 ? 'wardrobe_lx_slide' : 'wardrobe_lx');

/** 照原位會出問題的幾件，微調位置或尺寸。 */
const RESIZE: Record<string, Partial<Furniture>> = {
  // 老媽房間東北角的櫃子在 A1 離北牆 15cm，推到貼牆：那條縫只照得到反射光，整間的均勻度被它拉低。
  b5_fb7: { y: 5 },
  // 南側流理台：一整條拆成 下櫃｜水槽｜下櫃｜爐台，新款的水槽與爐台才不會跟下櫃疊在一起。
  b6_kit_counter_s: { x: 244.1, w: 50.9 },
};
const EXTRA_COUNTER: Furniture = {
  id: 'lx_kit_counter_mid', kind: 'furniture', layer: 'furniture', item: 'cabinet_kitchen_lx', label: '流理台',
  x: 366, y: 1167, w: 88, h: 59.8, angle: 180,
};

const f = (id: string, item: string, label: string, cx: number, cy: number, w: number, h: number, angle: number): Furniture => ({
  id, kind: 'furniture', layer: 'furniture', item, label, x: cx - w / 2, y: cy - h / 2, w, h, angle,
});
/** 客餐廳補的基本配置：L 型沙發面東看電視，餐桌靠廚房那一側。 */
const ADD: Furniture[] = [
  f('lx_rug', 'rug_lx', '地毯', 650, 925, 210, 170, 90),
  f('lx_sofa', 'sofa_l_lx', 'L 型沙發', 625, 895, 260, 170, 270),
  f('lx_coffee', 'coffee_lx', '茶几', 680, 940, 120, 60, 90),
  f('lx_tv', 'tv_lx', '電視櫃', 794.6, 940, 200, 40, 90),
  f('lx_dining', 'dining_lx', '餐桌', 415, 880, 180, 90, 0),
  f('lx_chair1', 'chair_lx', '餐椅', 370, 807.5, 48, 55, 0),
  f('lx_chair2', 'chair_lx', '餐椅', 460, 807.5, 48, 55, 0),
  f('lx_chair3', 'chair_lx', '餐椅', 370, 952.5, 48, 55, 180),
  f('lx_chair4', 'chair_lx', '餐椅', 460, 952.5, 48, 55, 180),
];

const isOldLight = (o: Obj) => o.kind === 'electrical' && (o.item === 'downlight' || o.item === 'batten');

/** A1 → A1 豪宅版。輸入不會被改到。 */
export function makeLuxury(src: Project): Project {
  const p: Project = structuredClone(src);
  p.id = LUXURY_ID;
  p.name = LUXURY_NAME;
  for (const fl of p.floors) {
    const out: Obj[] = [];
    for (const o of fl.objects) {
      if (isOldLight(o)) continue;
      if (o.kind === 'furniture') {
        const item = o.item === 'wardrobe' ? wardrobeFor(o.w) : SWAP[o.item] ?? o.item;
        out.push({ ...o, item, ...RESIZE[o.id] });
        if (o.id === 'b6_kit_counter_s') out.push(structuredClone(EXTRA_COUNTER));
        continue;
      }
      if (o.kind === 'room' && o.floor === 'wood') { out.push({ ...o, floor: FLOOR_OAK }); continue; }
      if (o.kind === 'wall') { out.push({ ...o, color: WALL_COLOR }); continue; }
      out.push(o);
    }
    out.push(...ADD.map(a => structuredClone(a)));
    for (const [id, item, x, y, angle, length, circuit] of LIGHTS) {
      const e: Electrical = { id, kind: 'electrical', layer: 'electrical', item, x, y, angle, circuit: circuit ?? 1 };
      if (length !== undefined) e.length = length;
      out.push(e);
    }
    fl.objects = out;
  }
  return p;
}
