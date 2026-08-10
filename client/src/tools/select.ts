import { Tool, ToolCtx, PointerInfo } from './types';
import { Obj, Vec } from '../model/schema';
import { handles } from '../core/handles';
import { hitTest, furnitureCenter } from '../core/hit';
import { snap, dist } from '../core/geometry';
import { resizeBox, resizeFurniture, curveBulge, rotateAngle, openingEndpoint, Corner } from '../core/transform';
import { computeSnap, drawSnap, WallSeg } from '../core/snap';
import { fitOpeningToWall } from './place';

type Mode = 'idle' | 'move' | 'corner' | 'endpoint' | 'rotate' | 'curve' | 'pan';

export class SelectTool implements Tool {
  name = 'select'; cursor = 'grab'; hint = '拖曳物件移動、角落縮放、圓點旋轉；拖曳空白處平移畫面；Delete 刪除';
  private mode: Mode = 'idle';
  private handleId = '';
  private orig: any = null;      // JSON snapshot of the object at drag start (single-object edits)
  private origMany: { o: Obj; snap: any }[] = [];   // snapshots for moving a multi-selection
  private panFrom: Vec = { x: 0, y: 0 };  // screen pos while dragging empty space to pan
  private panMoved = false;
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
      this.panFrom = p.screen; this.panMoved = false;   // empty space → pan the view
      this.mode = 'pan';
    }
  }

  onMove(p: PointerInfo) {
    if (this.mode === 'pan') {
      const dx = p.screen.x - this.panFrom.x, dy = p.screen.y - this.panFrom.y;
      if (Math.hypot(dx, dy) > 2) this.panMoved = true;
      this.ctx.vp.panBy(dx, dy);
      this.panFrom = p.screen;
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
    if (this.mode === 'pan' && !this.panMoved) this.ctx.doc.select(null);   // a plain click on empty space clears the selection
    this.mode = 'idle'; this.orig = null; this.origMany = [];
    this.ctx.setPreview();   // clear angle badge / snap ring
    this.ctx.render();
  }

  deactivate() { this.mode = 'idle'; this.orig = null; this.origMany = []; this.ctx.setPreview(); }

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
    const grid = this.ctx.snapEnabled ? this.ctx.gridSize : 0;
    if (o.kind === 'furniture') this.patch(o, resizeFurniture(g, p.world, grid) as any);
    else if (o.kind === 'room' || o.kind === 'image') {
      this.patch(o, resizeBox(g, this.handleId as Corner, p.snapped) as any);
    }
  }

  private doCurve(o: Obj, p: PointerInfo) {
    if (o.kind !== 'wall') return;
    const g = this.orig;
    this.patch(o, { bulge: curveBulge(g.a, g.b, p.world, this.ctx.gridSize, this.ctx.snapEnabled) } as any);
  }

  private doEndpoint(o: Obj, p: PointerInfo) {
    const g = this.orig;
    if (o.kind === 'wall' || o.kind === 'beam' || o.kind === 'dimension') {
      let pt = p.snapped;
      this.ctx.setPreview();
      if ((o.kind === 'wall' || o.kind === 'beam') && this.ctx.snapEnabled) {   // same smart snap as drawing
        const walls = this.ctx.doc.objects.filter(w => w.kind === 'wall') as unknown as WallSeg[];
        const s = computeSnap(walls, p.world, 14 / this.ctx.vp.scale, { excludeId: o.id });
        if (s) {
          pt = s.point;
          this.ctx.setPreview(undefined, ctx => drawSnap(ctx, this.ctx.vp, s));
        }
      }
      this.patch(o, (this.handleId === 'a' ? { a: pt } : { b: pt }) as any);
    } else if (o.kind === 'door' || o.kind === 'window') {
      const e = openingEndpoint(g, this.handleId as 'a' | 'b', p.world);
      // Keep the resized opening glued to its wall (position + angle + curvature).
      // Pass the span (fixed end + dragged end) so a curved wall is fit *between*
      // those points along the arc — the fixed end sits on the arc (dist ~0) so it
      // always snaps, and the window can stretch to the wall's full extent without
      // the arc-length walk shrinking or capping it early.
      const fit = fitOpeningToWall(this.ctx.doc, e.centre, e.width, o.kind === 'window',
        Math.max(120, e.width), { p0: e.fixed, p1: p.world });
      if (fit) this.patch(o, { x: fit.pos.x, y: fit.pos.y, width: Math.max(10, fit.width), angle: fit.angle, bulge: fit.bulge || undefined } as any);
      else this.patch(o, { x: e.centre.x, y: e.centre.y, width: e.width, angle: e.angle } as any);
    }
  }

  private doRotate(o: Obj, p: PointerInfo) {
    const g = this.orig;
    const c = 'w' in g ? furnitureCenter(g) : { x: g.x, y: g.y };
    const ang = rotateAngle(c, p.world, !!p.shift);
    this.patch(o, { angle: ang } as any);

    // live angle readout above the object; green when snapped to a right angle
    const deg = ((Math.round(ang) % 360) + 360) % 360;
    this.ctx.setPreview(undefined, ctx => this.drawAngleBadge(ctx, this.ctx.vp.toScreen(c), deg, deg % 90 === 0));
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
