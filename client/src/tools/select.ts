import { Tool, ToolCtx, PointerInfo } from './types';
import { Obj, Vec } from '../model/types';
import { handles } from '../core/handles';
import { hitTest, furnitureCenter } from '../core/hit';
import { rotate, dist, angleDeg, snap, bulgeFrom } from '../core/geometry';

type Mode = 'idle' | 'move' | 'corner' | 'endpoint' | 'rotate' | 'curve';

export class SelectTool implements Tool {
  name = 'select'; cursor = 'default'; hint = '點選物件；拖曳移動、角落縮放、圓點旋轉（近 90° 自動對齊，Shift 每 15°）；Delete 刪除';
  private mode: Mode = 'idle';
  private handleId = '';
  private orig: any = null;      // JSON snapshot of the object at drag start
  private start: Vec = { x: 0, y: 0 };

  constructor(private ctx: ToolCtx) {}

  private gsnap(v: number) { return this.ctx.snapEnabled ? snap(v, this.ctx.gridSize) : v; }

  onDown(p: PointerInfo) {
    const { doc, vp } = this.ctx;
    const sel = doc.selected;
    if (sel) {
      for (const h of handles(sel)) {
        if (dist(vp.toScreen(h.pos), p.screen) <= 8) {
          doc.commit();
          this.orig = JSON.parse(JSON.stringify(sel));
          this.handleId = h.id;
          this.mode = h.kind === 'rotate' ? 'rotate' : h.kind === 'endpoint' ? 'endpoint' : h.kind === 'curve' ? 'curve' : 'corner';
          return;
        }
      }
    }
    const hit = hitTest(doc, p.world, 6 / vp.scale);
    if (hit) {
      if (hit.id !== doc.selectedId) doc.select(hit.id);
      doc.commit();
      this.orig = JSON.parse(JSON.stringify(hit));
      this.start = p.snapped;
      this.mode = 'move';
    } else {
      doc.select(null);
      this.mode = 'idle';
    }
  }

  onMove(p: PointerInfo) {
    if (this.mode === 'idle' || !this.orig) return;
    const o = this.ctx.doc.selected;
    if (!o) return;
    if (this.mode === 'move') this.doMove(o, p);
    else if (this.mode === 'corner') this.doResize(o, p);
    else if (this.mode === 'endpoint') this.doEndpoint(o, p);
    else if (this.mode === 'rotate') this.doRotate(o, p);
    else if (this.mode === 'curve') this.doCurve(o, p);
    this.ctx.render();
  }

  onUp() {
    if (this.mode === 'rotate') { this.ctx.setPreview(); this.ctx.render(); }   // clear the angle badge
    this.mode = 'idle'; this.orig = null;
  }

  private patch(o: Obj, patch: Partial<Obj>) { this.ctx.doc.update(o.id, patch); }

  private doMove(o: Obj, p: PointerInfo) {
    const d = { x: p.snapped.x - this.start.x, y: p.snapped.y - this.start.y };
    const g = this.orig;
    if (o.kind === 'room' && g.poly) {   // move the whole polygon with its bbox (detaches an auto room)
      const poly = (g.poly as Vec[]).map(pt => ({ x: pt.x + d.x, y: pt.y + d.y }));
      this.patch(o, { x: g.x + d.x, y: g.y + d.y, poly, auto: false } as any);
    } else if ('x' in g) this.patch(o, { x: g.x + d.x, y: g.y + d.y } as any);
    else if ('a' in g) this.patch(o, { a: { x: g.a.x + d.x, y: g.a.y + d.y }, b: { x: g.b.x + d.x, y: g.b.y + d.y } } as any);
  }

  private doResize(o: Obj, p: PointerInfo) {
    const g = this.orig;
    if (o.kind === 'furniture') {
      const c = furnitureCenter(g);
      const local = rotate(p.world, c, -g.angle);
      let w = Math.max(10, Math.abs(local.x - c.x) * 2);
      let h = Math.max(10, Math.abs(local.y - c.y) * 2);
      if (this.ctx.snapEnabled) { w = Math.max(10, snap(w, this.ctx.gridSize)); h = Math.max(10, snap(h, this.ctx.gridSize)); }
      this.patch(o, { w, h, x: c.x - w / 2, y: c.y - h / 2 } as any);
    } else if (o.kind === 'room') {
      const opp: Record<string, Vec> = {
        nw: { x: g.x + g.w, y: g.y + g.h }, se: { x: g.x, y: g.y },
        ne: { x: g.x, y: g.y + g.h }, sw: { x: g.x + g.w, y: g.y },
      };
      const f = opp[this.handleId];
      const q = p.snapped;
      const x = Math.min(f.x, q.x), y = Math.min(f.y, q.y);
      this.patch(o, { x, y, w: Math.max(10, Math.abs(q.x - f.x)), h: Math.max(10, Math.abs(q.y - f.y)) } as any);
    }
  }

  private doCurve(o: Obj, p: PointerInfo) {
    if (o.kind !== 'wall') return;
    const g = this.orig;
    let bulge = bulgeFrom(g.a, g.b, p.world);
    const grid = this.ctx.gridSize;
    if (this.ctx.snapEnabled) bulge = Math.round(bulge / grid) * grid;   // tidy arc depths
    if (Math.abs(bulge) < grid) bulge = 0;                               // snaps back to straight near zero
    this.patch(o, { bulge } as any);
  }

  private doEndpoint(o: Obj, p: PointerInfo) {
    const g = this.orig;
    if (o.kind === 'wall' || o.kind === 'dimension') {
      this.patch(o, (this.handleId === 'a' ? { a: p.snapped } : { b: p.snapped }) as any);
    } else if (o.kind === 'door' || o.kind === 'window') {
      const center = { x: g.x, y: g.y };
      const otherLocal = this.handleId === 'a' ? { x: g.x + g.width / 2, y: g.y } : { x: g.x - g.width / 2, y: g.y };
      const other = rotate(otherLocal, center, g.angle);
      const nc = { x: (other.x + p.world.x) / 2, y: (other.y + p.world.y) / 2 };
      const width = Math.max(10, dist(other, p.world));
      const ang = this.handleId === 'b' ? angleDeg(other, p.world) : angleDeg(p.world, other);
      this.patch(o, { x: nc.x, y: nc.y, width, angle: ang } as any);
    }
  }

  private doRotate(o: Obj, p: PointerInfo) {
    const g = this.orig;
    const c = 'w' in g ? furnitureCenter(g) : { x: g.x, y: g.y };
    let ang = angleDeg(c, p.world) + 90;
    if (p.shift) {
      ang = Math.round(ang / 15) * 15;            // Shift: fixed 15° steps
    } else {
      const near90 = Math.round(ang / 90) * 90;   // magnetic to 0/90/180/270 for easy alignment
      ang = Math.abs(ang - near90) <= 8 ? near90 : Math.round(ang);
    }
    this.patch(o, { angle: ang } as any);

    // live angle readout above the object; green when snapped to a right angle
    const deg = (((Math.round(ang)) % 360) + 360) % 360;
    const at = this.ctx.vp.toScreen(c);
    const cardinal = deg % 90 === 0;
    this.ctx.setPreview(undefined, ctx => this.drawAngleBadge(ctx, at, deg, cardinal));
  }

  private drawAngleBadge(ctx: CanvasRenderingContext2D, at: Vec, deg: number, cardinal: boolean) {
    const text = `${deg}°`;
    ctx.save();
    ctx.font = '600 13px system-ui, -apple-system, "Noto Sans TC", sans-serif';
    const padX = 9, w = Math.ceil(ctx.measureText(text).width) + padX * 2, h = 22;
    const x = at.x - w / 2, y = at.y - 44;
    ctx.beginPath();
    if ((ctx as any).roundRect) (ctx as any).roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
    ctx.fillStyle = 'rgba(17,22,30,0.92)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = cardinal ? '#5ad19a' : '#7bc6ff';
    ctx.stroke();
    ctx.fillStyle = cardinal ? '#5ad19a' : '#cfe8ff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, at.x, y + h / 2 + 0.5);
    ctx.restore();
  }

  onKey(e: KeyboardEvent) {
    const { doc } = this.ctx;
    const o = doc.selected;
    if (!o) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { doc.commit(); doc.remove(o.id); e.preventDefault(); }
    else if (e.key === 'Escape') doc.select(null);
    else if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? this.ctx.gridSize : 1;
      const d = { x: 0, y: 0 };
      if (e.key === 'ArrowLeft') d.x = -step; if (e.key === 'ArrowRight') d.x = step;
      if (e.key === 'ArrowUp') d.y = -step; if (e.key === 'ArrowDown') d.y = step;
      doc.commit();
      const g: any = o;
      if ('x' in g) this.patch(o, { x: g.x + d.x, y: g.y + d.y } as any);
      else if ('a' in g) this.patch(o, { a: { x: g.a.x + d.x, y: g.a.y + d.y }, b: { x: g.b.x + d.x, y: g.b.y + d.y } } as any);
      e.preventDefault();
    }
  }
}
