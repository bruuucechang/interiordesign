import { Tool, ToolCtx, PointerInfo } from './types';
import { genId, Doc } from '../model/doc';
import { layerForKind, Vec } from '../model/types';
import { closestOnSegment, angleDeg, dist, fmtLen, arcOpening, arcSpan, wallControl } from '../core/geometry';
import { FURNITURE_BY_ID } from '../data/furniture';

const WALL_SNAP = 40; // cm — how close to a wall to snap an opening onto it

// left/right = wall remaining on each side of the opening (cm); *At = label anchors.
export type OpeningFit = { pos: Vec; angle: number; width: number; bulge: number; left?: number; right?: number; leftAt?: Vec; rightAt?: Vec };

// Fit an opening of `width` onto the nearest wall within `threshold` cm of the
// cursor: returns the snap position, the wall's tangent angle, the (possibly
// chord-) width, and the curvature for windows on curved walls. null = no wall.
// `span` (a fixed endpoint + the dragged one) is passed while resizing so the
// opening is fit between those two points along the wall — otherwise the opening
// is fit centered on `cursor` with the given `width`.
export function fitOpeningToWall(doc: Doc, cursor: Vec, width: number, isWindow: boolean, threshold = WALL_SNAP, span?: { p0: Vec; p1: Vec }): OpeningFit | null {
  let best: OpeningFit | null = null; let bestD = threshold;
  for (const o of doc.objects) {
    if (o.kind !== 'wall' || !doc.isLayerVisible(o.layer)) continue;
    if (o.bulge) {
      const c = wallControl(o.a, o.b, o.bulge);
      const r = span ? arcSpan(o.a, c, o.b, span.p0, span.p1) : arcOpening(o.a, c, o.b, cursor, width);   // windows bow to the wall; doors stay flat
      if (r.dist < bestD) { bestD = r.dist; best = { pos: r.pos, angle: r.angle, width: r.width, bulge: isWindow ? r.bulge : 0 }; }
    } else {
      const cs = closestOnSegment(cursor, o.a, o.b);
      const d = dist(cursor, cs.point);
      if (d < bestD) {
        bestD = d;
        const L = dist(o.a, o.b), dc = cs.t * L, hw = width / 2;
        const ux = L > 1e-6 ? (o.b.x - o.a.x) / L : 1, uy = L > 1e-6 ? (o.b.y - o.a.y) / L : 0;
        const near = { x: o.a.x + ux * (dc - hw), y: o.a.y + uy * (dc - hw) };
        const far = { x: o.a.x + ux * (dc + hw), y: o.a.y + uy * (dc + hw) };
        best = {
          pos: cs.point, angle: angleDeg(o.a, o.b), width, bulge: 0,
          left: Math.max(0, dc - hw), right: Math.max(0, L - dc - hw),
          leftAt: { x: (o.a.x + near.x) / 2, y: (o.a.y + near.y) / 2 },
          rightAt: { x: (far.x + o.b.x) / 2, y: (far.y + o.b.y) / 2 },
        };
      }
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
    this.ctx.setPreview(
      ctx => {
        ctx.save(); ctx.translate(c.pos.x, c.pos.y); ctx.rotate(c.angle * Math.PI / 180);
        ctx.strokeStyle = '#7bc6ff'; ctx.globalAlpha = 0.7; ctx.lineWidth = 6 / this.ctx.vp.scale;
        ctx.beginPath(); ctx.moveTo(-hw, 0);
        if (c.bulge) ctx.quadraticCurveTo(0, 2 * c.bulge, hw, 0); else ctx.lineTo(hw, 0);
        ctx.stroke(); ctx.globalAlpha = 1; ctx.restore();
      },
      ctx => {   // remaining wall on each side of the opening
        if (c.leftAt === undefined) return;
        ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tag = (at: Vec, txt: string) => {
          const s = this.ctx.vp.toScreen(at), w = ctx.measureText(txt).width + 10;
          ctx.fillStyle = 'rgba(10,12,16,0.85)'; ctx.fillRect(s.x - w / 2, s.y - 9, w, 18);
          ctx.fillStyle = '#8bffb0'; ctx.fillText(txt, s.x, s.y);
        };
        tag(c.leftAt, fmtLen(c.left!));
        tag(c.rightAt!, fmtLen(c.right!));
      },
    );
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
