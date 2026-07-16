import { Viewport } from './viewport';
import { Doc } from '../model/doc';
import { Obj, Vec } from '../model/types';
import { FURNITURE_BY_ID } from '../data/furniture';
import { fmtLen, fmtArea, dist, angleDeg, sub, len, rotate, polygonArea, polygonCentroid, wallControl, closestOnSegment } from './geometry';
import { handles } from './handles';
import { furnitureCenter, bounds } from './hit';

export interface RenderOpts {
  world?: (ctx: CanvasRenderingContext2D) => void;   // preview in world (cm) space
  screen?: (ctx: CanvasRenderingContext2D) => void;   // preview in screen (px) space
  background?: string;   // canvas fill (default dark theme)
  grid?: boolean;        // draw grid (default true)
  selection?: boolean;   // draw selection handles (default true)
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  onImageLoad?: () => void;                 // re-render when an underlay image finishes loading
  private imgCache = new Map<string, HTMLImageElement>();
  constructor(private canvas: HTMLCanvasElement, private vp: Viewport, private doc: Doc) {
    this.ctx = canvas.getContext('2d')!;
  }

  private getImg(src: string): HTMLImageElement | null {
    let img = this.imgCache.get(src);
    if (!img) { img = new Image(); img.onload = () => this.onImageLoad?.(); img.src = src; this.imgCache.set(src, img); }
    return img.complete && img.naturalWidth ? img : null;
  }

  private setWorld() {
    const s = this.vp.scale * this.vp.dpr;
    this.ctx.setTransform(s, 0, 0, s, -this.vp.origin.x * s, -this.vp.origin.y * s);
  }
  private setScreen() { this.ctx.setTransform(this.vp.dpr, 0, 0, this.vp.dpr, 0, 0); }

  render(opts: RenderOpts = {}) {
    const { ctx, vp } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.setScreen();
    ctx.fillStyle = opts.background ?? '#171a20';
    ctx.fillRect(0, 0, vp.width, vp.height);

    this.setWorld();
    if (opts.grid !== false) this.drawGrid();

    // objects grouped by layer order (index 0 = bottom)
    for (const layer of this.doc.project.layers) {
      if (!layer.visible) continue;
      for (const o of this.doc.objects) if (o.layer === layer.id) this.drawObject(o, layer.color);
    }
    if (opts.world) { ctx.save(); opts.world(ctx); ctx.restore(); }

    // labels + selection + previews in screen space
    this.setScreen();
    for (const layer of this.doc.project.layers) {
      if (!layer.visible) continue;
      for (const o of this.doc.objects) if (o.layer === layer.id) this.labelObject(o);
    }
    if (opts.selection !== false) { const sel = this.doc.selectedObjects; for (const s of sel) this.drawSelection(s, sel.length === 1); }
    if (opts.screen) { ctx.save(); opts.screen(ctx); ctx.restore(); }
  }

  private drawGrid() {
    const { ctx, vp } = this;
    const tl = vp.toWorld({ x: 0, y: 0 }), br = vp.toWorld({ x: vp.width, y: vp.height });
    const line = 1 / vp.scale;
    const draw = (step: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = line;
      ctx.beginPath();
      const x0 = Math.floor(tl.x / step) * step, y0 = Math.floor(tl.y / step) * step;
      for (let x = x0; x <= br.x; x += step) { ctx.moveTo(x, tl.y); ctx.lineTo(x, br.y); }
      for (let y = y0; y <= br.y; y += step) { ctx.moveTo(tl.x, y); ctx.lineTo(br.x, y); }
      ctx.stroke();
    };
    if (vp.scale > 0.25) draw(100, 'rgba(255,255,255,0.05)');   // 1m
    draw(500, 'rgba(255,255,255,0.11)');                        // 5m
  }

  private drawObject(o: Obj, color: string) {
    const { ctx, vp } = this;
    const line = 1 / vp.scale;
    switch (o.kind) {
      case 'image': {
        const img = this.getImg(o.src);
        if (img) { ctx.save(); ctx.globalAlpha = o.opacity ?? 1; ctx.drawImage(img, o.x, o.y, o.w, o.h); ctx.restore(); }
        else { ctx.strokeStyle = color; ctx.lineWidth = line; ctx.strokeRect(o.x, o.y, o.w, o.h); }
        break;
      }
      case 'room':
        ctx.fillStyle = 'rgba(76,141,255,0.06)';
        ctx.strokeStyle = color; ctx.lineWidth = 2 * line;
        if (o.poly && o.poly.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(o.poly[0].x, o.poly[0].y);
          for (let i = 1; i < o.poly.length; i++) ctx.lineTo(o.poly[i].x, o.poly[i].y);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
        } else {
          ctx.fillRect(o.x, o.y, o.w, o.h);
          ctx.strokeRect(o.x, o.y, o.w, o.h);
        }
        break;
      case 'wall': {
        const trace = () => {
          ctx.beginPath(); ctx.moveTo(o.a.x, o.a.y);
          if (o.bulge) { const c = wallControl(o.a, o.b, o.bulge); ctx.quadraticCurveTo(c.x, c.y, o.b.x, o.b.y); }
          else ctx.lineTo(o.b.x, o.b.y);
        };
        ctx.lineCap = 'round';
        ctx.strokeStyle = o.color ?? color; ctx.lineWidth = o.thickness; trace(); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = line; trace(); ctx.stroke();
        break;
      }
      case 'door': case 'window': {
        ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.angle * Math.PI / 180);
        const hw = o.width / 2;
        if (o.kind === 'door') {
          ctx.strokeStyle = color; ctx.lineWidth = 2 * line;
          ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(-hw, -o.width); ctx.stroke();      // leaf
          ctx.beginPath(); ctx.arc(-hw, 0, o.width, -Math.PI / 2, 0); ctx.stroke();          // swing arc
          ctx.strokeStyle = '#171a20'; ctx.lineWidth = 3 * line;
          ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0); ctx.stroke();               // threshold gap
        } else {
          const bulge = o.bulge || 0;   // curved windows arc to match the wall
          const arc = (off: number) => { ctx.beginPath(); ctx.moveTo(-hw, off); if (bulge) ctx.quadraticCurveTo(0, 2 * bulge + off, hw, off); else ctx.lineTo(hw, off); ctx.stroke(); };
          ctx.strokeStyle = '#171a20'; ctx.lineWidth = 4 * line; arc(0);
          ctx.strokeStyle = color; ctx.lineWidth = 1.5 * line; arc(-3); arc(3);
        }
        ctx.restore();
        break;
      }
      case 'furniture': {
        const item = FURNITURE_BY_ID[o.item];
        const c = furnitureCenter(o);
        ctx.save();
        ctx.translate(c.x, c.y); ctx.rotate(o.angle * Math.PI / 180); ctx.translate(-o.w / 2, -o.h / 2);
        if (item) item.draw(ctx, o.w, o.h);
        else { ctx.fillStyle = '#3a4150'; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.fillRect(0, 0, o.w, o.h); ctx.strokeRect(0, 0, o.w, o.h); }
        ctx.restore();
        break;
      }
      case 'dimension': this.drawDimensionWorld(o, color); break;
    }
  }

  private drawDimensionWorld(o: Extract<Obj, { kind: 'dimension' }>, color: string) {
    const { ctx, vp } = this;
    const line = 1 / vp.scale;
    const d = sub(o.b, o.a); const L = len(d) || 1;
    const n = { x: -d.y / L, y: d.x / L };            // perpendicular
    const oa = { x: o.a.x + n.x * o.offset, y: o.a.y + n.y * o.offset };
    const ob = { x: o.b.x + n.x * o.offset, y: o.b.y + n.y * o.offset };
    ctx.strokeStyle = color; ctx.lineWidth = line;
    ctx.beginPath();
    ctx.moveTo(o.a.x, o.a.y); ctx.lineTo(oa.x, oa.y);  // extension a
    ctx.moveTo(o.b.x, o.b.y); ctx.lineTo(ob.x, ob.y);  // extension b
    ctx.moveTo(oa.x, oa.y); ctx.lineTo(ob.x, ob.y);    // dim line
    ctx.stroke();
    this.arrow(oa, ob); this.arrow(ob, oa);
  }
  private arrow(from: Vec, to: Vec) {
    const { ctx, vp } = this; const a = 12 / vp.scale;
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x + Math.cos(ang - 0.4) * a, from.y + Math.sin(ang - 0.4) * a);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x + Math.cos(ang + 0.4) * a, from.y + Math.sin(ang + 0.4) * a);
    ctx.stroke();
  }

  private text(worldPos: Vec, str: string, color = '#dbe0ea', size = 12) {
    const { ctx, vp } = this;
    const s = vp.toScreen(worldPos);
    ctx.font = `${size}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(str).width;
    ctx.fillStyle = 'rgba(10,12,16,0.8)';
    ctx.fillRect(s.x - w / 2 - 4, s.y - 9, w + 8, 18);
    ctx.fillStyle = color;
    ctx.fillText(str, s.x, s.y);
  }

  private labelObject(o: Obj) {
    switch (o.kind) {
      case 'wall': {
        const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
        this.text(mid, fmtLen(dist(o.a, o.b)), '#c9cfdb');
        break;
      }
      case 'door': case 'window': {
        // always show the wall remaining on each side of the opening
        let best: { w: Extract<Obj, { kind: 'wall' }>; t: number } | null = null, bestD = 40;
        for (const w of this.doc.objects) {
          if (w.kind !== 'wall' || w.bulge) continue;
          const cs = closestOnSegment({ x: o.x, y: o.y }, w.a, w.b);
          const d = dist({ x: o.x, y: o.y }, cs.point);
          if (d < bestD) { bestD = d; best = { w, t: cs.t }; }
        }
        if (best) {
          const { w, t } = best, L = dist(w.a, w.b), dc = t * L, hw = o.width / 2;
          const ux = L > 1e-6 ? (w.b.x - w.a.x) / L : 1, uy = L > 1e-6 ? (w.b.y - w.a.y) / L : 0;
          const near = { x: w.a.x + ux * (dc - hw), y: w.a.y + uy * (dc - hw) };
          const far = { x: w.a.x + ux * (dc + hw), y: w.a.y + uy * (dc + hw) };
          this.text({ x: (w.a.x + near.x) / 2, y: (w.a.y + near.y) / 2 }, fmtLen(Math.max(0, dc - hw)), '#8bffb0');
          this.text({ x: (far.x + w.b.x) / 2, y: (far.y + w.b.y) / 2 }, fmtLen(Math.max(0, L - dc - hw)), '#8bffb0');
        }
        break;
      }
      case 'room': {
        const poly = o.poly && o.poly.length >= 3 ? o.poly : null;
        const c = poly ? polygonCentroid(poly) : { x: o.x + o.w / 2, y: o.y + o.h / 2 };
        const area = poly ? polygonArea(poly) : o.w * o.h;
        this.text({ x: c.x, y: c.y - 12 / this.vp.scale }, o.name || '房間', '#dbe0ea', 13);
        this.text({ x: c.x, y: c.y + 12 / this.vp.scale }, fmtArea(area), '#8b93a3');
        break;
      }
      case 'dimension': {
        const d = sub(o.b, o.a); const L = len(d) || 1;
        const n = { x: -d.y / L, y: d.x / L };
        const mid = { x: (o.a.x + o.b.x) / 2 + n.x * o.offset, y: (o.a.y + o.b.y) / 2 + n.y * o.offset };
        this.text(mid, fmtLen(dist(o.a, o.b)), '#8bffb0');
        break;
      }
      case 'furniture': {
        const c = furnitureCenter(o);
        this.text(c, FURNITURE_BY_ID[o.item]?.name ?? o.label, '#e0b45a', 11);
        break;
      }
    }
  }

  private drawSelection(o: Obj, withHandles = true) {
    const { ctx, vp } = this;
    ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1.5;
    // outline
    if (o.kind === 'furniture') {
      const c = furnitureCenter(o);
      const pts = [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }]
        .map(p => vp.toScreen(rotate(p, c, o.angle)));
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    } else if (o.kind === 'room' || !withHandles) {   // rooms always; walls/openings/dims when multi-selected
      const b = bounds(o);
      const a = vp.toScreen({ x: b.x, y: b.y }), c = vp.toScreen({ x: b.x + b.w, y: b.y + b.h });
      ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
    }
    // handles (single selection only)
    if (!withHandles) return;
    for (const h of handles(o)) {
      const s = vp.toScreen(h.pos);
      if (h.kind === 'rotate') {
        ctx.fillStyle = '#4c8dff'; ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill();
      } else if (h.kind === 'curve') {   // curvature handle — orange dot (drag to bend the wall)
        ctx.fillStyle = '#e0b45a'; ctx.strokeStyle = '#171a20'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1.5;
        ctx.fillRect(s.x - 4, s.y - 4, 8, 8); ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
      }
    }
  }
}
