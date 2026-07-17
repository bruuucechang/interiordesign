// Furniture catalog. Each item draws a top-down pictogram in its own local
// centimeter coordinates (0,0 top-left .. w,h). The renderer sets the canvas
// transform so 1 unit = 1 cm, and lineWidth is given in cm.

export interface FurnitureItem {
  id: string;
  name: string;
  cat: string;
  w: number; // cm
  h: number; // cm
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
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
  { id: 'sofa', name: '沙發', cat: '客廳', w: 200, h: 90, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88';
      rr(ctx, 8, 22, w - 16, h - 30, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 3, 22); ctx.lineTo(w / 3, h - 8); ctx.moveTo(2 * w / 3, 22); ctx.lineTo(2 * w / 3, h - 8); ctx.stroke();
    } },
  { id: 'armchair', name: '單椅', cat: '客廳', w: 80, h: 80, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 18, w - 16, h - 26, 6); ctx.stroke();
    } },
  { id: 'coffee', name: '茶几', cat: '客廳', w: 100, h: 50, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke(); } },
  { id: 'tv', name: '電視櫃', cat: '客廳', w: 150, h: 40, draw(ctx, w, h) {
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
  { id: 'dining', name: '餐桌', cat: '餐廳', w: 140, h: 80, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke(); } },
  { id: 'chair', name: '餐椅', cat: '餐廳', w: 45, h: 45, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke(); } },
  // 臥室
  { id: 'bed_double', name: '雙人床', cat: '臥室', w: 150, h: 200, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 8, 8, w / 2 - 12, 40, 4); ctx.stroke(); rr(ctx, w / 2 + 4, 8, w / 2 - 12, 40, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 60); ctx.lineTo(w - 6, 60); ctx.stroke();
    } },
  { id: 'bed_single', name: '單人床', cat: '臥室', w: 100, h: 200, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; rr(ctx, 12, 8, w - 24, 40, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, 58); ctx.lineTo(w - 6, 58); ctx.stroke();
    } },
  // 廚房
  { id: 'stove', name: '爐具', cat: '廚房', w: 60, h: 60, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#ff5c72'; [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].forEach(([px, py]) => { ctx.beginPath(); ctx.arc(w * px, h * py, 8, 0, 7); ctx.stroke(); });
    } },
  { id: 'fridge', name: '冰箱', cat: '廚房', w: 70, h: 70, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; ctx.beginPath(); ctx.moveTo(6, h / 2); ctx.lineTo(w - 6, h / 2); ctx.stroke();
    } },
  { id: 'sink', name: '水槽', cat: '廚房', w: 80, h: 50, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; rr(ctx, 10, 10, w - 20, h - 20, 6); ctx.stroke();
    } },
  // 浴室
  { id: 'toilet', name: '馬桶', cat: '浴室', w: 40, h: 60, draw(ctx, w, h) {
      body(ctx); rr(ctx, 4, 0, w - 8, 18, 4); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(w / 2, h * 0.62, w / 2 - 4, h * 0.32, 0, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'bathtub', name: '浴缸', cat: '浴室', w: 160, h: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; rr(ctx, 10, 10, w - 20, h - 20, 8); ctx.stroke();
    } },
  { id: 'shower', name: '淋浴間', cat: '浴室', w: 90, h: 90, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#7bc6ff'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 6, 0, 7); ctx.stroke();
    } },
  // 書房
  { id: 'desk', name: '書桌', cat: '書房', w: 120, h: 60, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke(); } },
  // 櫃子 — every form of cabinet lives here
  { id: 'cabinet_storage', name: '收納櫃', cat: '櫃子', w: 90, h: 40, draw(ctx, w, h) { cabinet(ctx, w, h, 2); } },
  { id: 'cabinet_side', name: '餐邊櫃', cat: '櫃子', w: 120, h: 45, draw(ctx, w, h) { cabinet(ctx, w, h, 3); } },
  { id: 'dresser', name: '五斗櫃', cat: '櫃子', w: 100, h: 50, draw(ctx, w, h) { drawers(ctx, w, h, 4); } },
  { id: 'nightstand', name: '床頭櫃', cat: '櫃子', w: 45, h: 40, draw(ctx, w, h) { drawers(ctx, w, h, 2); } },
  { id: 'shoe_cabinet', name: '鞋櫃', cat: '櫃子', w: 100, h: 35, draw(ctx, w, h) { cabinet(ctx, w, h, 3); } },
  { id: 'cabinet_kitchen', name: '廚櫃', cat: '櫃子', w: 180, h: 60, draw(ctx, w, h) { cabinet(ctx, w, h, 4); } },
  { id: 'vanity', name: '浴櫃', cat: '櫃子', w: 80, h: 50, draw(ctx, w, h) {
      cabinet(ctx, w, h, 2);
      ctx.strokeStyle = '#7bc6ff'; ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w * 0.26, h * 0.28, 0, 0, 7); ctx.stroke();
    } },
  { id: 'bookshelf', name: '書櫃', cat: '櫃子', w: 100, h: 30, draw(ctx, w, h) { openShelf(ctx, w, h, 4); } },
  { id: 'open_shelf', name: '開放層架', cat: '櫃子', w: 90, h: 30, draw(ctx, w, h) { openShelf(ctx, w, h, 3); } },
  { id: 'display_cabinet', name: '展示櫃', cat: '櫃子', w: 90, h: 40, draw(ctx, w, h) { glassCab(ctx, w, h, 2); } },
  { id: 'wardrobe', name: '衣櫃', cat: '櫃子', w: 120, h: 60, draw(ctx, w, h) { cabinet(ctx, w, h, 2); } },
  { id: 'tall_cabinet', name: '高櫃', cat: '櫃子', w: 60, h: 50, draw(ctx, w, h) { cabinet(ctx, w, h, 2); } },
];

export const FURNITURE_BY_ID: Record<string, FurnitureItem> = Object.fromEntries(FURNITURE.map(f => [f.id, f]));
// Fixed display order for the catalog; any stray category falls in at the end.
const CAT_ORDER = ['客廳', '餐廳', '臥室', '廚房', '浴室', '書房', '櫃子'];
export const FURNITURE_CATS = [...new Set(FURNITURE.map(f => f.cat))]
  .sort((a, b) => { const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });

// Rough reference prices (NT$) for the bill-of-materials estimate.
const PRICES: Record<string, number> = {
  sofa: 18000, armchair: 8000, coffee: 4500, tv: 6000, rug: 3500, plant: 1200,
  dining: 9000, chair: 2500,
  bed_double: 22000, bed_single: 14000,
  stove: 15000, fridge: 20000, sink: 6000,
  toilet: 5000, bathtub: 18000, shower: 12000,
  desk: 5000,
  // 櫃子
  cabinet_storage: 7000, cabinet_side: 10000, dresser: 9000, nightstand: 3500,
  shoe_cabinet: 6000, cabinet_kitchen: 25000, vanity: 9000, bookshelf: 8000,
  open_shelf: 5500, display_cabinet: 13000, wardrobe: 12000, tall_cabinet: 11000,
};
export function itemPrice(id: string): number { return PRICES[id] ?? 3000; }
