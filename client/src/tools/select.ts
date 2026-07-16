import { Tool, ToolCtx, PointerInfo } from './types';
import { Obj, Vec } from '../model/types';
import { handles } from '../core/handles';
import { hitTest, furnitureCenter, bounds } from '../core/hit';
import { rotate, dist, angleDeg, snap, bulgeFrom, nearestWallSnap } from '../core/geometry';
import { fitOpeningToWall } from './place';

type Mode = 'idle' | 'move' | 'corner' | 'endpoint' | 'rotate' | 'curve' | 'marquee';

export class SelectTool implements Tool {
  name = 'select'; cursor = 'default'; hint = '點選或框選物件；拖曳移動、角落縮放、圓點旋轉；Delete 刪除';
  private mode: Mode = 'idle';
  private handleId = '';
  private orig: any = null;      // JSON snapshot of the object at drag start (single-object edits)
  private origMany: { o: Obj; snap: any }[] = [];   // snapshots for moving a multi-selection
  private marquee: { a: Vec; b: Vec } | null = null; // rubber-band box in world coords
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
      if (!doc.isSelected(hit.id)) doc.select(hit.id);   // a fresh object selects alone; one already in the group keeps it
      doc.commit();
      this.origMany = doc.selectedObjects.map(o => ({ o, snap: JSON.parse(JSON.stringify(o)) }));
      this.start = p.snapped;
      this.mode = 'move';
    } else {
      this.marquee = { a: p.world, b: p.world };   // start a rubber-band box on empty space
      this.mode = 'marquee';
    }
  }

  onMove(p: PointerInfo) {
    if (this.mode === 'marquee' && this.marquee) {
      this.marquee.b = p.world;
      const m = this.marquee, sc = this.ctx.vp.scale;
      this.ctx.setPreview(ctx => {
        const x = Math.min(m.a.x, m.b.x), y = Math.min(m.a.y, m.b.y), w = Math.abs(m.b.x - m.a.x), h = Math.abs(m.b.y - m.a.y);
        ctx.fillStyle = 'rgba(76,141,255,0.08)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1.5 / sc; ctx.setLineDash([6 / sc, 4 / sc]);
        ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
      });
      this.ctx.render();
      return;
    }
    if (this.mode === 'idle') return;
    if (this.mode === 'move') { for (const { o, snap } of this.origMany) this.translate(o, snap, p); this.ctx.render(); return; }
    const o = this.ctx.doc.selected;
    if (!o || !this.orig) return;
    if (this.mode === 'corner') this.doResize(o, p);
    else if (this.mode === 'endpoint') this.doEndpoint(o, p);
    else if (this.mode === 'rotate') this.doRotate(o, p);
    else if (this.mode === 'curve') this.doCurve(o, p);
    this.ctx.render();
  }

  onUp() {
    if (this.mode === 'marquee' && this.marquee) {
      const { doc } = this.ctx, m = this.marquee;
      const r = { x: Math.min(m.a.x, m.b.x), y: Math.min(m.a.y, m.b.y), w: Math.abs(m.b.x - m.a.x), h: Math.abs(m.b.y - m.a.y) };
      if (r.w < 2 && r.h < 2) doc.select(null);          // a plain click on empty space clears the selection
      else doc.selectMany(doc.objects.filter(o => doc.isLayerVisible(o.layer) && !doc.isLayerLocked(o.layer) && this.rectHits(r, o)).map(o => o.id));
    }
    this.mode = 'idle'; this.orig = null; this.origMany = []; this.marquee = null;
    this.ctx.setPreview();   // clear angle badge / snap ring / marquee box
    this.ctx.render();
  }

  deactivate() { this.mode = 'idle'; this.orig = null; this.origMany = []; this.marquee = null; this.ctx.setPreview(); }

  private rectHits(r: { x: number; y: number; w: number; h: number }, o: Obj): boolean {
    const b = bounds(o);
    return r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y;
  }

  private patch(o: Obj, patch: Partial<Obj>) { this.ctx.doc.update(o.id, patch); }

  // translate one object by (cursor - start), from its drag-start snapshot
  private translate(o: Obj, snap: any, p: PointerInfo) {
    const d = { x: p.snapped.x - this.start.x, y: p.snapped.y - this.start.y };
    if (o.kind === 'door' || o.kind === 'window') {   // openings stay glued to the nearest wall
      const c = { x: snap.x + d.x, y: snap.y + d.y };
      const fit = fitOpeningToWall(this.ctx.doc, c, snap.width, o.kind === 'window', 80);
      if (fit) this.patch(o, { x: fit.pos.x, y: fit.pos.y, angle: fit.angle, width: fit.width, bulge: fit.bulge || undefined } as any);
      else this.patch(o, { x: c.x, y: c.y } as any);
      return;
    }
    if (o.kind === 'room' && snap.poly) {   // move the polygon with its bbox (detaches an auto room)
      const poly = (snap.poly as Vec[]).map(pt => ({ x: pt.x + d.x, y: pt.y + d.y }));
      this.patch(o, { x: snap.x + d.x, y: snap.y + d.y, poly, auto: false } as any);
    } else if ('x' in snap) this.patch(o, { x: snap.x + d.x, y: snap.y + d.y } as any);
    else if ('a' in snap) this.patch(o, { a: { x: snap.a.x + d.x, y: snap.a.y + d.y }, b: { x: snap.b.x + d.x, y: snap.b.y + d.y } } as any);
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
    } else if (o.kind === 'room' || o.kind === 'image') {
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
      let pt = p.snapped;
      this.ctx.setPreview();
      if (o.kind === 'wall' && this.ctx.snapEnabled) {   // foolproof: snap the dragged end onto other walls
        const walls = this.ctx.doc.objects.filter(w => w.kind === 'wall') as any[];
        const s = nearestWallSnap(walls, p.world, 14 / this.ctx.vp.scale, o.id);
        if (s) {
          pt = s.point;
          const c = this.ctx.vp.toScreen(pt);
          this.ctx.setPreview(undefined, ctx => { ctx.strokeStyle = '#5ad19a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, Math.PI * 2); ctx.stroke(); });
        }
      }
      this.patch(o, (this.handleId === 'a' ? { a: pt } : { b: pt }) as any);
    } else if (o.kind === 'door' || o.kind === 'window') {
      const center = { x: g.x, y: g.y };
      const otherLocal = this.handleId === 'a' ? { x: g.x + g.width / 2, y: g.y } : { x: g.x - g.width / 2, y: g.y };
      const other = rotate(otherLocal, center, g.angle);
      const nc = { x: (other.x + p.world.x) / 2, y: (other.y + p.world.y) / 2 };
      const width = Math.max(10, dist(other, p.world));
      // keep the resized opening glued to its wall (position + angle + curvature)
      const fit = fitOpeningToWall(this.ctx.doc, nc, width, o.kind === 'window', 100);
      if (fit) this.patch(o, { x: fit.pos.x, y: fit.pos.y, width: fit.width, angle: fit.angle, bulge: fit.bulge || undefined } as any);
      else this.patch(o, { x: nc.x, y: nc.y, width, angle: this.handleId === 'b' ? angleDeg(other, p.world) : angleDeg(p.world, other) } as any);
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
    const objs = doc.selectedObjects;
    if (!objs.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { doc.commit(); for (const o of objs) doc.remove(o.id); e.preventDefault(); }
    else if (e.key === 'Escape') doc.select(null);
    else if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? this.ctx.gridSize : 1;
      const d = { x: 0, y: 0 };
      if (e.key === 'ArrowLeft') d.x = -step; if (e.key === 'ArrowRight') d.x = step;
      if (e.key === 'ArrowUp') d.y = -step; if (e.key === 'ArrowDown') d.y = step;
      doc.commit();
      for (const o of objs) {
        const g: any = o;
        if (o.kind === 'room' && g.poly) { const poly = (g.poly as Vec[]).map(pt => ({ x: pt.x + d.x, y: pt.y + d.y })); this.patch(o, { x: g.x + d.x, y: g.y + d.y, poly, auto: false } as any); }
        else if ('x' in g) this.patch(o, { x: g.x + d.x, y: g.y + d.y } as any);
        else if ('a' in g) this.patch(o, { a: { x: g.a.x + d.x, y: g.a.y + d.y }, b: { x: g.b.x + d.x, y: g.b.y + d.y } } as any);
      }
      e.preventDefault();
    }
  }
}
