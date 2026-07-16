import { Tool, ToolCtx, PointerInfo } from './types';
import { genId, Doc } from '../model/doc';
import { layerForKind, Vec } from '../model/types';
import { closestOnSegment, angleDeg, dist, arcOpening, wallControl } from '../core/geometry';
import { FURNITURE_BY_ID } from '../data/furniture';

const WALL_SNAP = 40; // cm — how close to a wall to snap an opening onto it

export type OpeningFit = { pos: Vec; angle: number; width: number; bulge: number };

// Fit an opening of `width` onto the nearest wall within `threshold` cm of the
// cursor: returns the snap position, the wall's tangent angle, the (possibly
// chord-) width, and the curvature for windows on curved walls. null = no wall.
export function fitOpeningToWall(doc: Doc, cursor: Vec, width: number, isWindow: boolean, threshold = WALL_SNAP): OpeningFit | null {
  let best: OpeningFit | null = null; let bestD = threshold;
  for (const o of doc.objects) {
    if (o.kind !== 'wall' || !doc.isLayerVisible(o.layer)) continue;
    if (o.bulge) {
      const r = arcOpening(o.a, wallControl(o.a, o.b, o.bulge), o.b, cursor, width);   // windows bow to the wall; doors stay flat
      if (r.dist < bestD) { bestD = r.dist; best = { pos: r.pos, angle: r.angle, width: r.width, bulge: isWindow ? r.bulge : 0 }; }
    } else {
      const { point } = closestOnSegment(cursor, o.a, o.b);
      const d = dist(cursor, point);
      if (d < bestD) { bestD = d; best = { pos: point, angle: angleDeg(o.a, o.b), width, bulge: 0 }; }
    }
  }
  return best;
}

// Place a door or window. Snaps onto the nearest wall (position + angle), and
// follows the wall's curvature — a window on a curved wall becomes a curved window.
export class OpeningTool implements Tool {
  cursor = 'crosshair';
  private cand: OpeningFit | null = null;
  constructor(private ctx: ToolCtx, public kind: 'door' | 'window') {
    this.name = kind; this.hint = kind === 'door' ? '在牆上點擊放置門' : '在牆上點擊放置窗（可貼合彎曲牆體）';
  }
  name: string; hint: string;

  private width() { return this.kind === 'door' ? 90 : 120; }

  private findWall(p: Vec): OpeningFit {
    return fitOpeningToWall(this.ctx.doc, p, this.width(), this.kind === 'window') ?? { pos: p, angle: 0, width: this.width(), bulge: 0 };
  }

  onMove(p: PointerInfo) {
    this.cand = this.findWall(p.snapped);
    const c = this.cand, hw = c.width / 2;
    this.ctx.setPreview(ctx => {
      ctx.save(); ctx.translate(c.pos.x, c.pos.y); ctx.rotate(c.angle * Math.PI / 180);
      ctx.strokeStyle = '#7bc6ff'; ctx.globalAlpha = 0.7; ctx.lineWidth = 6 / this.ctx.vp.scale;
      ctx.beginPath(); ctx.moveTo(-hw, 0);
      if (c.bulge) ctx.quadraticCurveTo(0, 2 * c.bulge, hw, 0); else ctx.lineTo(hw, 0);
      ctx.stroke(); ctx.globalAlpha = 1; ctx.restore();
    });
    this.ctx.render();
  }
  onDown(p: PointerInfo) {
    const c = this.cand ?? this.findWall(p.snapped);
    this.ctx.doc.commit();
    const id = genId(this.kind);
    this.ctx.doc.add({ id, kind: this.kind, layer: layerForKind(this.kind), x: c.pos.x, y: c.pos.y, width: c.width, angle: c.angle, bulge: c.bulge || undefined });
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
