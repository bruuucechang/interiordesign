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
  { id: 'sofa', name: '沙發', cat: '客廳', w: 158, h: 66, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      rr(ctx, 8, 22, w - 16, h - 30, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 3, 22); ctx.lineTo(w / 3, h - 8); ctx.moveTo(2 * w / 3, 22); ctx.lineTo(2 * w / 3, h - 8); ctx.stroke();
    } },
  { id: 'armchair', name: '單椅', cat: '客廳', w: 82, h: 99, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 18, w - 16, h - 26, 6); ctx.stroke();
    } },
  { id: 'coffee', name: '茶几', cat: '客廳', w: 120, h: 60, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke(); } },
  { id: 'tv', name: '電視櫃', cat: '客廳', w: 150, h: 40, height: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; ctx.beginPath(); ctx.moveTo(w * 0.2, 6); ctx.lineTo(w * 0.8, 6); ctx.stroke();
    } },
  { id: 'rug', name: '地毯', cat: '客廳', w: 200, h: 140, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.setLineDash([10, 8]); rr(ctx, 10, 10, w - 20, h - 20, 3); ctx.stroke(); ctx.setLineDash([]);
    } },
  { id: 'plant', name: '植栽', cat: '客廳', w: 40, h: 40, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  // 餐廳
  { id: 'dining', name: '餐桌', cat: '餐廳', w: 226, h: 139, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke(); } },
  { id: 'chair', name: '餐椅', cat: '餐廳', w: 43, h: 58, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke(); } },
  // 臥室
  { id: 'bed_double', name: '雙人床', cat: '臥室', w: 150, h: 200, height: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w / 2 - 12, 40, 4); ctx.stroke(); rr(ctx, w / 2 + 4, 8, w / 2 - 12, 40, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 60); ctx.lineTo(w - 6, 60); ctx.stroke();
    } },
  { id: 'bed_single', name: '單人床', cat: '臥室', w: 100, h: 200, height: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 12, 8, w - 24, 40, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 58); ctx.lineTo(w - 6, 58); ctx.stroke();
    } },
  // 廚房
  { id: 'stove', name: '爐具', cat: '廚房', w: 60, h: 60, height: 85, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#ff5c72'; [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].forEach(([px, py]) => { ctx.beginPath(); ctx.arc(w * px, h * py, 8, 0, 7); ctx.stroke(); });
    } },
  { id: 'fridge', name: '冰箱', cat: '廚房', w: 70, h: 70, height: 180, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; ctx.beginPath(); ctx.moveTo(6, h / 2); ctx.lineTo(w - 6, h / 2); ctx.stroke();
    } },
  { id: 'sink', name: '水槽', cat: '廚房', w: 80, h: 50, height: 85, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; rr(ctx, 10, 10, w - 20, h - 20, 6); ctx.stroke();
    } },
  // 浴室
  { id: 'toilet', name: '馬桶', cat: '浴室', w: 40, h: 60, height: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 4, 0, w - 8, 18, 4); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(w / 2, h * 0.62, w / 2 - 4, h * 0.32, 0, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'bathtub', name: '浴缸', cat: '浴室', w: 160, h: 75, height: 55, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; rr(ctx, 10, 10, w - 20, h - 20, 8); ctx.stroke();
    } },
  { id: 'shower', name: '淋浴間', cat: '浴室', w: 90, h: 90, height: 200, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#7bc6ff'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 6, 0, 7); ctx.stroke();
    } },
  { id: 'desk', name: '書桌', cat: '書房', w: 200, h: 95, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke(); } },
  // 櫃子 — filed under the room each belongs to
  { id: 'cabinet_storage', name: '收納櫃', cat: '客廳', w: 90, h: 40, height: 82, draw(ctx, w, h) { cabinet(ctx, w, h, 2); } },
  { id: 'display_cabinet', name: '展示櫃', cat: '客廳', w: 108, h: 37, draw(ctx, w, h) { glassCab(ctx, w, h, 2); } },
  { id: 'shoe_cabinet', name: '鞋櫃', cat: '客廳', w: 100, h: 35, height: 100, draw(ctx, w, h) { cabinet(ctx, w, h, 3); } },
  { id: 'cabinet_side', name: '餐邊櫃', cat: '餐廳', w: 244, h: 52, draw(ctx, w, h) { cabinet(ctx, w, h, 3); } },
  { id: 'wardrobe', name: '衣櫃', cat: '臥室', w: 120, h: 60, height: 200, draw(ctx, w, h) { cabinet(ctx, w, h, 2); } },
  { id: 'dresser', name: '五斗櫃', cat: '臥室', w: 114, h: 49, draw(ctx, w, h) { drawers(ctx, w, h, 4); } },
  { id: 'nightstand', name: '床頭櫃', cat: '臥室', w: 57, h: 42, draw(ctx, w, h) { drawers(ctx, w, h, 2); } },
  { id: 'cabinet_kitchen', name: '廚櫃', cat: '廚房', w: 180, h: 60, height: 85, draw(ctx, w, h) { cabinet(ctx, w, h, 4); } },
  { id: 'tall_cabinet', name: '高櫃', cat: '廚房', w: 60, h: 50, height: 200, draw(ctx, w, h) { cabinet(ctx, w, h, 2); } },
  { id: 'vanity', name: '浴櫃', cat: '浴室', w: 80, h: 50, height: 80, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
      ctx.strokeStyle = '#7bc6ff'; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * 0.26, h * 0.28, 0, 0, 7); ctx.stroke();
    } },
  { id: 'bookshelf', name: '書櫃', cat: '書房', w: 110, h: 50, draw(ctx, w, h) { openShelf(ctx, w, h, 4); } },
  { id: 'open_shelf', name: '開放層架', cat: '書房', w: 90, h: 30, height: 180, draw(ctx, w, h) { openShelf(ctx, w, h, 3); } },

  // ---- 有 CC0 實掃模型的新款式（scripts/fetch_models.py）------------------
  // 尺寸就是模型本身量到的真實尺寸，不是估的。
  { id: 'sofa_l', name: 'L型沙發', cat: '客廳', w: 273, h: 92, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      rr(ctx, 8, 22, w * 0.62, h - 30, 8); ctx.stroke();
      rr(ctx, w * 0.66, 10, w * 0.3, h - 18, 8); ctx.stroke();
    } },
  { id: 'lounge', name: '休閒單椅', cat: '客廳', w: 101, h: 119, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 14); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 10, 26, w - 20, h - 40, 10); ctx.stroke();
    } },
  { id: 'ottoman', name: '腳凳', cat: '客廳', w: 88, h: 62, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 7, w - 14, h - 14, 7); ctx.stroke();
    } },
  { id: 'side_table', name: '邊几', cat: '客廳', w: 55, h: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; ctx.beginPath(); ctx.moveTo(6, h / 2); ctx.lineTo(w - 6, h / 2); ctx.stroke();
    } },
  { id: 'roundtable', name: '圓餐桌', cat: '餐廳', w: 140, h: 140, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 10, 0, 7); ctx.stroke();
    } },
  { id: 'stool', name: '椅凳', cat: '餐廳', w: 42, h: 44, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },

  // ---- 第三批款式：全部有 CC0 實掃模型，尺寸是模型量到的真實尺寸 --------
  { id: 'armchair_classic', name: '經典單椅', cat: '客廳', w: 85, h: 77, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'accent_chair', name: '造型單椅', cat: '客廳', w: 67, h: 66, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'rocking', name: '搖椅', cat: '客廳', w: 71, h: 83, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'sofa_2', name: '雙人沙發', cat: '客廳', w: 181, h: 82, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 2, 20); ctx.lineTo(w / 2, h - 8); ctx.stroke();
    } },
  { id: 'bench', name: '長凳', cat: '客廳', w: 116, h: 50, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; ctx.beginPath(); ctx.moveTo(6, h / 2); ctx.lineTo(w - 6, h / 2); ctx.stroke();
    } },
  { id: 'console', name: '玄關桌', cat: '客廳', w: 154, h: 59, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'coffee_round', name: '圓茶几', cat: '客廳', w: 130, h: 130, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'side_tall', name: '高邊几', cat: '客廳', w: 38, h: 38, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'mirror', name: '立鏡', cat: '客廳', w: 49, h: 3, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#9fd4ffaa'; const i = Math.min(3, w / 6, h / 6); rr(ctx, i, i, w - i * 2, h - i * 2, 2); ctx.stroke();
    } },
  { id: 'table_wood', name: '實木長桌', cat: '餐廳', w: 180, h: 66, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },
  { id: 'stool_fold', name: '折凳', cat: '餐廳', w: 53, h: 55, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'stool_bar', name: '吧檯椅', cat: '餐廳', w: 35, h: 36, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'cabinet_painted', name: '烤漆收納櫃', cat: '客廳', w: 120, h: 62, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'shelf_narrow', name: '窄層架', cat: '客廳', w: 59, h: 50, draw(ctx, w, h) {
      openShelf(ctx, w, h, 4);
    } },
  { id: 'bookshelf_wood', name: '實木書櫃', cat: '書房', w: 137, h: 58, draw(ctx, w, h) {
      openShelf(ctx, w, h, 4);
    } },
  { id: 'shelf_wall', name: '壁掛層架', cat: '書房', w: 51, h: 37, draw(ctx, w, h) {
      openShelf(ctx, w, h, 4);
    } },
  { id: 'daybed', name: '貴妃椅', cat: '臥室', w: 197, h: 86, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 20, w - 16, h - 28, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 2, 20); ctx.lineTo(w / 2, h - 8); ctx.stroke();
    } },
  { id: 'cn_armchair', name: '太師椅', cat: '中式', w: 85, h: 79, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 16, w - 14, h - 24, 6); ctx.stroke();
    } },
  { id: 'cn_cabinet', name: '中式高櫃', cat: '中式', w: 126, h: 54, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'cn_teatable', name: '中式茶几', cat: '中式', w: 84, h: 84, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'cn_screen', name: '屏風', cat: '中式', w: 129, h: 38, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      for (let i = 1; i < 4; i++) { const x = w * i / 4; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    } },
  { id: 'cn_console', name: '中式條案', cat: '中式', w: 172, h: 34, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
    } },

  // ---- 裝潢素材：燈具與擺飾。mount 決定放下去時離地多高 ------------------
  { id: 'lamp_ceiling', name: '吸頂燈', cat: '燈具', w: 43, h: 43, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 5, 0, 7); ctx.stroke();
    } },
  { id: 'lamp_pendant', name: '吊燈', cat: '燈具', w: 68, h: 62, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 5, 0, 7); ctx.stroke();
    } },
  { id: 'cn_chandelier', name: '中式吊燈', cat: '燈具', w: 88, h: 88, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 5, 0, 7); ctx.stroke();
    } },
  { id: 'fan_ceiling', name: '吊扇', cat: '燈具', w: 146, h: 146, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#9fd4ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + Math.cos(a) * (w / 2 - 5), h / 2 + Math.sin(a) * (h / 2 - 5)); ctx.stroke(); }
    } },
  { id: 'lamp_wall', name: '壁燈', cat: '燈具', w: 15, h: 25, mount: 'wall', draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'plant_large', name: '大型盆栽', cat: '裝飾', w: 70, h: 66, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, 7); ctx.stroke();
    } },
  { id: 'plant_small', name: '小盆栽', cat: '裝飾', w: 17, h: 19, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, 7); ctx.stroke();
    } },
  { id: 'pot_ceramic', name: '陶盆', cat: '裝飾', w: 66, h: 50, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'vase', name: '花瓶', cat: '裝飾', w: 20, h: 21, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'basket', name: '藤籃', cat: '裝飾', w: 38, h: 30, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'tv_set', name: '電視', cat: '裝飾', w: 60, h: 47, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'clock', name: '時鐘', cat: '裝飾', w: 23, h: 17, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },

  // ---- Kenney（CC0）補的三件，目錄本來沒有 --------------------------------
  // 尺寸是台灣住宅的實際尺寸，不是模型的——Kenney 的套件在固定格線上做，衣櫃只有
  // 56cm 寬、廚櫃 43cm。載入器本來就會把模型等比縮到物件的 w/h，所以目錄要放對的
  // 那一個。
  { id: 'washer', name: '洗衣機', cat: '廚房', w: 60, h: 60, height: 85, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#9fd4ffaa'; ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 3, 0, 7); ctx.stroke();
    } },
  { id: 'microwave', name: '微波爐', cat: '廚房', w: 50, h: 38, height: 30, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; ctx.beginPath(); ctx.moveTo(w * 0.72, 4); ctx.lineTo(w * 0.72, h - 4); ctx.stroke();
    } },
  { id: 'coat_rack', name: '衣帽架', cat: '客廳', w: 45, h: 45, height: 170, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4;
        ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + Math.cos(a) * (w / 2 - 6), h / 2 + Math.sin(a) * (h / 2 - 6)); ctx.stroke(); }
    } },


  // ---- 第四批：Kenney（CC0）。尺寸是台灣住宅的實際尺寸，不是模型的 ------
  { id: 'range_hood', name: '抽油煙機', cat: '廚房', w: 90, h: 50, height: 60, mount: 'wall', draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'upper_cabinet', name: '廚房吊櫃', cat: '廚房', w: 80, h: 35, height: 70, mount: 'wall', draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'kitchen_island', name: '中島', cat: '廚房', w: 180, h: 90, height: 90, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'dryer', name: '烘衣機', cat: '廚房', w: 60, h: 60, height: 85, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'coffee_machine', name: '咖啡機', cat: '廚房', w: 30, h: 35, height: 35, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'toilet_square', name: '方型馬桶', cat: '浴室', w: 40, h: 70, height: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'shower_round', name: '圓形淋浴間', cat: '浴室', w: 90, h: 90, height: 200, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'trashcan', name: '垃圾桶', cat: '浴室', w: 40, h: 40, height: 60, draw(ctx, w, h) {
      body(ctx); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'sofa_corner', name: 'L型布沙發', cat: '客廳', w: 240, h: 240, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w * 0.6, h - 16, 8); ctx.stroke();
      rr(ctx, w * 0.62, 8, w * 0.34, h * 0.55, 8); ctx.stroke();
    } },
  { id: 'table_glass', name: '玻璃桌', cat: '客廳', w: 120, h: 60, draw(ctx, w, h) {
      ctx.fillStyle = '#31414e'; ctx.strokeStyle = '#9fd4ff'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke();
    } },
  { id: 'side_drawers', name: '抽屜邊几', cat: '客廳', w: 45, h: 40, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
    } },
  { id: 'rug_round', name: '圓地毯', cat: '客廳', w: 160, h: 160, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 9, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    } },
  { id: 'rug_square', name: '方地毯', cat: '客廳', w: 200, h: 200, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.setLineDash([8, 6]); rr(ctx, 7, 7, w - 14, h - 14, 3); ctx.stroke(); ctx.setLineDash([]);
    } },
  { id: 'doormat', name: '門墊', cat: '客廳', w: 75, h: 45, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.setLineDash([8, 6]); rr(ctx, 7, 7, w - 14, h - 14, 3); ctx.stroke(); ctx.setLineDash([]);
    } },
  { id: 'tv_wall', name: '壁掛電視', cat: '客廳', w: 120, h: 10, mount: 'wall', draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'pillow', name: '抱枕', cat: '客廳', w: 45, h: 45, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
    } },
  { id: 'lamp_floor', name: '立燈', cat: '燈具', w: 40, h: 40, draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'lamp_table', name: '檯燈', cat: '燈具', w: 25, h: 25, draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'lamp_flush', name: '方型吸頂燈', cat: '燈具', w: 40, h: 40, mount: 'ceiling', draw(ctx, w, h) {
      ctx.fillStyle = '#3a3524'; ctx.strokeStyle = '#f0c869'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'chair_desk', name: '辦公椅', cat: '書房', w: 60, h: 60, height: 95, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 7, 14, w - 14, h - 22, 6); ctx.stroke();
    } },
  { id: 'desk_corner', name: 'L型書桌', cat: '書房', w: 160, h: 140, height: 75, draw(ctx, w, h) {
      body(ctx);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.42);
      ctx.lineTo(w * 0.45, h * 0.42); ctx.lineTo(w * 0.45, h); ctx.lineTo(0, h);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } },
  { id: 'stairs', name: '樓梯', cat: '常用', w: 100, h: 300, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      for (let i = 1; i < 9; i++) { const y = h * i / 9; ctx.beginPath(); ctx.moveTo(3, y); ctx.lineTo(w - 3, y); ctx.stroke(); }
    } },
];

export const FURNITURE_BY_ID: Record<string, FurnitureItem> = Object.fromEntries(FURNITURE.map(f => [f.id, f]));
// Fixed display order for the catalog; any stray category falls in at the end.
const CAT_ORDER = ['客廳', '餐廳', '臥室', '廚房', '浴室', '書房'];
export const FURNITURE_CATS = [...new Set(FURNITURE.map(f => f.cat))]
  .sort((a, b) => { const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
