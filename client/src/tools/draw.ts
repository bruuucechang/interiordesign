import { Tool, ToolCtx, PointerInfo } from './types';
import { genId } from '../model/doc';
import { layerForKind, Vec } from '../model/types';
import { fmtLen, dist, angleDeg, alignWallEnd, nearestWallSnap, bulgeFrom } from '../core/geometry';

const WALL_THICKNESS = 12;   // cm
const DIM_OFFSET = 40;       // cm
const JOIN_PX = 14;          // screen-px radius for snapping onto other walls

// Click to place points; each click chains a wall from the previous point.
// Endpoints snap onto nearby walls (foolproof joining); otherwise they soft-snap
// to 0/45/90° for grid alignment (Shift = force).
export class WallTool implements Tool {
  name = 'wall'; cursor = 'crosshair'; hint = '點擊放置牆的端點；自動貼合鄰近牆體端點，近水平/垂直/45° 對齊格線（Shift 強制）；Esc 結束';
  private start: Vec | null = null;
  private snapAt: Vec | null = null;   // set when the current end is snapped to another wall
  constructor(private ctx: ToolCtx) {}

  // endpoint for the current cursor: prefer snapping onto another wall, else grid/angle align
  private end(p: PointerInfo): Vec {
    if (this.ctx.snapEnabled) {
      const walls = this.ctx.doc.objects.filter(o => o.kind === 'wall') as any[];
      const s = nearestWallSnap(walls, p.world, JOIN_PX / this.ctx.vp.scale);
      if (s) { this.snapAt = s.point; return s.point; }
    }
    this.snapAt = null;
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
    const e = this.end(p);           // updates this.snapAt
    const s = this.start, snapAt = this.snapAt;
    const ang = s ? ((Math.round(angleDeg(s, e)) % 360) + 360) % 360 : 0;
    this.ctx.setPreview(
      ctx => {
        if (!s) return;
        ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = WALL_THICKNESS; ctx.globalAlpha = 0.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.globalAlpha = 1;
      },
      ctx => {
        if (s) { const m = this.ctx.vp.toScreen({ x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }); ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#4c8dff'; ctx.fillText(`${fmtLen(dist(s, e))} · ${ang}°`, m.x, m.y - 6); }
        if (snapAt) { const c = this.ctx.vp.toScreen(snapAt); ctx.strokeStyle = '#5ad19a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, Math.PI * 2); ctx.stroke(); }   // green ring = snapping
      },
    );
    this.ctx.render();
  }
  onUp() {}
  onKey(e: KeyboardEvent) { if (e.key === 'Escape') { this.start = null; this.snapAt = null; this.ctx.setPreview(); this.ctx.render(); } }
  deactivate() { this.start = null; this.snapAt = null; this.ctx.setPreview(); }
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

// Curved wall: click start, click end, move to set the arc, click to confirm.
// Chains from the previous endpoint like the straight tool.
export class CurvedWallTool implements Tool {
  name = 'wallCurve'; cursor = 'crosshair';
  hint = '點擊起點與終點，移動滑鼠設定弧度後再點擊確認；自動貼合牆體端點；Esc 結束';
  private a: Vec | null = null;          // chain start
  private wallId: string | null = null;  // wall currently being curved
  private b: Vec | null = null;          // its end
  private snapAt: Vec | null = null;
  constructor(private ctx: ToolCtx) {}

  private snap(p: PointerInfo): Vec {
    if (this.ctx.snapEnabled) {
      const walls = this.ctx.doc.objects.filter(o => o.kind === 'wall') as any[];
      const s = nearestWallSnap(walls, p.world, JOIN_PX / this.ctx.vp.scale, this.wallId ?? undefined);
      if (s) { this.snapAt = s.point; return s.point; }
    }
    this.snapAt = null;
    if (this.a && !this.wallId) return (this.ctx.snapEnabled || p.shift) ? alignWallEnd(this.a, p.snapped, this.ctx.gridSize, p.shift) : p.snapped;
    return p.snapped;
  }

  onDown(p: PointerInfo) {
    if (this.wallId) { this.a = this.b; this.wallId = null; this.b = null; this.snapAt = null; return; }   // confirm arc, chain on
    const end = this.snap(p);
    if (!this.a) { this.a = end; return; }
    if (dist(this.a, end) < 1) return;
    this.b = end;
    this.ctx.doc.commit();
    const id = genId('wall');
    this.ctx.doc.add({ id, kind: 'wall', layer: layerForKind('wall'), a: this.a, b: this.b, thickness: WALL_THICKNESS, bulge: 0 });
    this.wallId = id;
  }

  onMove(p: PointerInfo) {
    if (this.wallId && this.b) {                       // setting the arc depth
      let bulge = bulgeFrom(this.a!, this.b, p.world);
      const grid = this.ctx.gridSize;
      if (this.ctx.snapEnabled) bulge = Math.round(bulge / grid) * grid;
      if (Math.abs(bulge) < grid) bulge = 0;
      this.ctx.doc.update(this.wallId, { bulge } as any);
      this.ctx.setPreview(); this.ctx.render();
      return;
    }
    const s = this.a, e = this.snap(p), snapAt = this.snapAt;
    this.ctx.setPreview(
      ctx => { if (!s) return; ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = WALL_THICKNESS; ctx.globalAlpha = 0.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.globalAlpha = 1; },
      ctx => {
        if (s) { const m = this.ctx.vp.toScreen({ x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }); ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#4c8dff'; ctx.fillText(fmtLen(dist(s, e)), m.x, m.y - 6); }
        if (snapAt) { const c = this.ctx.vp.toScreen(snapAt); ctx.strokeStyle = '#5ad19a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, Math.PI * 2); ctx.stroke(); }
      },
    );
    this.ctx.render();
  }

  onUp() {}
  onKey(e: KeyboardEvent) { if (e.key === 'Escape') this.reset(); }
  deactivate() { this.reset(); }
  private reset() { this.a = null; this.wallId = null; this.b = null; this.snapAt = null; this.ctx.setPreview(); this.ctx.render(); }
}

// Ceiling beam: click endpoints (chains). Snaps to wall endpoints and axes.
const BEAM_WIDTH = 20, BEAM_DEPTH = 40;   // cm
export class BeamTool implements Tool {
  name = 'beam'; cursor = 'crosshair';
  hint = '點擊放置樑的端點；自動貼合牆體，近水平/垂直對齊格線；Esc 結束';
  private start: Vec | null = null;
  private snapAt: Vec | null = null;
  constructor(private ctx: ToolCtx) {}

  private end(p: PointerInfo): Vec {
    if (this.ctx.snapEnabled) {
      const walls = this.ctx.doc.objects.filter(o => o.kind === 'wall') as any[];
      const s = nearestWallSnap(walls, p.world, JOIN_PX / this.ctx.vp.scale);
      if (s) { this.snapAt = s.point; return s.point; }
    }
    this.snapAt = null;
    if (!this.start) return p.snapped;
    return (this.ctx.snapEnabled || p.shift) ? alignWallEnd(this.start, p.snapped, this.ctx.gridSize, p.shift) : p.snapped;
  }

  onDown(p: PointerInfo) {
    const end = this.end(p);
    if (!this.start) { this.start = end; return; }
    if (dist(this.start, end) < 1) return;
    this.ctx.doc.ensureLayer('beams', '樑', '#b07de0', 2);
    this.ctx.doc.commit();
    this.ctx.doc.add({ id: genId('beam'), kind: 'beam', layer: layerForKind('beam'), a: this.start, b: end, width: BEAM_WIDTH, depth: BEAM_DEPTH });
    this.start = end;
  }
  onMove(p: PointerInfo) {
    const e = this.end(p), s = this.start, snapAt = this.snapAt;
    this.ctx.setPreview(
      ctx => {
        if (!s) return;
        ctx.strokeStyle = '#b07de0'; ctx.lineWidth = BEAM_WIDTH; ctx.globalAlpha = 0.35; ctx.setLineDash([16 / this.ctx.vp.scale, 10 / this.ctx.vp.scale]);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      },
      ctx => {
        if (s) { const m = this.ctx.vp.toScreen({ x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }); ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#b07de0'; ctx.fillText(fmtLen(dist(s, e)), m.x, m.y - 6); }
        if (snapAt) { const c = this.ctx.vp.toScreen(snapAt); ctx.strokeStyle = '#5ad19a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, Math.PI * 2); ctx.stroke(); }
      },
    );
    this.ctx.render();
  }
  onUp() {}
  onKey(e: KeyboardEvent) { if (e.key === 'Escape') { this.start = null; this.snapAt = null; this.ctx.setPreview(); this.ctx.render(); } }
  deactivate() { this.start = null; this.snapAt = null; this.ctx.setPreview(); }
}

// Grab the canvas with the left mouse button to pan the view.
export class PanTool implements Tool {
  name = 'pan'; cursor = 'grab'; hint = '按住滑鼠左鍵拖曳平移視角';
  private last: Vec | null = null;
  constructor(private ctx: ToolCtx) {}
  onDown(p: PointerInfo) { this.last = p.screen; }
  onMove(p: PointerInfo) {
    if (!this.last) return;
    this.ctx.vp.panBy(p.screen.x - this.last.x, p.screen.y - this.last.y);
    this.last = p.screen;
    this.ctx.render();
  }
  onUp() { this.last = null; }
  deactivate() { this.last = null; }
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
