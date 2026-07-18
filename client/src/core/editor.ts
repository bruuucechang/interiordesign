import { Doc, genId } from '../model/doc';
import { Viewport } from './viewport';
import { Renderer } from './renderer';
import { snapPoint, rotate } from './geometry';
import { bounds, Bounds } from './hit';
import { Tool, ToolCtx, PointerInfo, DrawFn } from '../tools/types';
import { SelectTool } from '../tools/select';
import { WallTool, CurvedWallTool, BeamTool, RoomTool, DimensionTool, PanTool } from '../tools/draw';
import { OpeningTool, FurnitureTool } from '../tools/place';
import { FURNITURE_BY_ID } from '../data/furniture';
import { Obj, Vec, layerForKind } from '../model/types';

export class Editor implements ToolCtx {
  vp: Viewport;
  renderer: Renderer;
  tools: Record<string, Tool> = {};
  active!: Tool;
  currentFurniture = 'sofa';
  snapEnabled = true;
  gridSize = 10; // cm
  inputEnabled = true; // false while the 2D view is just the corner preview

  hooks: { toolChange?: (name: string) => void; zoom?: (pct: number) => void; export3d?: (name: string) => void } = {};

  private previewW?: DrawFn;
  private previewS?: DrawFn;
  private panning = false;
  private space = false;
  private lastPan: Vec = { x: 0, y: 0 };
  private panKeys = new Set<string>();   // WASD held keys for 2D view panning
  private panRaf = 0;
  private panShift = false;
  private clipboard: Obj[] = [];

  constructor(private canvas: HTMLCanvasElement, public doc: Doc, private hintEl: HTMLElement) {
    this.vp = new Viewport(canvas);
    this.renderer = new Renderer(canvas, this.vp, doc);
    this.renderer.onImageLoad = () => this.render();
    this.tools = {
      select: new SelectTool(this),
      pan: new PanTool(this),
      wall: new WallTool(this),
      wallCurve: new CurvedWallTool(this),
      beam: new BeamTool(this),
      room: new RoomTool(this),
      door: new OpeningTool(this, 'door'),
      window: new OpeningTool(this, 'window'),
      dimension: new DimensionTool(this),
      furniture: new FurnitureTool(this),
    };
    this.active = this.tools.select;

    this.vp.resize();
    this.vp.centerOn(0, 0, 800, 600);
    this.bindEvents();
    doc.onChange(() => this.render());
    this.render();
    this.setHint(this.active.hint);
  }

  // ---- ToolCtx ----
  render() {
    this.renderer.render({ world: this.previewW, screen: this.previewS });
  }
  setPreview(world?: DrawFn, screen?: DrawFn) { this.previewW = world; this.previewS = screen; }
  setHint(s: string) { this.hintEl.textContent = s; }
  selectTool(name: string) {
    if (!this.tools[name]) return;
    this.active.deactivate?.();
    this.setPreview();
    this.active = this.tools[name];
    this.canvas.style.cursor = this.active.cursor;
    this.setHint(this.active.hint);
    this.hooks.toolChange?.(name);
    this.render();
  }

  get toolName() { return this.active.name; }

  // Place the currently-selected furniture item centred at (x, y) world cm.
  // Used by the 3D view (floor-click placement); mirrors FurnitureTool.onDown.
  placeFurnitureAt(x: number, y: number): boolean {
    const item = FURNITURE_BY_ID[this.currentFurniture];
    if (!item) return false;
    this.doc.commit();
    const id = genId('furn');
    this.doc.add({ id, kind: 'furniture', layer: layerForKind('furniture'), item: item.id, x: x - item.w / 2, y: y - item.h / 2, w: item.w, h: item.h, angle: 0, label: item.name } as Obj);
    this.doc.select(id);
    this.selectTool('select');
    return true;
  }

  // Rotate the selected object(s) by `deg` degrees. Objects with an `angle`
  // (furniture, doors, windows) spin in place; a/b objects (walls, beams) rotate
  // their endpoints about their midpoint. Used by Q/E in the 3D view.
  rotateSelection(deg: number) {
    const sel = this.doc.selectedObjects;
    if (!sel.length) return;
    this.doc.commit();
    for (const o of sel) {
      if ('angle' in o) {
        this.doc.update(o.id, { angle: (((o.angle + deg) % 360) + 360) % 360 } as any);
      } else if ('a' in o && 'b' in o) {
        const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
        this.doc.update(o.id, { a: rotate(o.a, mid, deg), b: rotate(o.b, mid, deg) } as any);
      }
    }
  }

  // ---- events ----
  private pInfo(e: PointerEvent): PointerInfo {
    const r = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    const world = this.vp.toWorld(screen);
    const snapped = this.snapEnabled ? snapPoint(world, this.gridSize) : world;
    return { world, snapped, screen, shift: e.shiftKey, alt: e.altKey };
  }

  private bindEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      if (e.button === 1 || this.space) { this.panning = true; this.lastPan = { x: e.clientX, y: e.clientY }; return; }
      if (e.button !== 0) return;
      this.active.onDown(this.pInfo(e));
      this.render();
    });
    c.addEventListener('pointermove', e => {
      if (this.panning) {
        this.vp.panBy(e.clientX - this.lastPan.x, e.clientY - this.lastPan.y);
        this.lastPan = { x: e.clientX, y: e.clientY };
        this.render();
        return;
      }
      this.active.onMove(this.pInfo(e));
    });
    const end = (e: PointerEvent) => {
      if (this.panning) { this.panning = false; return; }
      this.active.onUp(this.pInfo(e));
      this.render();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => { this.panning = false; });

    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.vp.zoomAt(screen, e.deltaY < 0 ? 1.1 : 1 / 1.1);
      this.hooks.zoom?.(Math.round(this.vp.scale / 0.4 * 100));
      this.render();
    }, { passive: false });

    window.addEventListener('resize', () => { this.vp.resize(); this.render(); });

    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.inputEnabled) return; // 2D is only the preview — ignore shortcuts
      // Esc always cancels the current tool (e.g. furniture placement) and clears
      // the selection, returning to the plain select/mouse mode.
      if (e.key === 'Escape') { this.selectTool('select'); this.doc.select(null); return; }
      if (e.code === 'Space') { this.space = true; this.canvas.style.cursor = 'grab'; return; }
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') { e.shiftKey ? this.doc.redo() : this.doc.undo(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'y') { this.doc.redo(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'c') { this.copySelection(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'v') { this.pasteClipboard(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'd') { this.duplicateSelection(); e.preventDefault(); return; }
      // note: W/A/S/D are reserved for 3D camera movement, so they are NOT tool shortcuts
      const map: Record<string, string> = { v: 'select', h: 'pan', n: 'window', m: 'dimension' };
      if (!meta && map[e.key.toLowerCase()]) { this.selectTool(map[e.key.toLowerCase()]); return; }
      this.active.onKey?.(e);
    });
    window.addEventListener('keyup', e => { if (e.code === 'Space') { this.space = false; this.canvas.style.cursor = this.active.cursor; } });

    // WASD pans the 2D view — only while 2D is the main view (in 3D, the same keys
    // fly the 3D camera). Match on e.code so an IME/non-US layout can't swallow them.
    const PAN: Record<string, string> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
    const typing = () => { const el = document.activeElement as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable); };
    window.addEventListener('keydown', e => {
      if (!this.inputEnabled) return;
      const mv = PAN[e.code];
      if (!mv || typing()) return;
      e.preventDefault();
      this.panShift = e.shiftKey;
      if (!this.panKeys.has(mv)) { this.panKeys.add(mv); this.startPanLoop(); }
    }, { capture: true });
    window.addEventListener('keyup', e => { const mv = PAN[e.code]; if (mv) this.panKeys.delete(mv); if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.panShift = false; });
    window.addEventListener('blur', () => this.panKeys.clear());
  }

  private startPanLoop() {
    if (this.panRaf) return;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (!this.panKeys.size || !this.inputEnabled) { this.panRaf = 0; return; }
      let dx = 0, dy = 0;
      if (this.panKeys.has('a')) dx += 1; if (this.panKeys.has('d')) dx -= 1;
      if (this.panKeys.has('w')) dy += 1; if (this.panKeys.has('s')) dy -= 1;
      const speed = 750 * dt * (this.panShift ? 2.4 : 1);   // px/s, screen-space so it feels the same at any zoom
      this.vp.panBy(dx * speed, dy * speed);
      this.render();
      this.panRaf = requestAnimationFrame(loop);
    };
    this.panRaf = requestAnimationFrame(loop);
  }

  setSnap(on: boolean) { this.snapEnabled = on; }
  resetView() { this.vp.scale = 0.4; this.vp.centerOn(0, 0, 800, 600); this.hooks.zoom?.(100); this.render(); }

  // Zoom in/out about the canvas centre — used by the topbar − / + buttons.
  zoomBy(factor: number) {
    this.vp.zoomAt({ x: this.vp.width / 2, y: this.vp.height / 2 }, factor);
    this.hooks.zoom?.(Math.round(this.vp.scale / 0.4 * 100));
    this.render();
  }

  // ---- clipboard / duplicate ----
  private offsetObj(o: any, dx: number, dy: number) {
    if (o.kind === 'room' && o.poly) { o.poly = o.poly.map((p: Vec) => ({ x: p.x + dx, y: p.y + dy })); o.auto = false; }
    if ('x' in o) { o.x += dx; o.y += dy; }
    if ('a' in o) { o.a = { x: o.a.x + dx, y: o.a.y + dy }; o.b = { x: o.b.x + dx, y: o.b.y + dy }; }
    return o;
  }
  private cloneWithOffset(objs: Obj[], dx: number, dy: number): Obj[] {
    return objs.map(o => { const c = JSON.parse(JSON.stringify(o)); c.id = genId(o.kind); return this.offsetObj(c, dx, dy); });
  }
  copySelection() { const s = this.doc.selectedObjects; if (s.length) this.clipboard = s.map(o => JSON.parse(JSON.stringify(o))); }
  pasteClipboard() {
    if (!this.clipboard.length) return;
    const d = this.gridSize * 2;
    const clones = this.cloneWithOffset(this.clipboard, d, d);
    this.doc.commit();
    for (const c of clones) this.doc.add(c);
    this.doc.selectMany(clones.map(c => c.id));
  }
  duplicateSelection() {
    const s = this.doc.selectedObjects; if (!s.length) return;
    const d = this.gridSize * 2;
    const clones = this.cloneWithOffset(s, d, d);
    this.doc.commit();
    for (const c of clones) this.doc.add(c);
    this.doc.selectMany(clones.map(c => c.id));
  }

  // ---- align / distribute a multi-selection ----
  align(edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
    const objs = this.doc.selectedObjects; if (objs.length < 2) return;
    const bs = objs.map(o => bounds(o));
    const minX = Math.min(...bs.map(b => b.x)), maxX = Math.max(...bs.map(b => b.x + b.w));
    const minY = Math.min(...bs.map(b => b.y)), maxY = Math.max(...bs.map(b => b.y + b.h));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.doc.commit();
    objs.forEach((o, i) => {
      const b = bs[i]; let dx = 0, dy = 0;
      if (edge === 'left') dx = minX - b.x;
      else if (edge === 'right') dx = maxX - (b.x + b.w);
      else if (edge === 'hcenter') dx = cx - (b.x + b.w / 2);
      else if (edge === 'top') dy = minY - b.y;
      else if (edge === 'bottom') dy = maxY - (b.y + b.h);
      else if (edge === 'vcenter') dy = cy - (b.y + b.h / 2);
      if (dx || dy) this.doc.update(o.id, this.offsetObj(JSON.parse(JSON.stringify(o)), dx, dy));
    });
  }
  distribute(axis: 'h' | 'v') {
    const objs = this.doc.selectedObjects; if (objs.length < 3) return;
    const items = objs.map(o => ({ o, b: bounds(o) }));
    const key = axis === 'h' ? (b: Bounds) => b.x + b.w / 2 : (b: Bounds) => b.y + b.h / 2;
    items.sort((a, z) => key(a.b) - key(z.b));
    const first = key(items[0].b), last = key(items[items.length - 1].b);
    const step = (last - first) / (items.length - 1);
    this.doc.commit();
    items.forEach((it, i) => {
      const target = first + step * i, cur = key(it.b);
      const d = target - cur; if (!d) return;
      this.doc.update(it.o.id, this.offsetObj(JSON.parse(JSON.stringify(it.o)), axis === 'h' ? d : 0, axis === 'h' ? 0 : d));
    });
  }
}
