import { Vec } from '../model/types';
import { dist, closestOnSegment } from './geometry';
import { Viewport } from './viewport';

// Smarter drawing snaps. On top of foolproof endpoint/segment joining, this adds
// wall MIDPOINTS, wall FACES (perpendicular projection), and ALIGNMENT tracking
// — when the cursor lines up horizontally or vertically with an existing wall
// endpoint, we lock that axis and draw a guide line. Two guides crossing snap to
// their intersection. Pure + viewport-free so it can be unit-tested; drawSnap()
// renders the marker/guides.

export type SnapKind = 'end' | 'mid' | 'seg' | 'align';

export interface SnapGuide { a: Vec; b: Vec; }        // world-space alignment guide

export interface SnapResult {
  point: Vec;
  kind: SnapKind;
  guides: SnapGuide[];
}

export interface WallSeg { id: string; a: Vec; b: Vec }

export interface SnapOpts {
  excludeId?: string;    // ignore this wall (the one being edited)
  midpoints?: boolean;   // snap to chord midpoints (default true)
  faces?: boolean;       // snap onto the wall line, T-junction style (default true)
  align?: boolean;       // horizontal/vertical alignment tracking (default true)
}

const mid = (w: WallSeg): Vec => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });

// Object snaps are ranked by distance minus a small bias, so a nearby endpoint
// still wins over an even-nearer face — endpoints/midpoints are the intentful
// picks. `radius` is the hard cutoff (world cm); bias only breaks near-ties.
export function computeSnap(walls: WallSeg[], p: Vec, radius: number, opts: SnapOpts = {}): SnapResult | null {
  const { excludeId, midpoints = true, faces = true, align = true } = opts;
  const active = walls.filter(w => w.id !== excludeId);

  const END_BIAS = radius * 0.45, MID_BIAS = radius * 0.25;
  type Cand = { point: Vec; kind: SnapKind; rank: number };
  const cands: Cand[] = [];
  const consider = (point: Vec, kind: SnapKind, bias: number) => {
    const d = dist(p, point);
    if (d <= radius) cands.push({ point: { x: point.x, y: point.y }, kind, rank: d - bias });
  };
  for (const w of active) {
    consider(w.a, 'end', END_BIAS);
    consider(w.b, 'end', END_BIAS);
    if (midpoints) consider(mid(w), 'mid', MID_BIAS);
    if (faces) consider(closestOnSegment(p, w.a, w.b).point, 'seg', 0);
  }
  if (cands.length) {
    const best = cands.reduce((a, b) => (b.rank < a.rank ? b : a));
    return { point: best.point, kind: best.kind, guides: [] };
  }

  // No hard object snap — try alignment tracking against endpoints.
  if (align) {
    let vx: { e: Vec; d: number } | null = null;   // endpoint whose x lines up (vertical guide)
    let hy: { e: Vec; d: number } | null = null;   // endpoint whose y lines up (horizontal guide)
    for (const w of active) for (const e of [w.a, w.b]) {
      const dx = Math.abs(p.x - e.x); if (dx < radius && (!vx || dx < vx.d)) vx = { e, d: dx };
      const dy = Math.abs(p.y - e.y); if (dy < radius && (!hy || dy < hy.d)) hy = { e, d: dy };
    }
    if (vx && hy) {
      const point = { x: vx.e.x, y: hy.e.y };
      return { point, kind: 'align', guides: [{ a: vx.e, b: point }, { a: hy.e, b: point }] };
    }
    if (vx) { const point = { x: vx.e.x, y: p.y }; return { point, kind: 'align', guides: [{ a: vx.e, b: point }] }; }
    if (hy) { const point = { x: p.x, y: hy.e.y }; return { point, kind: 'align', guides: [{ a: hy.e, b: point }] }; }
  }
  return null;
}

// Draw the snap marker (glyph per kind) and any alignment guides. Runs in the
// screen-space preview layer, so coordinates go through vp.toScreen.
export function drawSnap(ctx: CanvasRenderingContext2D, vp: Viewport, snap: SnapResult): void {
  for (const g of snap.guides) {
    const a = vp.toScreen(g.a), b = vp.toScreen(g.b);
    ctx.strokeStyle = '#f0a44c'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }
  const c = vp.toScreen(snap.point);
  ctx.lineWidth = 2;
  if (snap.kind === 'align') {
    ctx.strokeStyle = '#f0a44c';
    ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.stroke();
    return;
  }
  ctx.strokeStyle = '#5ad19a';
  if (snap.kind === 'mid') {                       // triangle for midpoints
    ctx.beginPath(); ctx.moveTo(c.x, c.y - 7); ctx.lineTo(c.x + 6, c.y + 5); ctx.lineTo(c.x - 6, c.y + 5); ctx.closePath(); ctx.stroke();
  } else if (snap.kind === 'seg') {                // diamond for a wall face
    ctx.beginPath(); ctx.moveTo(c.x, c.y - 7); ctx.lineTo(c.x + 7, c.y); ctx.lineTo(c.x, c.y + 7); ctx.lineTo(c.x - 7, c.y); ctx.closePath(); ctx.stroke();
  } else {                                         // ring for endpoints
    ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, Math.PI * 2); ctx.stroke();
  }
}
