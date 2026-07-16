import { Tool, ToolCtx, PointerInfo } from './types';
import { genId } from '../model/doc';
import { layerForKind, Vec } from '../model/types';
import { fmtLen, dist, angleDeg, alignWallEnd } from '../core/geometry';

const WALL_THICKNESS = 12;   // cm
const DIM_OFFSET = 40;       // cm

// Click to place points; each click chains a wall from the previous point.
// Segments soft-snap to 0/45/90° so they line up with the grid (Shift = force).
export class WallTool implements Tool {
  name = 'wall'; cursor = 'crosshair'; hint = '點擊放置牆的端點；近水平/垂直/45° 自動對齊格線，按住 Shift 強制對齊；Esc 結束';
  private start: Vec | null = null;
  constructor(private ctx: ToolCtx) {}

  // aligned endpoint for the current cursor (axis/45° snap when snapping is on or Shift held)
  private end(p: PointerInfo): Vec {
    if (!this.start) return p.snapped;
    return (this.ctx.snapEnabled || p.shift) ? alignWallEnd(this.start, p.snapped, this.ctx.gridSize, p.shift) : p.snapped;
  }

  onDown(p: PointerInfo) {
    const end = this.end(p);
    if (!this.start) { this.start = end; return; }
    if (dist(this.start, end) < 1) return;
    this.ctx.doc.commit();
    this.ctx.doc.add({ id: genId('wall'), kind: 'wall', layer: layerForKind('wall'), a: this.start, b: end, thickness: WALL_THICKNESS });
    this.start = end;
  }
  onMove(p: PointerInfo) {
    if (!this.start) { this.ctx.setPreview(); return; }
    const s = this.start, e = this.end(p);
    const ang = ((Math.round(angleDeg(s, e)) % 360) + 360) % 360;
    this.ctx.setPreview(
      ctx => { ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = WALL_THICKNESS; ctx.globalAlpha = 0.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.globalAlpha = 1; },
      ctx => { const m = this.ctx.vp.toScreen({ x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }); ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#4c8dff'; ctx.fillText(`${fmtLen(dist(s, e))} · ${ang}°`, m.x, m.y - 6); },
    );
    this.ctx.render();
  }
  onUp() {}
  onKey(e: KeyboardEvent) { if (e.key === 'Escape') { this.start = null; this.ctx.setPreview(); this.ctx.render(); } }
  deactivate() { this.start = null; this.ctx.setPreview(); }
}

// Drag a rectangle to make a room.
export class RoomTool implements Tool {
  name = 'room'; cursor = 'crosshair'; hint = '拖曳一個矩形建立房間';
  private a: { x: number; y: number } | null = null;
  constructor(private ctx: ToolCtx) {}
  onDown(p: PointerInfo) { this.a = p.snapped; }
  onMove(p: PointerInfo) {
    if (!this.a) return;
    const a = this.a, b = p.snapped;
    this.ctx.setPreview(ctx => {
      ctx.strokeStyle = '#4c8dff'; ctx.setLineDash([8 / this.ctx.vp.scale, 6 / this.ctx.vp.scale]); ctx.lineWidth = 2 / this.ctx.vp.scale;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.setLineDash([]);
    });
    this.ctx.render();
  }
  onUp(p: PointerInfo) {
    if (!this.a) return;
    const a = this.a, b = p.snapped; this.a = null; this.ctx.setPreview();
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w < 20 || h < 20) { this.ctx.render(); return; }
    this.ctx.doc.commit();
    this.ctx.doc.add({ id: genId('room'), kind: 'room', layer: layerForKind('room'), x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h, name: '房間' });
    this.ctx.render();
  }
  deactivate() { this.a = null; this.ctx.setPreview(); }
}

// Drag between two points to place a dimension line.
export class DimensionTool implements Tool {
  name = 'dimension'; cursor = 'crosshair'; hint = '拖曳量測兩點之間的距離';
  private a: { x: number; y: number } | null = null;
  constructor(private ctx: ToolCtx) {}
  onDown(p: PointerInfo) { this.a = p.snapped; }
  onMove(p: PointerInfo) {
    if (!this.a) return;
    const a = this.a, b = p.snapped;
    this.ctx.setPreview(
      ctx => { ctx.strokeStyle = '#8bffb0'; ctx.lineWidth = 1 / this.ctx.vp.scale; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); },
      ctx => { const m = this.ctx.vp.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#8bffb0'; ctx.fillText(fmtLen(dist(a, b)), m.x, m.y - 6); },
    );
    this.ctx.render();
  }
  onUp(p: PointerInfo) {
    if (!this.a) return;
    const a = this.a, b = p.snapped; this.a = null; this.ctx.setPreview();
    if (dist(a, b) < 5) { this.ctx.render(); return; }
    this.ctx.doc.commit();
    this.ctx.doc.add({ id: genId('dim'), kind: 'dimension', layer: layerForKind('dimension'), a, b, offset: DIM_OFFSET });
    this.ctx.render();
  }
  deactivate() { this.a = null; this.ctx.setPreview(); }
}
