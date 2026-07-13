import { Tool, ToolCtx, PointerInfo } from './types';
import { genId } from '../model/doc';
import { layerForKind, Vec } from '../model/types';
import { closestOnSegment, angleDeg, dist } from '../core/geometry';
import { FURNITURE_BY_ID } from '../data/furniture';

const WALL_SNAP = 40; // cm — how close to a wall to snap an opening onto it

// Place a door or window. Snaps onto the nearest wall (position + angle).
export class OpeningTool implements Tool {
  cursor = 'crosshair';
  private cand: { pos: Vec; angle: number } | null = null;
  constructor(private ctx: ToolCtx, public kind: 'door' | 'window') {
    this.name = kind; this.hint = kind === 'door' ? '在牆上點擊放置門' : '在牆上點擊放置窗';
  }
  name: string; hint: string;

  private width() { return this.kind === 'door' ? 90 : 120; }

  private findWall(p: Vec): { pos: Vec; angle: number } {
    let best: { pos: Vec; angle: number } | null = null; let bestD = WALL_SNAP;
    for (const o of this.ctx.doc.objects) {
      if (o.kind !== 'wall' || !this.ctx.doc.isLayerVisible(o.layer)) continue;
      const { point } = closestOnSegment(p, o.a, o.b);
      const d = dist(p, point);
      if (d < bestD) { bestD = d; best = { pos: point, angle: angleDeg(o.a, o.b) }; }
    }
    return best ?? { pos: p, angle: 0 };
  }

  onMove(p: PointerInfo) {
    this.cand = this.findWall(p.snapped);
    const c = this.cand, w = this.width();
    this.ctx.setPreview(ctx => {
      ctx.save(); ctx.translate(c.pos.x, c.pos.y); ctx.rotate(c.angle * Math.PI / 180);
      ctx.strokeStyle = '#7bc6ff'; ctx.globalAlpha = 0.7; ctx.lineWidth = 6 / this.ctx.vp.scale;
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke(); ctx.globalAlpha = 1; ctx.restore();
    });
    this.ctx.render();
  }
  onDown(p: PointerInfo) {
    const c = this.cand ?? this.findWall(p.snapped);
    this.ctx.doc.commit();
    const id = genId(this.kind);
    this.ctx.doc.add({ id, kind: this.kind, layer: layerForKind(this.kind), x: c.pos.x, y: c.pos.y, width: this.width(), angle: c.angle });
    this.ctx.doc.select(id);
    this.ctx.setPreview();
  }
  onUp() {}
  deactivate() { this.cand = null; this.ctx.setPreview(); }
}

// Place the currently-selected furniture item, then switch to the select tool.
export class FurnitureTool implements Tool {
  name = 'furniture'; cursor = 'crosshair'; hint = '點擊放置所選家具（可再選取調整）';
  constructor(private ctx: ToolCtx) {}

  onMove(p: PointerInfo) {
    const item = FURNITURE_BY_ID[this.ctx.currentFurniture];
    if (!item) { this.ctx.setPreview(); return; }
    this.ctx.setPreview(ctx => {
      ctx.save(); ctx.globalAlpha = 0.55;
      ctx.translate(p.snapped.x, p.snapped.y); ctx.translate(-item.w / 2, -item.h / 2);
      item.draw(ctx, item.w, item.h); ctx.restore();
    });
    this.ctx.render();
  }
  onDown(p: PointerInfo) {
    const item = FURNITURE_BY_ID[this.ctx.currentFurniture];
    if (!item) return;
    this.ctx.doc.commit();
    const id = genId('furn');
    this.ctx.doc.add({ id, kind: 'furniture', layer: layerForKind('furniture'), item: item.id, x: p.snapped.x - item.w / 2, y: p.snapped.y - item.h / 2, w: item.w, h: item.h, angle: 0, label: item.name });
    this.ctx.doc.select(id);
    this.ctx.selectTool('select');
  }
  onUp() {}
  deactivate() { this.ctx.setPreview(); }
}
