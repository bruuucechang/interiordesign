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
  { id: 'wardrobe', name: '衣櫃', cat: '臥室', w: 120, h: 60, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e0b45a88'; ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    } },
  { id: 'desk', name: '書桌', cat: '臥室', w: 120, h: 60, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke(); } },
  // 廚房
  { id: 'dining', name: '餐桌', cat: '廚房', w: 140, h: 80, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 6); ctx.fill(); ctx.stroke(); } },
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
  // 衛浴
  { id: 'toilet', name: '馬桶', cat: '衛浴', w: 40, h: 60, draw(ctx, w, h) {
      body(ctx); rr(ctx, 4, 0, w - 8, 18, 4); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(w / 2, h * 0.62, w / 2 - 4, h * 0.32, 0, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'bathtub', name: '浴缸', cat: '衛浴', w: 160, h: 75, draw(ctx, w, h) {
      body(ctx); rr(ctx, 0, 0, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#7bc6ff'; rr(ctx, 10, 10, w - 20, h - 20, 8); ctx.stroke();
    } },
  { id: 'shower', name: '淋浴間', cat: '衛浴', w: 90, h: 90, draw(ctx, w, h) {
      ctx.fillStyle = '#2b3340'; ctx.strokeStyle = '#7bc6ff'; ctx.lineWidth = 2;
      rr(ctx, 0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 6, 0, 7); ctx.stroke();
    } },
  // 其他
  { id: 'plant', name: '植栽', cat: '其他', w: 40, h: 40, draw(ctx, w, h) {
      ctx.fillStyle = '#264a34'; ctx.strokeStyle = '#47c479'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
    } },
  { id: 'chair', name: '椅子', cat: '其他', w: 45, h: 45, draw(ctx, w, h) { body(ctx); rr(ctx, 0, 0, w, h, 5); ctx.fill(); ctx.stroke(); } },
];

export const FURNITURE_BY_ID: Record<string, FurnitureItem> = Object.fromEntries(FURNITURE.map(f => [f.id, f]));
export const FURNITURE_CATS = [...new Set(FURNITURE.map(f => f.cat))];
