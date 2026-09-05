import { Tool, ToolCtx, PointerInfo } from './types';
import { DynamicState, emptyDynamic, isEmpty, applyKey, resolveEnd, describe } from '../core/dynamicInput';
import { genId } from '../model/doc';
import { Vec } from '../model/schema';
import { layerForKind } from '../model/catalogue';
import { fmtLen, dist, angleDeg, alignWallEnd, bulgeFrom } from '../core/geometry';
import { applyReference } from '../core/wallEdit';
import { computeSnap, drawSnap, SnapResult, WallSeg } from '../core/snap';

const WALL_THICKNESS = 12;   // cm
const DIM_OFFSET = 40;       // cm
const JOIN_PX = 14;          // screen-px radius for snapping onto other walls
const PLACE_STEP = 1;        // cm — round placed endpoints to a clean grid

// Round a freshly placed endpoint to the nearest cm so lengths/areas don't carry
// sub-cm float noise (a 10.0015 m wall reads as "10.00 m" yet bloats the room to
// 100.03 m²). An exact endpoint JOIN is left untouched so the point stays
// coincident with the node it snapped to — that's what keeps rooms closing.
export function placePoint(pt: Vec, snap: SnapResult | null): Vec {
  if (snap && snap.kind === 'end') return pt;
  return { x: Math.round(pt.x / PLACE_STEP) * PLACE_STEP, y: Math.round(pt.y / PLACE_STEP) * PLACE_STEP };
}

// Click to place points; each click chains a wall from the previous point.
// Endpoints snap onto nearby walls (foolproof joining); otherwise they soft-snap
// to 0/45/90° for grid alignment (Shift = force).
export class WallTool implements Tool {
  name = 'wall'; cursor = 'crosshair'; hint = '點擊放置端點，或直接輸入長度（Tab 切角度、Enter 放置、Backspace 修改）；R 切換基準線；Esc 結束';
  private start: Vec | null = null;
  private snap: SnapResult | null = null;   // set when the current end snapped to a wall / alignment
  /** Last pointer position, so typed input has a direction to fall back on. */
  private at: Vec = { x: 0, y: 0 };
  private dyn: DynamicState = emptyDynamic();
  constructor(private ctx: ToolCtx) {}

  /** Where the next point goes: what was typed, else where the pointer is. */
  private target(): Vec {
    if (this.start && !isEmpty(this.dyn)) {
      const e = resolveEnd(this.dyn, this.start, this.at);
      if (e) return e;
    }
    return this.at;
  }

  /** Place the next point — the keyboard's equivalent of a click. */
  private commitPoint(end: Vec) {
    if (!this.start) { this.start = end; this.dyn = emptyDynamic(); return; }
    if (dist(this.start, end) < 1) return;
    this.ctx.doc.commit();
    const seg = applyReference(this.start, end, this.ctx.wallRef, WALL_THICKNESS);
    this.ctx.doc.add({ id: genId('wall'), kind: 'wall', layer: layerForKind('wall'), a: seg.a, b: seg.b, thickness: WALL_THICKNESS });
    this.start = end;
    this.dyn = emptyDynamic();
  }

  // endpoint for the current cursor: prefer a smart wall/alignment snap, else grid/angle align
  private end(p: PointerInfo): Vec {
    if (this.ctx.snapEnabled) {
      const walls = this.ctx.doc.objects.filter(o => o.kind === 'wall') as unknown as WallSeg[];
      const s = computeSnap(walls, p.world, JOIN_PX / this.ctx.vp.scale);
      if (s) { this.snap = s; return s.point; }
    }
    this.snap = null;
    if (!this.start) return p.snapped;
    return (this.ctx.snapEnabled || p.shift) ? alignWallEnd(this.start, p.snapped, this.ctx.gridSize, p.shift) : p.snapped;
  }

  onDown(p: PointerInfo) {
    // Clicking and typing go through the same `commitPoint`, so a run can mix
    // them freely — click a start on the underlay, then type the length off it.
    this.at = placePoint(this.end(p), this.snap);   // this.end() sets this.snap
    this.commitPoint(this.target());
  }
  onMove(p: PointerInfo) {
    this.at = this.end(p);           // updates this.snap
    const e = this.target();
    const s = this.start, snap = this.snap;
    const ang = s ? ((Math.round(angleDeg(s, e)) % 360) + 360) % 360 : 0;
    this.ctx.setPreview(
      ctx => {
        if (!s) return;
        // The band shows where the wall will actually be; the thin line shows
        // the face being measured. Drawing only the band would put it centred
        // on the cursor, which is exactly the misunderstanding this feature
        // exists to remove.
        const seg = applyReference(s, e, this.ctx.wallRef, WALL_THICKNESS);
        ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = WALL_THICKNESS; ctx.globalAlpha = 0.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(seg.a.x, seg.a.y); ctx.lineTo(seg.b.x, seg.b.y); ctx.stroke(); ctx.globalAlpha = 1;
        if (this.ctx.wallRef !== 'center') {
          ctx.strokeStyle = '#8bffb0'; ctx.lineWidth = 1 / this.ctx.vp.scale;
          ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        }
      },
      ctx => {
        if (s) {
          const m = this.ctx.vp.toScreen({ x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 });
          ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center';
          // While something is being typed, show what was typed — not the
          // pointer's reading. Showing the mouse value would contradict the
          // keys as they are pressed.
          const typing = !isEmpty(this.dyn);
          ctx.fillStyle = typing ? '#ffd166' : '#4c8dff';
          ctx.fillText(typing ? describe(this.dyn, 'cm') : `${fmtLen(dist(s, e))} · ${ang}°`, m.x, m.y - 6);
        }
        if (snap) drawSnap(ctx, this.ctx.vp, snap);
      },
    );
    this.ctx.render();
  }
  onUp() {}
  onKey(e: KeyboardEvent) {
    // Escape never reaches here, and that is correct.
    //
    // `editor.ts` handles it as a document-level action ahead of every tool —
    // deliberately, because it used to sit behind the input guards and so did
    // nothing at all in the 3D and split views, which is exactly where you want
    // out. A two-stage Escape (clear the typing, then end the run) was tried
    // here and would have meant undoing that; `Backspace` clears the digits
    // instead, and it is already the key for "undo my last keystroke".
    if (e.key === 'Escape') return;
    // R cycles the reference line mid-draw, which is when you find out the tape
    // was against the other face. Not Space, which Coohom uses — here Space is
    // already hold-to-pan, and that is the stronger habit of the two.
    if (e.key === 'r' || e.key === 'R') { this.ctx.cycleWallRef(); this.ctx.render(); return; }
    if (e.key === 'Enter') {
      // Enter is the keyboard's click. With nothing started it drops the first
      // point where the pointer last was, so a run can begin without one.
      this.commitPoint(this.target());
      e.preventDefault(); this.ctx.render();
      return;
    }
    const next = applyKey(this.dyn, e.key);
    if (next) { this.dyn = next; e.preventDefault(); this.ctx.render(); }
  }
  deactivate() { this.start = null; this.snap = null; this.ctx.setPreview(); }
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
  private snapRes: SnapResult | null = null;
  constructor(private ctx: ToolCtx) {}

  private snap(p: PointerInfo): Vec {
    if (this.ctx.snapEnabled) {
      const walls = this.ctx.doc.objects.filter(o => o.kind === 'wall') as unknown as WallSeg[];
      const s = computeSnap(walls, p.world, JOIN_PX / this.ctx.vp.scale, { excludeId: this.wallId ?? undefined });
      if (s) { this.snapRes = s; return s.point; }
    }
    this.snapRes = null;
    if (this.a && !this.wallId) return (this.ctx.snapEnabled || p.shift) ? alignWallEnd(this.a, p.snapped, this.ctx.gridSize, p.shift) : p.snapped;
    return p.snapped;
  }

  onDown(p: PointerInfo) {
    if (this.wallId) { this.a = this.b; this.wallId = null; this.b = null; this.snapRes = null; return; }   // confirm arc, chain on
    const end = placePoint(this.snap(p), this.snapRes);   // this.snap() sets this.snapRes
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
    const s = this.a, e = this.snap(p), snap = this.snapRes;
    this.ctx.setPreview(
      ctx => { if (!s) return; ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = WALL_THICKNESS; ctx.globalAlpha = 0.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.globalAlpha = 1; },
      ctx => {
        if (s) { const m = this.ctx.vp.toScreen({ x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }); ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#4c8dff'; ctx.fillText(fmtLen(dist(s, e)), m.x, m.y - 6); }
        if (snap) drawSnap(ctx, this.ctx.vp, snap);
      },
    );
    this.ctx.render();
  }

  onUp() {}
  onKey(e: KeyboardEvent) { if (e.key === 'Escape') this.reset(); }
  deactivate() { this.reset(); }
  private reset() { this.a = null; this.wallId = null; this.b = null; this.snapRes = null; this.ctx.setPreview(); this.ctx.render(); }
}

// Beam: click endpoints (chains). Snaps to wall endpoints and axes.
const BEAM_WIDTH = 20, BEAM_HEIGHT = 40, BEAM_ELEV = 230;   // cm (underside near a 270 ceiling)
export class BeamTool implements Tool {
  name = 'beam'; cursor = 'crosshair';
  hint = '點擊放置樑的端點；自動貼合牆體，近水平/垂直對齊格線；Esc 結束';
  private start: Vec | null = null;
  private snap: SnapResult | null = null;
  constructor(private ctx: ToolCtx) {}

  private end(p: PointerInfo): Vec {
    if (this.ctx.snapEnabled) {
      const walls = this.ctx.doc.objects.filter(o => o.kind === 'wall') as unknown as WallSeg[];
      const s = computeSnap(walls, p.world, JOIN_PX / this.ctx.vp.scale);
      if (s) { this.snap = s; return s.point; }
    }
    this.snap = null;
    if (!this.start) return p.snapped;
    return (this.ctx.snapEnabled || p.shift) ? alignWallEnd(this.start, p.snapped, this.ctx.gridSize, p.shift) : p.snapped;
  }

  onDown(p: PointerInfo) {
    const end = placePoint(this.end(p), this.snap);   // this.end() sets this.snap
    if (!this.start) { this.start = end; return; }
    if (dist(this.start, end) < 1) return;
    this.ctx.doc.ensureLayer('beams', '樑', '#b07de0', 2);
    this.ctx.doc.commit();
    this.ctx.doc.add({ id: genId('beam'), kind: 'beam', layer: layerForKind('beam'), a: this.start, b: end, width: BEAM_WIDTH, height: BEAM_HEIGHT, elevation: BEAM_ELEV });
    this.start = end;
  }
  onMove(p: PointerInfo) {
    const e = this.end(p), s = this.start, snap = this.snap;
    this.ctx.setPreview(
      ctx => {
        if (!s) return;
        ctx.strokeStyle = '#b07de0'; ctx.lineWidth = BEAM_WIDTH; ctx.globalAlpha = 0.35; ctx.setLineDash([16 / this.ctx.vp.scale, 10 / this.ctx.vp.scale]);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      },
      ctx => {
        if (s) { const m = this.ctx.vp.toScreen({ x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }); ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#b07de0'; ctx.fillText(fmtLen(dist(s, e)), m.x, m.y - 6); }
        if (snap) drawSnap(ctx, this.ctx.vp, snap);
      },
    );
    this.ctx.render();
  }
  onUp() {}
  onKey(e: KeyboardEvent) { if (e.key === 'Escape') { this.start = null; this.snap = null; this.ctx.setPreview(); this.ctx.render(); } }
  deactivate() { this.start = null; this.snap = null; this.ctx.setPreview(); }
}

/**
 * Chain partition lines the way walls are chained.
 *
 * Endpoints snap onto walls, because a partition that stops a few centimetres
 * short of the wall it was meant to meet does not close the region — and the
 * only symptom is that the new room never appears. Nothing else about it says
 * anything is wrong, which is why the snap matters more here than it does for a
 * wall you can see the thickness of.
 */
export class PartitionTool implements Tool {
  name = 'partition'; cursor = 'crosshair';
  hint = '點擊放置隔間線的端點；它只在平面上分割區域（不蓋東西、3D 不出現）；端點會貼合牆體；Esc 結束';
  private start: Vec | null = null;
  private snap: SnapResult | null = null;
  constructor(private ctx: ToolCtx) {}

  private end(p: PointerInfo): Vec {
    if (this.ctx.snapEnabled) {
      const walls = this.ctx.doc.objects.filter(o => o.kind === 'wall' || o.kind === 'partition') as unknown as WallSeg[];
      const s = computeSnap(walls, p.world, JOIN_PX / this.ctx.vp.scale);
      if (s) { this.snap = s; return s.point; }
    }
    this.snap = null;
    if (!this.start) return p.snapped;
    return (this.ctx.snapEnabled || p.shift) ? alignWallEnd(this.start, p.snapped, this.ctx.gridSize, p.shift) : p.snapped;
  }

  onDown(p: PointerInfo) {
    const end = placePoint(this.end(p), this.snap);
    if (!this.start) { this.start = end; return; }
    if (dist(this.start, end) < 1) return;
    this.ctx.doc.commit();
    this.ctx.doc.add({ id: genId('partition'), kind: 'partition', layer: layerForKind('partition'), a: this.start, b: end });
    this.start = end;
  }
  onMove(p: PointerInfo) {
    const e = this.end(p), s = this.start, snap = this.snap;
    this.ctx.setPreview(
      ctx => {
        if (!s) return;
        ctx.strokeStyle = '#6d7890'; ctx.lineWidth = 1.5 / this.ctx.vp.scale;
        ctx.setLineDash([14 / this.ctx.vp.scale, 8 / this.ctx.vp.scale]);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.setLineDash([]);
      },
      ctx => {
        if (s) { const m = this.ctx.vp.toScreen({ x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }); ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#6d7890'; ctx.fillText(fmtLen(dist(s, e)), m.x, m.y - 6); }
        if (snap) drawSnap(ctx, this.ctx.vp, snap);
      },
    );
    this.ctx.render();
  }
  onUp() {}
  onKey(e: KeyboardEvent) { if (e.key === 'Escape') { this.start = null; this.snap = null; this.ctx.setPreview(); this.ctx.render(); } }
  deactivate() { this.start = null; this.snap = null; this.ctx.setPreview(); }
}

// Grab the canvas with the left mouse button to pan the view.

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
