import { material as materialDef } from './materials';
import { mark, done } from './perf';
import { Viewport } from './viewport';
import { Doc } from '../model/doc';
import { Obj, ObjKind, Vec } from '../model/schema';
import { FURNITURE_BY_ID } from '../data/furniture';
import { ELECTRICAL_SYMBOLS, QUIET_SYMBOLS, QUIET_ALPHA } from '../data/electrical';
import { isLightItem } from '../model/catalogue';
import { DEFAULT_CIRCUIT } from './lighting';
import { circuitColor } from './lightmap';
import { fmtLen, fmtArea, dist, angleDeg, sub, len, rotate, polygonArea, polygonCentroid, wallControl, closestOnSegment, wallCap, wallEndCounts, wallEndCaps } from './geometry';
import { handles } from './handles';
import { roomUse, isDefaultRoomName } from './roomUse';
import { layoutLabels, LABEL_PRIORITY, LabelBox, fitsInside, fitsAlong, turnedExtent } from './labelLayout';
import { quietInk, hatchShown, inkPitch, keepsLampInk, FURNITURE_LABEL, AREA_INK } from './planInk';
import { t } from './i18n';
import { furnitureCenter, bounds } from './hit';

export interface RenderOpts {
  world?: (ctx: CanvasRenderingContext2D) => void;   // preview in world (cm) space
  screen?: (ctx: CanvasRenderingContext2D) => void;   // preview in screen (px) space
  background?: string;   // canvas fill (default dark theme)
  grid?: boolean;        // draw grid (default true)
  selection?: boolean;   // draw selection handles (default true)
  mono?: boolean;        // monochrome plot theme (see monoContext)
  skipKinds?: ObjKind[]; // object kinds to leave out entirely (e.g. the underlay image when plotting)
  show?: (o: Obj) => boolean;   // the screen's 顯示 filter (core/viewFilter.ts); exports leave it out and draw everything
  lengths?: boolean;             // wall lengths and beam clearances (default true); 顯示 → 尺寸與標註 turns them off on screen
  heat?: (ctx: CanvasRenderingContext2D) => void;   // lighting overlay in world space, over floors, under everything built
  marker?: (ctx: CanvasRenderingContext2D) => void; // walk mode's "you are here", world space, over everything built
  roomUse?: boolean;     // name default rooms by their furniture and say what they lack (default true; exports pass false, B23)
  quiet?: boolean;       // the screen's quieter plan: grey furniture, small light rings, faint hatch dropped when crowded (default true; exports pass false, B25)
  declutter?: boolean;   // drop labels that would overlap better ones (default true; exports pass false — paper cannot zoom in, B24)
}

const INK = '#000000';
const PAPER = '#ffffff';

/**
 * Wrap a 2D context so it draws as black-on-white line art, without the
 * renderer or the 29 furniture draw() functions knowing anything about
 * plotting. The screen theme is light ink on a dark ground, so simply forcing
 * every colour to black floods the sheet — the room fill alone covers the whole
 * plan. Drawing code here follows one consistent shape:
 *
 *   fill()      = an object's body   → paper, so shapes read as outlines
 *   stroke()    = its outline        → ink  (walls are thick strokes, so they
 *                                     still come out as solid poché)
 *   fillText()  = a label            → ink, overriding the fill rule
 *
 * Reads and geometry pass through untouched.
 */
/** Split '#rrggbbaa' into the colour and its alpha suffix, if it has one. */
function splitAlpha(c: string): { hex: string; alpha: string } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(c.trim());
  return m ? { hex: '#' + m[1], alpha: m[2] } : { hex: c, alpha: '' };
}

/** Mix a hex colour towards white; used to derive an outline from a body colour. */
export function lighten(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Wrap a 2D context so a furniture pictogram draws in a chosen colour.
 *
 * Every catalogue item paints its body with fillStyle and its outline and
 * detail lines with strokeStyle, so recolouring at the context boundary tints
 * all 29 of them without any of them knowing. Alpha suffixes are preserved,
 * which is what keeps the lighter detail lines (#e0b45a88) reading as detail.
 */
export function tintContext(ctx: CanvasRenderingContext2D, color: string): CanvasRenderingContext2D {
  const outline = lighten(color, 0.45);
  const remap = (v: unknown, to: string): unknown => {
    if (typeof v !== 'string') return to;
    const { alpha } = splitAlpha(v);
    return alpha ? to + alpha : to;
  };
  return new Proxy(ctx, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) {
      if (k === 'fillStyle') return Reflect.set(t, k, remap(v, color), t);
      if (k === 'strokeStyle') return Reflect.set(t, k, remap(v, outline), t);
      return Reflect.set(t, k, v, t);
    },
  }) as CanvasRenderingContext2D;
}

/** Furniture on the screen plan: the pictograms' amber drawn in warm grey (B25, core/planInk). */
function quietContext(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  return new Proxy(ctx, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) {
      if (k === 'fillStyle' || k === 'strokeStyle') return Reflect.set(t, k, quietInk(v), t);
      return Reflect.set(t, k, v, t);
    },
  }) as CanvasRenderingContext2D;
}

export function monoContext(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  // Both traps use the real context as the receiver: the canvas accessors are
  // native and throw "Illegal invocation" if `this` is the proxy.
  return new Proxy(ctx, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (typeof v !== 'function') return v;
      if (k === 'fillText') {
        return (...args: unknown[]) => {
          const keep = t.fillStyle;
          t.fillStyle = INK;
          (v as Function).apply(t, args);
          t.fillStyle = keep;
        };
      }
      return v.bind(t);
    },
    set(t, k, v) {
      if (k === 'strokeStyle') return Reflect.set(t, k, INK, t);
      if (k === 'fillStyle') return Reflect.set(t, k, PAPER, t);
      return Reflect.set(t, k, v, t);
    },
  }) as CanvasRenderingContext2D;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  onImageLoad?: () => void;                 // re-render when an underlay image finishes loading
  private imgCache = new Map<string, HTMLImageElement>();
  private wallEnds = new Map<string, number>();   // per frame — which wall ends are corners
  private walls: Extract<Obj, { kind: 'wall' }>[] = [];   // per frame — for the dangling-end caps
  constructor(private canvas: HTMLCanvasElement, private vp: Viewport, private doc: Doc) {
    this.ctx = canvas.getContext('2d')!;
  }

  private getImg(src: string): HTMLImageElement | null {
    let img = this.imgCache.get(src);
    if (!img) { img = new Image(); img.onload = () => this.onImageLoad?.(); img.src = src; this.imgCache.set(src, img); }
    return img.complete && img.naturalWidth ? img : null;
  }

  private setWorld() {
    const s = this.vp.scale * this.vp.dpr;
    this.ctx.setTransform(s, 0, 0, s, -this.vp.origin.x * s, -this.vp.origin.y * s);
  }
  private setScreen() { this.ctx.setTransform(this.vp.dpr, 0, 0, this.vp.dpr, 0, 0); }

  render(opts: RenderOpts = {}) {
    const t0 = mark();
    const real = this.ctx;
    // Swap in the ink-remapping context before anything draws, so drawObject,
    // labelObject and every furniture draw() get it without knowing.
    this.monoInk = !!opts.mono;
    this.heatOn = !!opts.heat;
    this.roomHints = opts.roomUse !== false;
    this.quiet = opts.quiet !== false && !opts.mono;
    if (opts.mono) this.ctx = monoContext(real);
    try {
      this.renderInto(opts);
    } finally {
      this.ctx = real;
      done('render2d', t0);
    }
  }

  private renderInto(opts: RenderOpts) {
    const { ctx, vp } = this;
    const skip = opts.skipKinds?.length ? new Set<ObjKind>(opts.skipKinds) : null;
    const show = opts.show;
    const visible = (o: Obj) => (!skip || !skip.has(o.kind)) && (!show || show(o));

    // The background is paper, not ink, so it bypasses the mono remap.
    const bg = this.canvas.getContext('2d')!;
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.clearRect(0, 0, this.canvas.width, this.canvas.height);
    bg.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    bg.fillStyle = opts.background ?? '#171a20';
    bg.fillRect(0, 0, vp.width, vp.height);

    this.setWorld();
    if (opts.grid !== false) this.drawGrid();

    this.wallEnds = wallEndCounts(this.doc.objects);
    this.walls = this.doc.objects.filter((o): o is Extract<Obj, { kind: 'wall' }> => o.kind === 'wall');
    // objects grouped by layer order (index 0 = bottom), but the floor-like kinds
    // always go first, whatever layer they are on: they are what everything else
    // sits on.
    //
    // With the lighting overlay that is so it sits on the floor: over the underlay
    // and the room fills, which would otherwise wash it out or hide it, and under
    // the walls, furniture and fittings, which are what it is being read against.
    //
    // The room's name and area go under the lights but over the walls and
    // furniture (U6). A ceiling light dropped in the middle of a room lands
    // exactly where the label is, and with the label on top the light looked like
    // it had not been placed at all; but under the furniture, a bed at the room's
    // centroid would swallow the name — on screen and in the PDF.
    const floorish = (o: Obj) => o.kind === 'image' || o.kind === 'room';
    const fitting = (o: Obj) => o.kind === 'electrical';
    const pass = (want: (o: Obj) => boolean, draw: (o: Obj, color: string) => void) => {
      for (const layer of this.doc.project.layers) {
        if (!layer.visible) continue;
        for (const o of this.doc.objects) if (o.layer === layer.id && visible(o) && want(o)) draw(o, layer.color);
      }
    };
    const drawIt = (o: Obj, c: string) => this.drawObject(o, c);
    pass(floorish, drawIt);
    if (opts.heat) { ctx.save(); opts.heat(ctx); ctx.restore(); }
    pass(o => !floorish(o) && !fitting(o), drawIt);
    // B24: every label is measured first and laid out together, so a wall's
    // length can lose its spot to the room name it would cover even though the
    // two are drawn in different passes. Collected in the same order they draw.
    this.setScreen();
    this.labels = [];
    // An export is the same with or without a selection, so it promotes nothing.
    this.selectedSet = new Set(opts.selection === false ? [] : this.doc.selectedIds);
    this.declutter = opts.declutter !== false;
    this.lengths = opts.lengths !== false;
    pass(o => o.kind === 'room' || o.kind === 'area', o => this.labelObject(o, true));
    pass(o => o.kind !== 'room' && o.kind !== 'area', o => this.labelObject(o, false));
    const kept = !this.declutter ? new Set(this.labels.keys()) : layoutLabels(this.labels, { w: vp.width, h: vp.height });
    const drawLabels = (under: boolean) => this.labels.forEach((l, i) => { if (l.under === under && kept.has(i)) l.draw(); });
    drawLabels(true);
    this.setWorld();
    pass(fitting, drawIt);
    if (opts.world) { ctx.save(); opts.world(ctx); ctx.restore(); }
    if (opts.marker) { ctx.save(); opts.marker(ctx); ctx.restore(); }

    // labels + selection + previews in screen space
    this.setScreen();
    drawLabels(false);
    if (opts.selection !== false) { const sel = this.doc.selectedObjects.filter(visible); for (const s of sel) this.drawSelection(s, sel.length === 1); }
    if (opts.screen) { ctx.save(); opts.screen(ctx); ctx.restore(); }
  }

  private drawGrid() {
    const { ctx, vp } = this;
    const tl = vp.toWorld({ x: 0, y: 0 }), br = vp.toWorld({ x: vp.width, y: vp.height });
    const line = 1 / vp.scale;
    const draw = (step: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = line;
      ctx.beginPath();
      const x0 = Math.floor(tl.x / step) * step, y0 = Math.floor(tl.y / step) * step;
      for (let x = x0; x <= br.x; x += step) { ctx.moveTo(x, tl.y); ctx.lineTo(x, br.y); }
      for (let y = y0; y <= br.y; y += step) { ctx.moveTo(tl.x, y); ctx.lineTo(br.x, y); }
      ctx.stroke();
    };
    if (vp.scale > 0.25) draw(100, 'rgba(255,255,255,0.05)');   // 1m
    draw(500, 'rgba(255,255,255,0.11)');                        // 5m
  }

  /**
   * The plan hatch for a floor finish, as a canvas pattern.
   *
   * A pattern rather than drawn line work: the fill is one call whatever the
   * zoom, where hatching a room by looping over lines in world coordinates
   * costs more the further out you zoom — exactly when there are most rooms on
   * screen. `setTransform` maps the tile into world centimetres so the hatch
   * keeps a real-world scale instead of a fixed pixel one.
   *
   * Null for a plain colour fill, and for anything without a hatch.
   */
  private monoInk = false;
  private heatOn = false;
  private roomHints = true;
  private quiet = true;
  private hatchCache = new Map<string, CanvasPattern | null>();
  private hatchStep = new Map<string, number>();   // cm between a hatch's marks, measured off its tile (B25)
  private hatchFor(floor: string | undefined): CanvasPattern | null {
    if (floor && floor.startsWith('#')) return null;
    const def = materialDef(floor, 'floor');
    if (!def.hatch) return null;
    // A pattern is pixels, so the mono remap that rewrites every other colour
    // on the plot path cannot touch it — the ink has to be chosen here. The
    // editor draws on a near-black canvas and the plot on white paper, and
    // hatching in one ink for both means it is invisible in the other. It was:
    // the first version drew black on #171a20 and nothing showed up at all
    // except the densest cross-hatch.
    const ink = this.monoInk ? '#000' : '#dfe5f0';
    const key = def.id + ink + (this.quiet ? 'q' : '');
    let pat = this.hatchCache.get(key);
    if (pat === undefined) {
      const S = 64;
      const cv = document.createElement('canvas'); cv.width = cv.height = S;
      const c = cv.getContext('2d')!;
      // Faint enough to dimension over; on screen fainter still (B25: at 0.30 the
      // planks read as zebra stripes over every room).
      c.globalAlpha = this.monoInk ? 0.5 : this.quiet ? 0.15 : 0.30;
      c.fillStyle = c.strokeStyle = ink;
      // The material draws in whatever colour it likes; overriding both here
      // after the fact would not work, so materials draw in black and this
      // recolours the result.
      def.hatch(c, S);
      const cm = def.hatchCm ?? def.tileCm;
      this.hatchStep.set(key, inkPitch(c.getImageData(0, 0, S, S).data.filter((_, i) => i % 4 === 3), S, 8) / S * cm);
      c.globalCompositeOperation = 'source-in';
      c.globalAlpha = 1;
      c.fillStyle = ink;
      c.fillRect(0, 0, S, S);
      c.globalCompositeOperation = 'source-over';
      pat = this.ctx.createPattern(cv, 'repeat');
      if (pat) {
        pat.setTransform(new DOMMatrix().scaleSelf(cm / S));
      }
      this.hatchCache.set(key, pat);
    }
    // The plot keeps its hatch at any scale; the screen drops it once the marks
    // crowd closer than a few pixels, and the room's tint carries on alone.
    if (this.quiet && !hatchShown(this.hatchStep.get(key) ?? 0, this.vp.scale)) return null;
    return pat;
  }

  private drawObject(o: Obj, color: string) {
    const { ctx, vp } = this;
    const line = 1 / vp.scale;
    switch (o.kind) {
      case 'image': {
        const img = this.getImg(o.src);
        if (img) { ctx.save(); ctx.globalAlpha = o.opacity ?? 1; ctx.drawImage(img, o.x, o.y, o.w, o.h); ctx.restore(); }
        else { ctx.strokeStyle = color; ctx.lineWidth = line; ctx.strokeRect(o.x, o.y, o.w, o.h); }
        break;
      }
      case 'room': {
        // The room outline, then the finish hatch inside it, so the plan says
        // what the floor is without having to open the 3D view.
        const trace = () => {
          if (o.poly && o.poly.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(o.poly[0].x, o.poly[0].y);
            for (let i = 1; i < o.poly.length; i++) ctx.lineTo(o.poly[i].x, o.poly[i].y);
            ctx.closePath();
          } else {
            ctx.beginPath();
            ctx.rect(o.x, o.y, o.w, o.h);
          }
        };
        ctx.fillStyle = 'rgba(76,141,255,0.06)';
        trace(); ctx.fill();
        const pat = this.hatchFor(o.floor);
        if (pat) { ctx.save(); ctx.fillStyle = pat; trace(); ctx.fill(); ctx.restore(); }
        ctx.strokeStyle = color; ctx.lineWidth = 2 * line;
        trace(); ctx.stroke();
        break;
      }
      case 'area': {
        // Dotted and unfilled, so it reads as a note on the room rather than a
        // second room: it divides nothing but the lighting table.
        ctx.strokeStyle = this.quiet ? AREA_INK : '#ffd166'; ctx.lineWidth = 1.5 * line;
        ctx.setLineDash([4 * line, 5 * line]);
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.setLineDash([]);
        break;
      }
      case 'partition': {
        // Dashed and thin, and deliberately not wall-coloured: a partition is a
        // line on a drawing, not something anyone builds. Drawn like a wall it
        // would be quoted like one.
        ctx.strokeStyle = color; ctx.lineWidth = 1.5 * line;
        ctx.setLineDash([14 * line, 8 * line]);
        ctx.beginPath(); ctx.moveTo(o.a.x, o.a.y); ctx.lineTo(o.b.x, o.b.y); ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'beam': {
        const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y, L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L * o.width / 2, ny = dx / L * o.width / 2;
        ctx.beginPath();
        ctx.moveTo(o.a.x + nx, o.a.y + ny); ctx.lineTo(o.b.x + nx, o.b.y + ny);
        ctx.lineTo(o.b.x - nx, o.b.y - ny); ctx.lineTo(o.a.x - nx, o.a.y - ny); ctx.closePath();
        ctx.fillStyle = 'rgba(176,125,224,0.12)'; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = line; ctx.setLineDash([16 * line, 10 * line]);   // dashed = overhead
        ctx.stroke(); ctx.setLineDash([]);
        break;
      }
      case 'wall': {
        const trace = () => {
          ctx.beginPath(); ctx.moveTo(o.a.x, o.a.y);
          if (o.bulge) { const c = wallControl(o.a, o.b, o.bulge); ctx.quadraticCurveTo(c.x, c.y, o.b.x, o.b.y); }
          else ctx.lineTo(o.b.x, o.b.y);
        };
        // Square ends, not round. A wall is a rectangle on a plan; a rounded cap
        // turns a short thick one — a column — into a capsule, and makes every
        // junction read as a blob rather than a corner. `square` extends the
        // stroke by half its width at each end, which is exactly the overlap two
        // perpendicular walls of the same thickness need to close their corner.
        //
        // Except a free-standing column — see `wallCap`.
        ctx.lineCap = wallCap(o, this.wallEnds);
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = o.color ?? color; ctx.lineWidth = o.thickness; trace(); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = line; trace(); ctx.stroke();
        ctx.lineCap = 'butt';
        // 懸空的端點補一條封口細線，看得出牆在這裡結束（U8）。往牆裡縮 3px，外側留一條
        // 牆色：貼在端面上的話深色線會跟深色畫布融在一起，看起來只是牆短了一點。
        const caps = wallEndCaps(o, this.walls, this.wallEnds);
        if (caps.length) {
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5 * line;
          ctx.beginPath();
          for (const [p, q] of caps) {
            const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
            const cx = o.a.x + o.b.x - 2 * mx, cy = o.a.y + o.b.y - 2 * my;   // roughly back toward the wall
            const k = 3 * line / (Math.hypot(cx, cy) || 1);
            ctx.moveTo(p.x + cx * k, p.y + cy * k); ctx.lineTo(q.x + cx * k, q.y + cy * k);
          }
          ctx.stroke();
        }
        break;
      }
      case 'door': case 'window': {
        ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.angle * Math.PI / 180);
        const hw = o.width / 2, w = o.width, style = o.style || 'single';
        if (o.kind === 'door') {
          ctx.strokeStyle = '#171a20'; ctx.lineWidth = 3 * line;
          ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0); ctx.stroke();               // threshold gap
          // The leaf is drawn once, hung on the left and opening back, then
          // mirrored into whichever of the four hands this door actually is.
          // Drawing four variants by hand is four places to get an arc wrong.
          ctx.save();
          if (o.hinge === 'right') ctx.scale(-1, 1);
          if (o.swing === 'out') ctx.scale(1, -1);
          ctx.strokeStyle = color; ctx.lineWidth = 2 * line;
          if (style === 'double') {                                                           // two leaves meeting in the middle
            ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(-hw, -hw); ctx.stroke();
            ctx.beginPath(); ctx.arc(-hw, 0, hw, -Math.PI / 2, 0); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(hw, 0); ctx.lineTo(hw, -hw); ctx.stroke();
            ctx.beginPath(); ctx.arc(hw, 0, hw, -Math.PI, -Math.PI / 2); ctx.stroke();
          } else if (style === 'sliding') {                                                   // two overlapping panels along the wall
            ctx.beginPath(); ctx.moveTo(-hw, -3 * line); ctx.lineTo(3 * line, -3 * line); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-3 * line, 3 * line); ctx.lineTo(hw, 3 * line); ctx.stroke();
          } else {                                                                            // single / glass — hinged leaf + swing
            if (style === 'glass') ctx.setLineDash([8 * line, 5 * line]);
            ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(-hw, -w); ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(-hw, 0, w, -Math.PI / 2, 0); ctx.stroke();
          }
          ctx.restore();
        } else {
          const bulge = o.bulge || 0;   // curved windows arc to match the wall
          const arc = (off: number) => { ctx.beginPath(); ctx.moveTo(-hw, off); if (bulge) ctx.quadraticCurveTo(0, 2 * bulge + off, hw, off); else ctx.lineTo(hw, off); ctx.stroke(); };
          ctx.strokeStyle = '#171a20'; ctx.lineWidth = 4 * line; arc(0);
          ctx.strokeStyle = color; ctx.lineWidth = 1.5 * line;
          if (style === 'picture') { arc(-3.5); arc(3.5); }                                   // single fixed pane
          else { arc(-3); arc(3); }
          // sash divisions
          ctx.lineWidth = 1 * line;
          if (style === 'sliding') { ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, 3); ctx.stroke(); }          // meeting rail
          else if (style === 'casement') { ctx.beginPath(); ctx.moveTo(0, -3.5); ctx.lineTo(0, 3.5); ctx.stroke(); } // centre mullion
          else if (style === 'single') { for (const mx of [-w / 3, 0, w / 3]) { ctx.beginPath(); ctx.moveTo(mx, -3); ctx.lineTo(mx, 3); ctx.stroke(); } }  // muntins
        }
        ctx.restore();
        break;
      }
      case 'furniture': {
        const item = FURNITURE_BY_ID[o.item];
        const c = furnitureCenter(o);
        ctx.save();
        ctx.translate(c.x, c.y); ctx.rotate(o.angle * Math.PI / 180); ctx.translate(-o.w / 2, -o.h / 2);
        // A custom colour is applied at the context boundary so the catalogue's
        // draw() functions stay unaware of it.
        // Otherwise, on screen, the amber the pictograms draw in becomes grey so
        // only the lights stay yellow (B25) — lamps from the furniture catalogue
        // are lights too and keep theirs; the plot has its own ink already.
        if (item) item.draw(o.color ? tintContext(ctx, o.color) : this.quiet && !keepsLampInk(item) ? quietContext(ctx) : ctx, o.w, o.h);
        else { ctx.fillStyle = '#3a4150'; ctx.strokeStyle = this.quiet ? quietInk(color) as string : color; ctx.lineWidth = 2; ctx.fillRect(0, 0, o.w, o.h); ctx.strokeRect(0, 0, o.w, o.h); }
        ctx.restore();
        break;
      }
      case 'electrical': {
        const sym = ELECTRICAL_SYMBOLS[o.item];
        if (!sym) break;
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(o.angle * Math.PI / 180);
        ctx.lineCap = 'round';
        // Over the lighting overlay a light takes its switch group's colour —
        // the same chip the panel's circuit list shows — on a dark halo, since
        // the layer colour is a yellow that vanishes into a lit room.
        const lit = this.heatOn && isLightItem(o.item);
        if (lit) {
          ctx.strokeStyle = ctx.fillStyle = '#0e1218'; ctx.lineWidth = 6;
          sym(ctx, o);
          color = circuitColor(o.circuit ?? DEFAULT_CIRCUIT);
        }
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.lineWidth = 2;
        // B25: 57 solid yellow dots and 21 bars were the loudest thing on the A1
        // plan, sitting on the room names. On screen they take their quiet forms;
        // the plot and the lighting overlay keep the full symbols.
        const q = !lit && this.quiet ? QUIET_SYMBOLS[o.item] : undefined;
        if (q) { ctx.globalAlpha = QUIET_ALPHA[o.item] ?? 1; q(ctx, o); }
        else sym(ctx, o);
        ctx.restore();
        break;
      }
      case 'dimension': this.drawDimensionWorld(o, color); break;
    }
  }

  private drawDimensionWorld(o: Extract<Obj, { kind: 'dimension' }>, color: string) {
    const { ctx, vp } = this;
    const line = 1 / vp.scale;
    const d = sub(o.b, o.a); const L = len(d) || 1;
    const n = { x: -d.y / L, y: d.x / L };            // perpendicular
    const oa = { x: o.a.x + n.x * o.offset, y: o.a.y + n.y * o.offset };
    const ob = { x: o.b.x + n.x * o.offset, y: o.b.y + n.y * o.offset };
    ctx.strokeStyle = color; ctx.lineWidth = line;
    ctx.beginPath();
    ctx.moveTo(o.a.x, o.a.y); ctx.lineTo(oa.x, oa.y);  // extension a
    ctx.moveTo(o.b.x, o.b.y); ctx.lineTo(ob.x, ob.y);  // extension b
    ctx.moveTo(oa.x, oa.y); ctx.lineTo(ob.x, ob.y);    // dim line
    ctx.stroke();
    this.arrow(oa, ob); this.arrow(ob, oa);
  }
  private arrow(from: Vec, to: Vec) {
    const { ctx, vp } = this; const a = 12 / vp.scale;
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x + Math.cos(ang - 0.4) * a, from.y + Math.sin(ang - 0.4) * a);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x + Math.cos(ang + 0.4) * a, from.y + Math.sin(ang + 0.4) * a);
    ctx.stroke();
  }

  /**
   * Queue one label: measured now, drawn later only if `layoutLabels` keeps it.
   * The box is the dark backing rectangle, which is what has to stay clear.
   */
  private text(worldPos: Vec, str: string, color = '#dbe0ea', size = 12, priority: number = LABEL_PRIORITY.wall,
    fits?: (box: { w: number; h: number }) => boolean) {
    if (!str) return;
    const { ctx, vp } = this;
    const s = vp.toScreen(worldPos);
    const font = `${size}px ui-monospace, monospace`;
    ctx.font = font;
    const w = ctx.measureText(str).width;
    const box = { x: s.x - w / 2 - 4, y: s.y - 9, w: w + 8, h: 18 };
    // B26: on screen, a label its object is too small to carry is not drawn
    // (unless selected). Paper cannot zoom, so exports keep them all.
    const selected = this.selectedSet.has(this.labelOwner);
    if (fits && this.declutter && !selected && !fits(box)) return;
    this.labels.push({
      ...box, under: this.labelUnder,
      priority: selected ? LABEL_PRIORITY.selected : priority,
      draw: () => {
        ctx.font = font;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(10,12,16,0.8)';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = color;
        ctx.fillText(str, s.x, s.y);
      },
    });
  }
  private labels: (LabelBox & { under: boolean; draw: () => void })[] = [];
  private selectedSet = new Set<string>();
  private labelOwner = '';
  private labelUnder = false;
  private declutter = true;
  private lengths = true;

  private labelObject(o: Obj, under: boolean) {
    this.labelOwner = o.id; this.labelUnder = under;
    const P = LABEL_PRIORITY;
    switch (o.kind) {
      case 'wall': {
        if (!this.lengths) break;
        const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
        const px = dist(o.a, o.b) * this.vp.scale;
        this.text(mid, fmtLen(dist(o.a, o.b)), '#c9cfdb', 12, P.wall, b => fitsAlong(b.w, px));
        break;
      }
      case 'beam': {
        if (!this.lengths) break;
        const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
        const px = dist(o.a, o.b) * this.vp.scale;
        this.text(mid, `↥${fmtLen(o.elevation)}`, '#c9a8ea', 12, P.wall, b => fitsAlong(b.w, px));   // underside clearance off the floor
        break;
      }
      case 'door': case 'window':
        // 兩側剩餘牆長**不畫在圖上**。它們曾經是門窗兩側各一個綠色數字，但那是
        // 一道牆上最擁擠的地方——門本身、牆、尺寸鏈、吸附輔助線都擠在那裡，而且
        // 兩個數字的位置正好落在牆段中點，也就是中點吸附記號的位置上。
        // 同樣兩個值在右側屬性面板是「左側牆長／右側牆長」，而且在那裡是**可以改
        // 的**，不只是可以看的。同一份資訊放在能編輯它的地方，比放在最擠的地方好。
        break;
      case 'room': {
        const poly = o.poly && o.poly.length >= 3 ? o.poly : null;
        const c = poly ? polygonCentroid(poly) : { x: o.x + o.w / 2, y: o.y + o.h / 2 };
        const area = poly ? polygonArea(poly) : o.w * o.h;
        // B23: a default-named room shows what its furniture makes it, and an
        // amber line under the name lists what it still lacks. Screen only — an
        // export or a plot keeps the saved name, like the area report does.
        const reading = this.roomHints ? roomUse(o, this.doc.objects) : null;
        const name = reading ? (isDefaultRoomName(o.name) && reading.use ? t(reading.use) : o.name || '房間') : o.name || '房間';
        const lack = reading?.use && reading.missing.length ? t('缺：') + reading.missing.map(t).join(t('、')) : '';
        const k = 1 / this.vp.scale;
        if (lack) {
          this.text({ x: c.x, y: c.y - 18 * k }, name, '#dbe0ea', 13, P.roomName);
          this.text({ x: c.x, y: c.y }, lack, '#ffb347', 11, P.missing);
          this.text({ x: c.x, y: c.y + 18 * k }, fmtArea(area), '#8b93a3', 12, P.area);
        } else {
          this.text({ x: c.x, y: c.y - 12 * k }, name, '#dbe0ea', 13, P.roomName);
          this.text({ x: c.x, y: c.y + 12 * k }, fmtArea(area), '#8b93a3', 12, P.area);
        }
        break;
      }
      case 'area': {
        // Along its top edge, out of the way of the room's own name at the room's centre.
        this.text({ x: o.x + o.w / 2, y: o.y + 14 / this.vp.scale }, o.name || '子區域', this.quiet ? AREA_INK : '#ffd166', 11, P.roomName);
        break;
      }
      case 'dimension': {
        const d = sub(o.b, o.a); const L = len(d) || 1;
        const n = { x: -d.y / L, y: d.x / L };
        const mid = { x: (o.a.x + o.b.x) / 2 + n.x * o.offset, y: (o.a.y + o.b.y) / 2 + n.y * o.offset };
        this.text(mid, fmtLen(dist(o.a, o.b)), '#8bffb0', 12, P.measure);
        break;
      }
      case 'furniture': {
        const c = furnitureCenter(o);
        // The object's own label wins over the catalogue's generic name. Placing
        // from the palette sets no label, so those still read 衣櫃 / 冰箱; but a
        // piece traced off a drawing carries the drawing's name — 系統開放衣櫃 4抽,
        // 汙衣櫃 — and that is the whole reason it was written down.
        // The label is turned into the piece's own frame and compared with its
        // real size: a thin shelf set at 45° has a big square bounding box, but
        // its name still does not fit on it.
        const own = { w: o.w * this.vp.scale, h: o.h * this.vp.scale };
        this.text(c, o.label || FURNITURE_BY_ID[o.item]?.name || '', this.quiet ? FURNITURE_LABEL : '#e0b45a', 11, P.furniture,
          b => fitsInside(turnedExtent(b.w, b.h, o.angle), own));
        break;
      }
    }
  }

  private drawSelection(o: Obj, withHandles = true) {
    const { ctx, vp } = this;
    ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1.5;
    // outline
    if (o.kind === 'furniture') {
      const c = furnitureCenter(o);
      const pts = [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }]
        .map(p => vp.toScreen(rotate(p, c, o.angle)));
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    } else if (o.kind === 'room' || !withHandles) {   // rooms always; walls/openings/dims when multi-selected
      const b = bounds(o);
      const a = vp.toScreen({ x: b.x, y: b.y }), c = vp.toScreen({ x: b.x + b.w, y: b.y + b.h });
      ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
    }
    // handles (single selection only)
    if (!withHandles) return;
    for (const h of handles(o)) {
      const s = vp.toScreen(h.pos);
      if (h.kind === 'rotate') {
        ctx.fillStyle = '#4c8dff'; ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill();
      } else if (h.kind === 'curve') {   // curvature handle — orange dot (drag to bend the wall)
        ctx.fillStyle = '#e0b45a'; ctx.strokeStyle = '#171a20'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1.5;
        ctx.fillRect(s.x - 4, s.y - 4, 8, 8); ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
      }
    }
  }
}
