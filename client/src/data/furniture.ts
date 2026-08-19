// Furniture catalog. Each item draws a top-down pictogram in its own local
// centimeter coordinates (0,0 top-left .. w,h). The renderer sets the canvas
// transform so 1 unit = 1 cm, and lineWidth is given in cm.

export interface FurnitureItem {
  id: string;
  name: string;
  cat: string;
  w: number; // cm
  h: number; // cm
  /**
   * Where the piece hangs. Absent means it stands on the floor.
   *
   * A pendant lamp or a ceiling fan dropped at elevation 0 lies on the carpet,
   * and the only way out is for the user to know that `離地板距離` exists and
   * what number to type. The place tool works the height out from the storey it
   * is being dropped into — the ceiling is not a constant, so the catalogue
   * cannot carry the answer, only the intent.
   */
  mount?: 'ceiling' | 'wall';
  /**
   * Real height in centimetres, where the model's own is wrong.
   *
   * The footprint comes from `w`/`h` and the height follows the smaller of the
   * two scales — fine when the model's proportions are real, wrong when they are
   * not. Kenney authored a kitchen base unit as a 43×48×45 cube, so scaled to a
   * 180×60 run it came out 56 cm tall instead of 85. Anything with a standard
   * height says it here rather than hoping the arithmetic lands.
   */
  height?: number;
  /**
   * Visual style, for the palette's filter row.
   *
   * Assigned **by looking at every model's render**, not by parsing its name.
   * The names lie in both directions: `modern_coffee_table_02` is modern but
   * `sofa_01` `sofa_02` `sofa_03` are a carved settee, a tufted chesterfield
   * loveseat and a rolled-arm leather three-seater — three different centuries
   * under three consecutive numbers. A first pass done on filenames put 79 of
   * 127 in 現代, including the chesterfields, an arched ornate mirror, a
   * six-arm brass chandelier and a rocking chair. A filter that lies is worse
   * than no filter, so the tags were re-cut from a contact sheet of the
   * thumbnails.
   */
  style?: '現代' | '古典' | '鄉村' | '工業' | '中式' | '日式' | '北歐';
  /**
   * Built by `furniture3d.ts` on purpose, with no downloaded model behind it.
   *
   * Everything else falls back to procedural geometry only when its model is
   * missing, which is a fault the harness checks for. These are not a fault —
   * a wardrobe's variety lives in its front, and no CC0 scan library has a
   * second wardrobe to download.
   */
  proc?: boolean;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  // Clamp, because a thin piece makes an inset negative: the 立鏡 is 3 cm deep,
  // so an inner outline drawn at `h - 6` asks for a -1.5 radius, `arcTo` throws
  // IndexSizeError — and since the palette draws every pictogram while it is
  // being built, one bad item took the whole app down before `__app` was even
  // assigned. A pictogram must not be able to do that.
  w = Math.max(0, w); h = Math.max(0, h);
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (w === 0 || h === 0) return;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const body = (ctx: CanvasRenderingContext2D) => { ctx.fillStyle = '#3a4150'; ctx.strokeStyle = '#e0b45a'; ctx.lineWidth = 2; };

// Generic cabinet/櫃子 pictogram: a box with a front-face line and `doors`
// vertical divisions (top-down view of a cabinet run).
function cabinet(ctx: CanvasRenderingContext2D, w: number, h: number, doors = 2) {
  body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#e0b45a88';
  ctx.beginPath(); ctx.moveTo(3, h - 5); ctx.lineTo(w - 3, h - 5); ctx.stroke();   // front face edge
  for (let i = 1; i < doors; i++) { const x = w * i / doors; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
}
// chest-of-drawers pictogram: horizontal drawer bands each with a centered handle
function drawers(ctx: CanvasRenderingContext2D, w: number, h: number, n = 3) {
  body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#e0b45a88';
  for (let i = 1; i < n; i++) { const y = h * i / n; ctx.beginPath(); ctx.moveTo(3, y); ctx.lineTo(w - 3, y); ctx.stroke(); }
  ctx.fillStyle = '#e0b45a99';
  for (let i = 0; i < n; i++) ctx.fillRect(w / 2 - 7, h * (i + 0.5) / n - 1, 14, 2);
}
// open shelving pictogram: outline + internal shelves, no doors
function openShelf(ctx: CanvasRenderingContext2D, w: number, h: number, n = 3) {
  ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#e0b45a'; ctx.lineWidth = 2;
  rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#e0b45a66';
  for (let i = 1; i < n; i++) { const y = h * i / n; ctx.beginPath(); ctx.moveTo(3, y); ctx.lineTo(w - 3, y); ctx.stroke(); }
}
// glass display cabinet pictogram: tinted body with light door mullions
function glassCab(ctx: CanvasRenderingContext2D, w: number, h: number, doors = 2) {
  ctx.fillStyle = '#31414e'; ctx.strokeStyle = '#e0b45a'; ctx.lineWidth = 2;
  rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#9fd4ffaa';
  ctx.beginPath(); ctx.moveTo(3, h - 5); ctx.lineTo(w - 3, h - 5); ctx.stroke();
  for (let i = 1; i < doors; i++) { const x = w * i / doors; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
}

export const FURNITURE: FurnitureItem[] = [
  // 客廳
  { id: 'sofa', name: '沙發', style: '古典', cat: '客廳', w: 158, h: 66, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      rr(ctx, 8, 22, w - 16, h - 30, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 3, 22); ctx.lineTo(w / 3, h - 8); ctx.moveTo(2 * w / 3, 22); ctx.lineTo(2 * w / 3, h - 8); ctx.stroke();
    } },
  { id: 'armchair', name: '單椅', style: '北歐', cat: '客廳', w: 82, h: 99, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 18, w - 16, h - 26, 6); ctx.stroke();
    } },
  { id: 'coffee', name: '茶几', style: '現代', cat: '客廳', w: 120, h: 60, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke(); } },
  { id: 'tv', name: '電視櫃', style: '現代', cat: '客廳', w: 150, h: 40, height: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; ctx.beginPath(); ctx.moveTo(w * 0.2, 6); ctx.lineTo(w * 0.8, 6); ctx.stroke();
    } },
  { id: 'rug', name: '地毯', style: '現代', cat: '客廳', w: 200, h: 140, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.setLineDash([10, 8]); rr(ctx, 10, 10, w - 20, h - 20, 3); ctx.stroke(); ctx.setLineDash([]);
    } },
  { id: 'plant', name: '植栽', style: '現代', cat: '客廳', w: 40, h: 40, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  // 餐廳
  { id: 'dining', name: '餐桌', style: '鄉村', cat: '餐廳', w: 226, h: 139, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke(); } },
  { id: 'chair', name: '餐椅', style: '古典', cat: '餐廳', w: 43, h: 58, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke(); } },
  // 臥室
  { id: 'bed_double', name: '雙人床', style: '現代', cat: '臥室', w: 150, h: 200, height: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w / 2 - 12, 40, 4); ctx.stroke(); rr(ctx, w / 2 + 4, 8, w / 2 - 12, 40, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 60); ctx.lineTo(w - 6, 60); ctx.stroke();
    } },
  { id: 'bed_single', name: '單人床', style: '現代', cat: '臥室', w: 100, h: 200, height: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 12, 8, w - 24, 40, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 58); ctx.lineTo(w - 6, 58); ctx.stroke();
    } },
  // 廚房
  { id: 'stove', name: '爐具', style: '現代', cat: '廚房', w: 60, h: 60, height: 85, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#ff5c72'; [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].forEach(([px, py]) => { ctx.beginPath(); ctx.arc(w * px, h * py, 8, 0, 7); ctx.stroke(); });
    } },
  { id: 'fridge', name: '冰箱', style: '現代', cat: '廚房', w: 70, h: 70, height: 180, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; ctx.beginPath(); ctx.moveTo(6, h / 2); ctx.lineTo(w - 6, h / 2); ctx.stroke();
    } },
  { id: 'sink', name: '水槽', style: '現代', cat: '廚房', w: 80, h: 50, height: 85, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; rr(ctx, 10, 10, w - 20, h - 20, 6); ctx.stroke();
    } },
  // 浴室
  { id: 'toilet', name: '馬桶', style: '現代', cat: '浴室', w: 40, h: 60, height: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 4, 0, w - 8, 18, 4); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(w / 2, h * 0.62, w / 2 - 4, h * 0.32, 0, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'bathtub', name: '浴缸', style: '現代', cat: '浴室', w: 160, h: 75, height: 55, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; rr(ctx, 10, 10, w - 20, h - 20, 8); ctx.stroke();
    } },
  { id: 'shower', name: '淋浴間', style: '現代', cat: '浴室', w: 90, h: 90, height: 200, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#7bc6ff'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 6, 0, 7); ctx.stroke();
    } },
  { id: 'desk', name: '書桌', style: '現代', cat: '書房', w: 200, h: 95, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke(); } },
  // 櫃子 — filed under the room each belongs to
  { id: 'cabinet_storage', name: '收納櫃', style: '古典', cat: '客廳', w: 90, h: 40, height: 82, draw(ctx, w, h) { cabinet(ctx, w, h, 2); } },
  { id: 'display_cabinet', name: '展示櫃', style: '現代', cat: '客廳', w: 108, h: 37, draw(ctx, w, h) { glassCab(ctx, w, h, 2); } },
  { id: 'shoe_cabinet', name: '鞋櫃', style: '古典', cat: '客廳', w: 100, h: 35, height: 100, draw(ctx, w, h) { cabinet(ctx, w, h, 3); } },
  { id: 'cabinet_side', name: '餐邊櫃', style: '現代', cat: '餐廳', w: 244, h: 52, draw(ctx, w, h) { cabinet(ctx, w, h, 3); } },
  { id: 'wardrobe', name: '衣櫃', style: '古典', cat: '臥室', w: 120, h: 60, height: 200, draw(ctx, w, h) { cabinet(ctx, w, h, 2); } },
  { id: 'dresser', name: '五斗櫃', style: '工業', cat: '臥室', w: 114, h: 49, draw(ctx, w, h) { drawers(ctx, w, h, 4); } },
  { id: 'nightstand', name: '床頭櫃', style: '古典', cat: '臥室', w: 57, h: 42, draw(ctx, w, h) { drawers(ctx, w, h, 2); } },
  { id: 'cabinet_kitchen', name: '廚櫃', style: '現代', cat: '廚房', w: 180, h: 60, height: 85, draw(ctx, w, h) { cabinet(ctx, w, h, 4); } },
  { id: 'tall_cabinet', name: '高櫃', style: '鄉村', cat: '廚房', w: 60, h: 50, height: 200, draw(ctx, w, h) { cabinet(ctx, w, h, 2); } },
  { id: 'vanity', name: '浴櫃', style: '現代', cat: '浴室', w: 80, h: 50, height: 80, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
      ctx.strokeStyle = '#7bc6ff'; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * 0.26, h * 0.28, 0, 0, 7); ctx.stroke();
    } },
  { id: 'bookshelf', name: '書櫃', style: '工業', cat: '書房', w: 110, h: 50, draw(ctx, w, h) { openShelf(ctx, w, h, 4); } },
  { id: 'open_shelf', name: '開放層架', style: '工業', cat: '書房', w: 90, h: 30, height: 180, draw(ctx, w, h) { openShelf(ctx, w, h, 3); } },

  // ---- 有 CC0 實掃模型的新款式（scripts/fetch_models.py）------------------
  // 尺寸就是模型本身量到的真實尺寸，不是估的。
  { id: 'sofa_l', name: 'L型沙發', style: '古典', cat: '客廳', w: 273, h: 92, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      rr(ctx, 8, 22, w * 0.62, h - 30, 8); ctx.stroke();
      rr(ctx, w * 0.66, 10, w * 0.3, h - 18, 8); ctx.stroke();
    } },
  { id: 'lounge', name: '休閒單椅', style: '北歐', cat: '客廳', w: 101, h: 119, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 14); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 10, 26, w - 20, h - 40, 10); ctx.stroke();
    } },
  { id: 'ottoman', name: '腳凳', style: '北歐', cat: '客廳', w: 88, h: 62, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 7, w - 14, h - 14, 7); ctx.stroke();
    } },
  { id: 'side_table', name: '邊几', style: '鄉村', cat: '客廳', w: 55, h: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; ctx.beginPath(); ctx.moveTo(6, h / 2); ctx.lineTo(w - 6, h / 2); ctx.stroke();
    } },
  { id: 'roundtable', name: '圓餐桌', style: '古典', cat: '餐廳', w: 140, h: 140, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 10, 0, 7); ctx.stroke();
    } },
  { id: 'stool', name: '椅凳', style: '鄉村', cat: '餐廳', w: 42, h: 44, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },

  // ---- 第三批款式：全部有 CC0 實掃模型，尺寸是模型量到的真實尺寸 --------
  { id: 'armchair_classic', name: '經典單椅', style: '古典', cat: '客廳', w: 85, h: 77, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'accent_chair', name: '造型單椅', style: '古典', cat: '客廳', w: 67, h: 66, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'rocking', name: '搖椅', style: '鄉村', cat: '客廳', w: 71, h: 83, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'sofa_2', name: '雙人沙發', style: '古典', cat: '客廳', w: 181, h: 82, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 2, 20); ctx.lineTo(w / 2, h - 8); ctx.stroke();
    } },
  { id: 'bench', name: '長凳', style: '鄉村', cat: '客廳', w: 116, h: 50, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; ctx.beginPath(); ctx.moveTo(6, h / 2); ctx.lineTo(w - 6, h / 2); ctx.stroke();
    } },
  { id: 'console', name: '玄關桌', style: '古典', cat: '客廳', w: 154, h: 59, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'coffee_round', name: '圓茶几', style: '現代', cat: '客廳', w: 130, h: 130, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'side_tall', name: '高邊几', style: '古典', cat: '客廳', w: 38, h: 38, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'mirror', name: '立鏡', style: '古典', cat: '客廳', w: 49, h: 3, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#9fd4ffaa'; const i = Math.min(3, w / 6, h / 6); rr(ctx, i, i, w - i * 2, h - i * 2, 2); ctx.stroke();
    } },
  { id: 'table_wood', name: '實木長桌', style: '鄉村', cat: '餐廳', w: 180, h: 66, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'stool_fold', name: '折凳', style: '鄉村', cat: '餐廳', w: 53, h: 55, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'stool_bar', name: '吧檯椅', style: '工業', cat: '餐廳', w: 35, h: 36, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'cabinet_painted', name: '烤漆收納櫃', style: '鄉村', cat: '客廳', w: 120, h: 62, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'shelf_narrow', name: '窄層架', style: '工業', cat: '客廳', w: 59, h: 50, draw(ctx, w, h) {
      openShelf(ctx, w, h, 4);
    } },
  { id: 'bookshelf_wood', name: '實木書櫃', style: '鄉村', cat: '書房', w: 137, h: 58, draw(ctx, w, h) {
      openShelf(ctx, w, h, 4);
    } },
  { id: 'shelf_wall', name: '壁掛層架', style: '鄉村', cat: '書房', w: 51, h: 37, draw(ctx, w, h) {
      openShelf(ctx, w, h, 4);
    } },
  { id: 'daybed', name: '貴妃椅', style: '古典', cat: '臥室', w: 197, h: 86, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 2, 20); ctx.lineTo(w / 2, h - 8); ctx.stroke();
    } },
  { id: 'cn_armchair', name: '太師椅', style: '中式', cat: '中式', w: 85, h: 79, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'cn_cabinet', name: '中式高櫃', style: '中式', cat: '中式', w: 126, h: 54, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'cn_teatable', name: '中式茶几', style: '中式', cat: '中式', w: 84, h: 84, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'cn_screen', name: '屏風', style: '中式', cat: '中式', w: 129, h: 38, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      for (let i = 1; i < 4; i++) { const x = w * i / 4; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    } },
  { id: 'cn_console', name: '中式條案', style: '中式', cat: '中式', w: 172, h: 34, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },

  // ---- 裝潢素材：燈具與擺飾。mount 決定放下去時離地多高 ------------------
  { id: 'lamp_ceiling', name: '吸頂燈', style: '現代', cat: '燈具', w: 43, h: 43, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 5, 0, 7); ctx.stroke();
    } },
  { id: 'lamp_pendant', name: '吊燈', style: '古典', cat: '燈具', w: 68, h: 62, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 5, 0, 7); ctx.stroke();
    } },
  { id: 'cn_chandelier', name: '中式吊燈', style: '中式', cat: '燈具', w: 88, h: 88, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 5, 0, 7); ctx.stroke();
    } },
  { id: 'fan_ceiling', name: '吊扇', style: '現代', cat: '燈具', w: 146, h: 146, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#9fd4ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + Math.cos(a) * (w / 2 - 5), h / 2 + Math.sin(a) * (h / 2 - 5)); ctx.stroke(); }
    } },
  { id: 'lamp_wall', name: '壁燈', style: '工業', cat: '燈具', w: 15, h: 25, mount: 'wall', draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'plant_large', name: '大型盆栽', style: '現代', cat: '裝飾', w: 70, h: 66, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, 7); ctx.stroke();
    } },
  { id: 'plant_small', name: '小盆栽', style: '現代', cat: '裝飾', w: 17, h: 19, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, 7); ctx.stroke();
    } },
  { id: 'pot_ceramic', name: '陶盆', style: '鄉村', cat: '裝飾', w: 66, h: 50, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'vase', name: '花瓶', style: '現代', cat: '裝飾', w: 20, h: 21, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'basket', name: '藤籃', style: '鄉村', cat: '裝飾', w: 38, h: 30, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'tv_set', name: '電視', style: '現代', cat: '裝飾', w: 60, h: 47, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'clock', name: '時鐘', style: '古典', cat: '裝飾', w: 23, h: 17, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },

  // ---- Kenney（CC0）補的三件，目錄本來沒有 --------------------------------
  // 尺寸是台灣住宅的實際尺寸，不是模型的——Kenney 的套件在固定格線上做，衣櫃只有
  // 56cm 寬、廚櫃 43cm。載入器本來就會把模型等比縮到物件的 w/h，所以目錄要放對的
  // 那一個。
  { id: 'washer', name: '洗衣機', style: '現代', cat: '廚房', w: 60, h: 60, height: 85, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#9fd4ffaa'; ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 3, 0, 7); ctx.stroke();
    } },
  { id: 'microwave', name: '微波爐', style: '現代', cat: '廚房', w: 50, h: 38, height: 30, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; ctx.beginPath(); ctx.moveTo(w * 0.72, 4); ctx.lineTo(w * 0.72, h - 4); ctx.stroke();
    } },
  { id: 'coat_rack', name: '衣帽架', style: '工業', cat: '客廳', w: 45, h: 45, height: 170, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4;
        ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + Math.cos(a) * (w / 2 - 6), h / 2 + Math.sin(a) * (h / 2 - 6)); ctx.stroke(); }
    } },


  // ---- 第四批：Kenney（CC0）。尺寸是台灣住宅的實際尺寸，不是模型的 ------
  { id: 'range_hood', name: '抽油煙機', style: '現代', cat: '廚房', w: 90, h: 50, height: 60, mount: 'wall', draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'upper_cabinet', name: '廚房吊櫃', style: '現代', cat: '廚房', w: 80, h: 35, height: 70, mount: 'wall', draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'kitchen_island', name: '中島', style: '現代', cat: '廚房', w: 180, h: 90, height: 90, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'dryer', name: '烘衣機', style: '現代', cat: '廚房', w: 60, h: 60, height: 85, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'coffee_machine', name: '咖啡機', style: '現代', cat: '廚房', w: 30, h: 35, height: 35, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'toilet_square', name: '方型馬桶', style: '現代', cat: '浴室', w: 40, h: 70, height: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'shower_round', name: '圓形淋浴間', style: '現代', cat: '浴室', w: 90, h: 90, height: 200, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'trashcan', name: '垃圾桶', style: '現代', cat: '浴室', w: 40, h: 40, height: 60, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'sofa_corner', name: 'L型布沙發', style: '現代', cat: '客廳', w: 240, h: 240, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w * 0.6, h - 16, 8); ctx.stroke();
      rr(ctx, w * 0.62, 8, w * 0.34, h * 0.55, 8); ctx.stroke();
    } },
  { id: 'table_glass', name: '玻璃桌', style: '現代', cat: '客廳', w: 120, h: 60, draw(ctx, w, h) {
      ctx.fillStyle = '#31414e'; ctx.strokeStyle = '#9fd4ff'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke();
    } },
  { id: 'side_drawers', name: '抽屜邊几', style: '現代', cat: '客廳', w: 45, h: 40, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'rug_round', name: '圓地毯', style: '現代', cat: '客廳', w: 160, h: 160, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 9, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    } },
  { id: 'rug_square', name: '方地毯', style: '現代', cat: '客廳', w: 200, h: 200, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.setLineDash([8, 6]); rr(ctx, 7, 7, w - 14, h - 14, 3); ctx.stroke(); ctx.setLineDash([]);
    } },
  { id: 'doormat', name: '門墊', style: '現代', cat: '客廳', w: 75, h: 45, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.setLineDash([8, 6]); rr(ctx, 7, 7, w - 14, h - 14, 3); ctx.stroke(); ctx.setLineDash([]);
    } },
  { id: 'tv_wall', name: '壁掛電視', style: '現代', cat: '客廳', w: 120, h: 10, mount: 'wall', draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'pillow', name: '抱枕', style: '現代', cat: '客廳', w: 45, h: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'lamp_floor', name: '立燈', style: '現代', cat: '燈具', w: 40, h: 40, draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'lamp_table', name: '檯燈', style: '現代', cat: '燈具', w: 25, h: 25, draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'lamp_flush', name: '方型吸頂燈', style: '現代', cat: '燈具', w: 40, h: 40, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'chair_desk', name: '辦公椅', style: '現代', cat: '書房', w: 60, h: 60, height: 95, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 14, w - 14, h - 22, 6); ctx.stroke();
    } },
  { id: 'desk_corner', name: 'L型書桌', style: '現代', cat: '書房', w: 160, h: 140, height: 75, draw(ctx, w, h) {
      body(ctx);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.42);
      ctx.lineTo(w * 0.45, h * 0.42); ctx.lineTo(w * 0.45, h); ctx.lineTo(0, h);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } },
  { id: 'stairs', name: '樓梯', style: '現代', cat: '常用', w: 100, h: 300, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      for (let i = 1; i < 9; i++) { const y = h * i / 9; ctx.beginPath(); ctx.moveTo(3, y); ctx.lineTo(w - 3, y); ctx.stroke(); }
    } },

  // ---- 第五批：多種風格，全部 Poly Haven 實掃。尺寸就是模型量到的真實尺寸 --
  { id: 'chair_painted', name: '彩繪餐椅', style: '鄉村', cat: '餐廳', w: 43, h: 54, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 14, w - 14, h - 22, 6); ctx.stroke();
    } },
  { id: 'chair_country', name: '鄉村單椅', style: '鄉村', cat: '客廳', w: 64, h: 66, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 14, w - 14, h - 22, 6); ctx.stroke();
    } },
  { id: 'chair_school', name: '書桌椅', style: '工業', cat: '書房', w: 57, h: 68, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 14, w - 14, h - 22, 6); ctx.stroke();
    } },
  { id: 'chair_plastic', name: '塑膠椅', style: '工業', cat: '餐廳', w: 64, h: 63, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 14, w - 14, h - 22, 6); ctx.stroke();
    } },
  { id: 'chair_arm_wood', name: '木扶手椅', style: '古典', cat: '客廳', w: 58, h: 60, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 14, w - 14, h - 22, 6); ctx.stroke();
    } },
  { id: 'cn_stool', name: '中式圓凳', style: '中式', cat: '中式', w: 60, h: 51, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'stool_low', name: '矮凳', style: '工業', cat: '客廳', w: 45, h: 47, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'stool_tall', name: '高腳凳', style: '工業', cat: '餐廳', w: 46, h: 47, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'stool_bar_round', name: '圓吧檯椅', style: '古典', cat: '餐廳', w: 48, h: 49, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'stool_painted', name: '彩繪小凳', style: '鄉村', cat: '客廳', w: 38, h: 41, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'chair_swivel', name: '造型旋轉椅', style: '古典', cat: '客廳', w: 76, h: 133, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 14, w - 14, h - 22, 6); ctx.stroke();
    } },
  { id: 'sofa_painted', name: '彩繪木沙發', style: '鄉村', cat: '客廳', w: 245, h: 79, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'cn_sofa', name: '中式沙發', style: '中式', cat: '中式', w: 228, h: 97, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'coffee_big', name: '大茶几', style: '鄉村', cat: '客廳', w: 154, h: 97, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'coffee_square', name: '方茶几', style: '現代', cat: '客廳', w: 120, h: 120, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'coffee_classic', name: '古典圓茶几', style: '古典', cat: '客廳', w: 144, h: 144, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'coffee_industrial', name: '工業風茶几', style: '工業', cat: '客廳', w: 78, h: 76, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'table_round_small', name: '小圓桌', style: '古典', cat: '餐廳', w: 80, h: 80, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'table_painted', name: '彩繪長桌', style: '鄉村', cat: '餐廳', w: 241, h: 114, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'table_wood2', name: '木餐桌', style: '鄉村', cat: '餐廳', w: 113, h: 71, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'table_small', name: '小邊桌', style: '鄉村', cat: '客廳', w: 92, h: 44, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'table_low', name: '矮木桌', style: '古典', cat: '客廳', w: 83, h: 52, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'desk_school', name: '書桌', style: '工業', cat: '書房', w: 71, h: 55, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'side_tiny', name: '小方几', style: '古典', cat: '客廳', w: 30, h: 30, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'console_wood', name: '木條桌', style: '鄉村', cat: '客廳', w: 133, h: 56, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'cabinet_classic', name: '古典櫃', style: '古典', cat: '客廳', w: 172, h: 113, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'nightstand_painted', name: '彩繪床頭櫃', style: '鄉村', cat: '臥室', w: 50, h: 51, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'shelf_wide', name: '寬層架', style: '工業', cat: '書房', w: 235, h: 72, draw(ctx, w, h) {
      openShelf(ctx, w, h, 4);
    } },
  { id: 'rack_metal', name: '金屬層架', style: '工業', cat: '書房', w: 92, h: 60, draw(ctx, w, h) {
      openShelf(ctx, w, h, 4);
    } },
  { id: 'cart_storage', name: '收納推車', style: '工業', cat: '廚房', w: 160, h: 110, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'cn_commode', name: '中式條櫃', style: '中式', cat: '中式', w: 449, h: 117, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'bed_classic', name: '古典床', style: '古典', cat: '臥室', w: 149, h: 204, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w - 16, 38, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 54); ctx.lineTo(w - 6, 54); ctx.stroke();
    } },
  { id: 'bed_frame', name: '鐵床架', style: '古典', cat: '臥室', w: 90, h: 200, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w - 16, 38, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 54); ctx.lineTo(w - 6, 54); ctx.stroke();
    } },

  // ---- 參數化衣櫃：CC0 圖庫沒有第二個衣櫃，而衣櫃的款式全在正面 ----
  { id: 'wardrobe_2door', name: '對開衣櫃', style: '現代', cat: '臥室', proc: true, w: 120, h: 60, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'wardrobe_3door', name: '三門衣櫃', style: '現代', cat: '臥室', proc: true, w: 180, h: 60, draw(ctx, w, h) {
      cabinet(ctx, w, h, 3);
    } },
  { id: 'wardrobe_4door', name: '四門衣櫃', style: '古典', cat: '臥室', proc: true, w: 240, h: 62, draw(ctx, w, h) {
      cabinet(ctx, w, h, 4);
    } },
  { id: 'wardrobe_slide', name: '推拉衣櫃', style: '現代', cat: '臥室', proc: true, w: 160, h: 65, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
      ctx.strokeStyle = '#e0b45a55'; ctx.beginPath(); ctx.moveTo(2, h - 2); ctx.lineTo(w - 2, h - 2); ctx.stroke();
    } },
  { id: 'wardrobe_slide3', name: '三門推拉衣櫃', style: '現代', cat: '臥室', proc: true, w: 240, h: 65, draw(ctx, w, h) {
      cabinet(ctx, w, h, 3);
      ctx.strokeStyle = '#e0b45a55'; ctx.beginPath(); ctx.moveTo(2, h - 2); ctx.lineTo(w - 2, h - 2); ctx.stroke();
    } },
  { id: 'wardrobe_mirror', name: '鏡面衣櫃', style: '現代', cat: '臥室', proc: true, w: 180, h: 60, draw(ctx, w, h) {
      cabinet(ctx, w, h, 3);
      ctx.fillStyle = '#cfe3f0aa'; ctx.fillRect(w * 0.36, 2, w * 0.28, h - 4);
    } },
  { id: 'wardrobe_mirror_slide', name: '推拉鏡衣櫃', style: '現代', cat: '臥室', proc: true, w: 180, h: 65, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
      ctx.strokeStyle = '#e0b45a55'; ctx.beginPath(); ctx.moveTo(2, h - 2); ctx.lineTo(w - 2, h - 2); ctx.stroke();
      ctx.fillStyle = '#cfe3f0aa'; ctx.fillRect(w * 0.36, 2, w * 0.28, h - 4);
    } },
  { id: 'wardrobe_open', name: '開放式衣櫃', style: '工業', cat: '臥室', proc: true, w: 150, h: 58, draw(ctx, w, h) {
      openShelf(ctx, w, h, 3);
    } },
  { id: 'wardrobe_open_oak', name: '胡桃開放衣櫃', style: '鄉村', cat: '臥室', proc: true, w: 140, h: 58, draw(ctx, w, h) {
      openShelf(ctx, w, h, 3);
    } },
  { id: 'wardrobe_top', name: '含頂櫃衣櫃', style: '現代', cat: '臥室', proc: true, w: 180, h: 60, draw(ctx, w, h) {
      cabinet(ctx, w, h, 3);
    } },
  { id: 'wardrobe_white', name: '白色衣櫃', style: '現代', cat: '臥室', proc: true, w: 120, h: 60, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'wardrobe_grey', name: '灰色衣櫃', style: '現代', cat: '臥室', proc: true, w: 180, h: 60, draw(ctx, w, h) {
      cabinet(ctx, w, h, 3);
    } },
  { id: 'wardrobe_walnut', name: '胡桃木衣櫃', style: '古典', cat: '臥室', proc: true, w: 120, h: 62, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'wardrobe_kids', name: '兒童衣櫃', style: '現代', cat: '臥室', proc: true, w: 100, h: 55, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },

  // ---- 日式與北歐：新增的兩個風格分類。實掃圖庫沒有和室家具，但這兩個風格的
  // 辨識度幾乎全在材料（藺草、障子紙、藤編），而材料是掃得到的 ----
  { id: 'jp_tatami', name: '榻榻米地台', style: '日式', cat: '臥室', proc: true, w: 180, h: 90, draw(ctx, w, h) {
      ctx.fillStyle = '#4a5138'; ctx.strokeStyle = '#c9c07a'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c9c07a66';
      for (let i = 1; i < Math.max(2, Math.round(w / 90)); i++) { const x = w * i / Math.max(2, Math.round(w / 90)); ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - 2); ctx.stroke(); }
    } },
  { id: 'jp_tatami_high', name: '和室高地台', style: '日式', cat: '臥室', proc: true, w: 180, h: 180, draw(ctx, w, h) {
      ctx.fillStyle = '#4a5138'; ctx.strokeStyle = '#c9c07a'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c9c07a66';
      for (let i = 1; i < Math.max(2, Math.round(w / 90)); i++) { const x = w * i / Math.max(2, Math.round(w / 90)); ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - 2); ctx.stroke(); }
    } },
  { id: 'jp_shoji', name: '障子屏風', style: '日式', cat: '客廳', proc: true, w: 180, h: 4, draw(ctx, w, h) {
      ctx.fillStyle = '#e8e2d2'; ctx.strokeStyle = '#9a7a4e'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 1); ctx.fill(); ctx.stroke();
    } },
  { id: 'jp_shoji_low', name: '半腰障子', style: '日式', cat: '客廳', proc: true, w: 120, h: 4, draw(ctx, w, h) {
      ctx.fillStyle = '#e8e2d2'; ctx.strokeStyle = '#9a7a4e'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 1); ctx.fill(); ctx.stroke();
    } },
  { id: 'jp_low_table', name: '和室矮桌', style: '日式', cat: '客廳', proc: true, w: 120, h: 70, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke();
    } },
  { id: 'jp_low_cabinet', name: '和室矮櫃', style: '日式', cat: '客廳', proc: true, w: 150, h: 40, draw(ctx, w, h) {
      cabinet(ctx, w, h, 3);
    } },
  { id: 'jp_futon', name: '布團台', style: '日式', cat: '臥室', proc: true, w: 140, h: 200, draw(ctx, w, h) {
      ctx.fillStyle = '#4a5138'; ctx.strokeStyle = '#c9c07a'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c9c07a66';
      for (let i = 1; i < Math.max(2, Math.round(w / 90)); i++) { const x = w * i / Math.max(2, Math.round(w / 90)); ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - 2); ctx.stroke(); }
    } },
  { id: 'nd_sideboard', name: '北歐邊櫃', style: '北歐', cat: '客廳', proc: true, w: 150, h: 42, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#d9c49a99';
      for (let i = 1; i < 4; i++) { const x = w * i / 4; ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x, h - 3); ctx.stroke(); }
    } },
  { id: 'nd_nightstand', name: '北歐床頭櫃', style: '北歐', cat: '臥室', proc: true, w: 45, h: 40, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#d9c49a99';
      for (let i = 1; i < 4; i++) { const x = w * i / 4; ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x, h - 3); ctx.stroke(); }
    } },
  { id: 'nd_cabinet', name: '北歐高櫃', style: '北歐', cat: '客廳', proc: true, w: 90, h: 42, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#d9c49a99';
      for (let i = 1; i < 4; i++) { const x = w * i / 4; ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x, h - 3); ctx.stroke(); }
    } },
  { id: 'nd_wardrobe', name: '北歐衣櫃', style: '北歐', cat: '臥室', proc: true, w: 120, h: 58, draw(ctx, w, h) {
      cabinet(ctx, w, h, 3);
    } },
  { id: 'nd_shelf', name: '北歐層架', style: '北歐', cat: '書房', proc: true, w: 90, h: 32, draw(ctx, w, h) {
      openShelf(ctx, w, h, 4);
    } },
  { id: 'nd_bench', name: '玄關長凳', style: '北歐', cat: '客廳', proc: true, w: 120, h: 38, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke();
    } },

  // ---- Quaternius（CC0）：實掃圖庫沒有第二款的那些。尺寸是真實尺寸，不是模型尺寸 ----
  { id: 'bed_king', name: '加大雙人床', style: '現代', cat: '臥室', w: 180, h: 200, height: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w - 16, 38, 4); ctx.stroke();
    } },
  { id: 'bed_single_q', name: '單人床', style: '現代', cat: '臥室', w: 90, h: 190, height: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w - 16, 38, 4); ctx.stroke();
    } },
  { id: 'bed_bunk', name: '上下舖', style: '現代', cat: '臥室', w: 100, h: 200, height: 175, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'sofa_q', name: '布沙發', style: '現代', cat: '客廳', w: 200, h: 88, height: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'sofa_q2', name: '布沙發 II', style: '現代', cat: '客廳', w: 210, h: 90, height: 82, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'sofa_q3', name: '布沙發 III', style: '現代', cat: '客廳', w: 195, h: 88, height: 78, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'sofa_single_q', name: '單人沙發', style: '現代', cat: '客廳', w: 95, h: 88, height: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'couch_l', name: 'L 型沙發', style: '現代', cat: '客廳', w: 260, h: 190, height: 78, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'couch_lg1', name: '大沙發 I', style: '現代', cat: '客廳', w: 220, h: 92, height: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'couch_lg2', name: '大沙發 II', style: '現代', cat: '客廳', w: 225, h: 92, height: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'couch_md1', name: '雙人沙發 I', style: '北歐', cat: '客廳', w: 165, h: 90, height: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'chair_q1', name: '餐椅 I', style: '鄉村', cat: '餐廳', w: 45, h: 48, height: 88, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
    } },
  { id: 'chair_q2', name: '餐椅 II', style: '鄉村', cat: '餐廳', w: 46, h: 50, height: 90, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
    } },
  { id: 'chair_q3', name: '餐椅 III', style: '鄉村', cat: '餐廳', w: 47, h: 50, height: 86, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
    } },
  { id: 'chair_q4', name: '餐椅 IV', style: '鄉村', cat: '餐廳', w: 45, h: 49, height: 92, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
    } },
  { id: 'stool_q', name: '圓凳', style: '現代', cat: '客廳', w: 38, h: 38, height: 45, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'table_q', name: '餐桌', style: '鄉村', cat: '餐廳', w: 160, h: 90, height: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'table_q2', name: '餐桌 II', style: '鄉村', cat: '餐廳', w: 140, h: 80, height: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'bookshelf_q', name: '書架', style: '現代', cat: '書房', w: 80, h: 30, height: 180, draw(ctx, w, h) {
      openShelf(ctx, w, h, 3);
    } },
  { id: 'carpet_q1', name: '地毯 I', style: '現代', cat: '客廳', w: 200, h: 140, height: 2, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'carpet_round_q', name: '圓地毯', style: '現代', cat: '客廳', w: 160, h: 160, height: 2, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'wardrobe_tall', name: '高衣櫃', style: '古典', cat: '臥室', w: 150, h: 60, height: 220, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'wardrobe_short', name: '矮衣櫃', style: '古典', cat: '臥室', w: 120, h: 60, height: 150, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'bed_dbl_wood', name: '木框雙人床', style: '古典', cat: '臥室', w: 150, h: 200, height: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w - 16, 38, 4); ctx.stroke();
    } },
  { id: 'bed_twin_wood', name: '木框單人床', style: '古典', cat: '臥室', w: 105, h: 200, height: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w - 16, 38, 4); ctx.stroke();
    } },
  { id: 'chair_wood_q', name: '木餐椅', style: '古典', cat: '餐廳', w: 45, h: 48, height: 90, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
    } },
  { id: 'chair_office', name: '辦公椅', style: '現代', cat: '書房', w: 60, h: 60, height: 105, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
    } },
  { id: 'desk_wood', name: '木書桌', style: '古典', cat: '書房', w: 120, h: 60, height: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'bookcase_tall', name: '高書櫃', style: '古典', cat: '書房', w: 90, h: 32, height: 200, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'bookcase_books', name: '滿書書櫃', style: '現代', cat: '書房', w: 90, h: 32, height: 200, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'nightstand_wood', name: '木床頭櫃', style: '古典', cat: '臥室', w: 45, h: 40, height: 55, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w - 16, 38, 4); ctx.stroke();
    } },
  { id: 'couch_lg3', name: '大沙發 III', style: '現代', cat: '客廳', w: 230, h: 95, height: 84, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'couch_md2', name: '雙人沙發 II', style: '現代', cat: '客廳', w: 170, h: 90, height: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'couch_sm1', name: '單人沙發 I', style: '現代', cat: '客廳', w: 95, h: 88, height: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'couch_sm2', name: '單人沙發 II', style: '現代', cat: '客廳', w: 100, h: 90, height: 82, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
    } },
  { id: 'drawer_q1', name: '抽屜櫃 I', style: '現代', cat: '臥室', w: 90, h: 45, height: 80, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'drawer_q2', name: '抽屜櫃 II', style: '現代', cat: '臥室', w: 100, h: 45, height: 85, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'drawer_q3', name: '抽屜櫃 III', style: '現代', cat: '臥室', w: 80, h: 45, height: 75, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'plant_q1', name: '盆栽 I', style: '現代', cat: '裝飾', w: 40, h: 40, height: 90, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'plant_q2', name: '盆栽 II', style: '現代', cat: '裝飾', w: 45, h: 45, height: 120, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'plant_q3', name: '盆栽 III', style: '現代', cat: '裝飾', w: 35, h: 35, height: 70, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'curtain_dbl', name: '雙開窗簾', style: '現代', cat: '裝飾', w: 180, h: 12, height: 220, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'fireplace_q', name: '壁爐', style: '古典', cat: '客廳', w: 120, h: 40, height: 110, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
];

export const FURNITURE_BY_ID: Record<string, FurnitureItem> = Object.fromEntries(FURNITURE.map(f => [f.id, f]));
// Fixed display order for the catalog; any stray category falls in at the end.
const CAT_ORDER = ['客廳', '餐廳', '臥室', '廚房', '浴室', '書房'];
export const FURNITURE_CATS = [...new Set(FURNITURE.map(f => f.cat))]
  .sort((a, b) => { const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
