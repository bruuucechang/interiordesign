import { Tool, ToolCtx, PointerInfo } from './types';
import { Obj, Vec } from '../model/schema';
import { calibrate, calibrationMessage, Rect } from '../core/calibrate';
import { fmtLen } from '../core/geometry';

/**
 * Drag a line along something whose real length is printed on the drawing, then
 * type that length. The underlay is resized so the two agree.
 *
 * The drag is deliberately **not** grid-snapped. The grid is in world
 * centimetres, and world centimetres are exactly what is wrong at this moment —
 * snapping the measurement to a scale that has not been established yet rounds
 * the input to the error being corrected.
 *
 * It also runs with the underlay layer still locked. Locking stops the image
 * being dragged by accident while tracing, which is the whole point of locking
 * it; this tool never moves the image by hand, it only rescales it, so there is
 * nothing to protect against here.
 */
export class CalibrateTool implements Tool {
  name = 'calibrate';
  cursor = 'crosshair';
  hint = '沿著圖上標有尺寸的一段拉一條線，放開後輸入它的實際長度';

  private from: Vec | null = null;
  private to: Vec | null = null;

  constructor(private ctx: ToolCtx) {}

  /** The underlay this is calibrating, or null when there is none to calibrate. */
  private image(): Extract<Obj, { kind: 'image' }> | null {
    const imgs = this.ctx.doc.objects.filter(o => o.kind === 'image');
    return (imgs[imgs.length - 1] as Extract<Obj, { kind: 'image' }> | undefined) ?? null;
  }

  onDown(p: PointerInfo) { this.from = p.world; this.to = p.world; }

  onMove(p: PointerInfo) {
    if (!this.from) return;
    this.to = p.world;
    const a = this.from, b = this.to;
    this.ctx.setPreview(
      ctx => {
        ctx.save();
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2 / this.ctx.vp.scale;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        // End ticks, so the two ends of the measurement are unambiguous against
        // a busy drawing.
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L * (7 / this.ctx.vp.scale), ny = dx / L * (7 / this.ctx.vp.scale);
        for (const q of [a, b]) {
          ctx.beginPath(); ctx.moveTo(q.x - nx, q.y - ny); ctx.lineTo(q.x + nx, q.y + ny); ctx.stroke();
        }
        ctx.restore();
      },
      ctx => {
        // The current reading, which is the number the user is about to correct.
        const s = this.ctx.vp.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const txt = `目前 ${fmtLen(Math.hypot(b.x - a.x, b.y - a.y))}`;
        ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(txt).width + 12;
        ctx.fillStyle = 'rgba(10,12,16,0.85)'; ctx.fillRect(s.x - w / 2, s.y - 22, w, 18);
        ctx.fillStyle = '#ffd166'; ctx.fillText(txt, s.x, s.y - 13);
      },
    );
    this.ctx.render();
  }

  onUp() {
    const a = this.from, b = this.to;
    this.from = this.to = null;
    this.ctx.setPreview();
    if (!a || !b) return;

    const img = this.image();
    if (!img) { this.ctx.onCalibrated?.('沒有底圖可以校正'); return; }

    const drawn = Math.hypot(b.x - a.x, b.y - a.y);
    const typed = prompt(
      `這一段在實際的房子裡有多長？（公分）\n\n目前這張底圖認為它是 ${fmtLen(drawn)}。`,
      String(Math.round(drawn)),
    );
    if (typed === null) { this.ctx.selectTool('select'); return; }   // cancelled

    const res = calibrate(img as unknown as Rect, a, b, Number(typed));
    if (typeof res === 'string') { this.ctx.onCalibrated?.(calibrationMessage(res)); return; }

    this.ctx.doc.commit();
    this.ctx.doc.update(img.id, { x: res.rect.x, y: res.rect.y, w: res.rect.w, h: res.rect.h } as Partial<Obj>);
    this.ctx.selectTool('select');
    this.ctx.onCalibrated?.(
      res.factor === 1
        ? '比例本來就是對的，底圖沒有變動'
        : `底圖已校正：${res.factor > 1 ? '放大' : '縮小'} ${res.factor.toFixed(3)} 倍，現在描出來就是真實尺寸`,
      true,
    );
  }

  deactivate() { this.from = this.to = null; this.ctx.setPreview(); }
}
