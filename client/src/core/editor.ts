import { Doc, genId } from '../model/doc';
import { Viewport } from './viewport';
import { Renderer } from './renderer';
import { snapPoint, rotate, distToSegment } from './geometry';
import { bounds } from './hit';
import { cloneWithOffset, alignMoves, distributeMoves, Move, Edge, Axis } from './arrange';
import { Reference, alignWalls, splitWallAt, findFaceSteps, FaceStep, Wall } from './wallEdit';
import { Tool, ToolCtx, PointerInfo, DrawFn } from '../tools/types';
import { SelectTool } from '../tools/select';
import { WallTool, CurvedWallTool, BeamTool, PartitionTool, RoomTool, DimensionTool } from '../tools/draw';
import { OpeningTool, FurnitureTool, ElectricalTool, fitOpeningToWall } from '../tools/place';
import { CalibrateTool } from '../tools/calibrate';
import { FURNITURE_BY_ID } from '../data/furniture';
import { Obj, Vec } from '../model/schema';
import { layerForKind } from '../model/catalogue';

export class Editor implements ToolCtx {
  vp: Viewport;
  renderer: Renderer;
  tools: Record<string, Tool> = {};
  active!: Tool;
  currentElectrical = 'socket';
  currentFurniture = 'sofa';
  snapEnabled = true;
  /**
   * Which line of a wall the numbers refer to while drawing.
   *
   * Site measurements are taken against a face, not a centreline, so this is
   * what makes a traced plan the right size. Kept on the editor rather than in
   * the tool because it survives switching tools — you measure a whole flat
   * against the inside faces, not one wall at a time.
   */
  wallRef: Reference = 'center';
  gridSize = 10; // cm
  inputEnabled = true; // false while the 2D view is just the corner preview

  // exportPano returns the message to show the user — it can decline (camera
  // outside the plan) as well as succeed, and both need explaining.
  /** Set by the UI layer; the calibrate tool reports its outcome through it. */
  onCalibrated?: (message: string, ok?: boolean) => void;

  hooks: { command?: (name: string) => void; toolChange?: (name: string) => void; zoom?: (pct: number) => void; export3d?: (name: string) => void; exportPano?: (name: string) => string; wallRef?: (r: Reference) => void } = {};

  private previewW?: DrawFn;
  private previewS?: DrawFn;
  private panning = false;
  private space = false;
  private lastPan: Vec = { x: 0, y: 0 };
  private panKeys = new Set<string>();   // WASD held keys for 2D view panning
  private panRaf = 0;
  private drawRaf = 0;
  private panShift = false;
  private clipboard: Obj[] = [];

  constructor(private canvas: HTMLCanvasElement, public doc: Doc, private hintEl: HTMLElement) {
    this.vp = new Viewport(canvas);
    this.renderer = new Renderer(canvas, this.vp, doc);
    this.renderer.onImageLoad = () => this.render();
    this.tools = {
      select: new SelectTool(this),
      wall: new WallTool(this),
      wallCurve: new CurvedWallTool(this),
      beam: new BeamTool(this),
      partition: new PartitionTool(this),
      room: new RoomTool(this),
      door: new OpeningTool(this, 'door'),
      window: new OpeningTool(this, 'window'),
      dimension: new DimensionTool(this),
      furniture: new FurnitureTool(this),
      electrical: new ElectricalTool(this),
      calibrate: new CalibrateTool(this),
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

  /**
   * Ask for a redraw. At most one happens per frame.
   *
   * It used to draw immediately, and everything called it: every tool's
   * onMove, and `doc.onChange`, which `doc.update()` fires. So dragging a
   * selection of five objects redrew the whole canvas six times per pointermove
   * — five from the updates, one from the tool — and a trackpad sends
   * pointermove far faster than the display refreshes. All but the last of
   * those frames were thrown away before anything reached the screen, and they
   * were thrown away *synchronously inside the event handler*, which is what
   * made dragging feel heavy: the work blocked the very frame it was for.
   *
   * Coalescing here rather than at each call site because there are 37 of them
   * and the next one added would have to remember.
   */
  render() {
    if (this.drawRaf) return;
    this.drawRaf = requestAnimationFrame(() => { this.drawRaf = 0; this.renderNow(); });
  }

  /**
   * Draw now, on this stack.
   *
   * For the paths that cannot wait for a frame: anything that reads the canvas
   * back straight afterwards, and anything running while the tab is hidden —
   * where rAF fires zero times a second and a scheduled draw simply never
   * happens.
   */
  renderNow() {
    if (this.drawRaf) { cancelAnimationFrame(this.drawRaf); this.drawRaf = 0; }
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

  // Place a door/window near plan point (x, y), snapped onto the nearest wall
  // (falls back to an unsnapped opening if none). Used by 3D wall-click placement.
  placeOpeningAt(kind: 'door' | 'window', pt: { x: number; y: number }): boolean {
    const width = kind === 'door' ? 90 : 120;
    const fit = fitOpeningToWall(this.doc, pt, width, kind === 'window', 200) ?? { pos: pt, angle: 0, width, bulge: 0 };
    this.doc.commit();
    const id = genId(kind);
    this.doc.add({ id, kind, layer: layerForKind(kind), x: fit.pos.x, y: fit.pos.y, width: fit.width, angle: fit.angle, bulge: fit.bulge || undefined } as Obj);
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
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable === true;
      // Esc is document-level, not a 2D tool shortcut, so it is handled *before*
      // both guards below.
      //
      // It used to sit after them and therefore did nothing in two of the three
      // places it is wanted: `inputEnabled` is false whenever 2D is not the main
      // view, so Esc was dead in 3D and in split — which is exactly where you are
      // after placing something and wanting out of it. And with the caret in a
      // properties field the handler returned before reaching Esc at all.
      //
      // From a field, Esc leaves the field and stops there. Losing the selection
      // as well because you happened to be editing a number is not what anyone
      // means by cancel; a second press then clears it.
      if (e.key === 'Escape') {
        if (typing) { el!.blur(); return; }
        this.selectTool('select');
        this.doc.select(null);
        return;
      }
      if (typing) return;

      // ---- document-level shortcuts, before the 2D/3D focus guard ----
      //
      // Same lesson as Esc: 存檔、開啟、新建、出圖、縮放 are things you do to the
      // *project*, not to the 2D pane, so gating them on which pane has the
      // keyboard makes ⌘S silently do nothing whenever the 3D view is in front —
      // and the one time you notice is the time you needed it.
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && !e.altKey) {
        const k = e.key.toLowerCase();
        const doc: Record<string, () => void> = {
          s: () => this.hooks.command?.('save'),
          o: () => this.hooks.command?.('open'),
          n: () => this.hooks.command?.('new'),
          p: () => this.hooks.command?.('plot'),
          '0': () => this.resetView(),
          '=': () => this.zoomBy(1.2),
          '+': () => this.zoomBy(1.2),
          '-': () => this.zoomBy(1 / 1.2),
        };
        if (doc[k]) { doc[k](); e.preventDefault(); return; }
      }

      if (!this.inputEnabled) return; // 2D is only the preview — ignore shortcuts
      if (e.code === 'Space') { this.space = true; this.canvas.style.cursor = 'grab'; return; }
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') { e.shiftKey ? this.doc.redo() : this.doc.undo(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'y') { this.doc.redo(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'c') { this.copySelection(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'v') { this.pasteClipboard(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'd') { this.duplicateSelection(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'x') { this.cutSelection(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'a') { this.selectAll(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === 'g') {
        e.shiftKey ? this.doc.ungroupSelection() : this.doc.groupSelection();
        e.preventDefault(); return;
      }
      // note: W/A/S/D are reserved for 3D camera movement, so they are NOT tool shortcuts
      const map: Record<string, string> = { v: 'select', h: 'select', n: 'window', m: 'dimension' };
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
      this.renderNow();   // already inside a frame — scheduling would land one late
      this.panRaf = requestAnimationFrame(loop);
    };
    this.panRaf = requestAnimationFrame(loop);
  }

  setSnap(on: boolean) { this.snapEnabled = on; }

  /** Cycle 中心 → 左緣 → 右緣. `hooks.wallRef` lets the topbar follow along. */
  cycleWallRef() {
    const order: Reference[] = ['center', 'left', 'right'];
    this.wallRef = order[(order.indexOf(this.wallRef) + 1) % order.length];
    this.hooks.wallRef?.(this.wallRef);
  }
  setWallRef(r: Reference) { this.wallRef = r; this.hooks.wallRef?.(r); }
  resetView() { this.vp.scale = 0.4; this.vp.centerOn(0, 0, 800, 600); this.hooks.zoom?.(100); this.render(); }

  // Zoom in/out about the canvas centre — used by the topbar − / + buttons.
  zoomBy(factor: number) {
    this.vp.zoomAt({ x: this.vp.width / 2, y: this.vp.height / 2 }, factor);
    this.hooks.zoom?.(Math.round(this.vp.scale / 0.4 * 100));
    this.render();
  }

  // ---- clipboard / duplicate ----
  copySelection() {
    const s = this.doc.selectedObjects;
    if (s.length) this.clipboard = s.map(o => JSON.parse(JSON.stringify(o)));
  }
  private addClones(source: Obj[]) {
    if (!source.length) return;
    const d = this.gridSize * 2;
    const clones = cloneWithOffset(source, d, d, genId);
    this.doc.commit();
    for (const c of clones) this.doc.add(c);
    this.doc.selectMany(clones.map(c => c.id));
  }
  pasteClipboard() { this.addClones(this.clipboard); }

  /** Copy, then remove. The single commit makes it one step of undo, not two. */
  cutSelection() {
    const objs = this.doc.selectedObjects;
    if (!objs.length) return;
    this.copySelection();
    this.doc.commit();
    for (const o of objs) this.doc.remove(o.id);
  }

  /**
   * Select everything on the active floor that can actually be edited.
   *
   * Locked and hidden layers are left out on purpose — `hitTest` already skips
   * them, so including them here would build a selection the mouse could never
   * have made, and the first drag would move the underlay everyone locked
   * precisely so it would not move.
   */
  selectAll() {
    const ids = this.doc.objects
      .filter(o => this.doc.isLayerVisible(o.layer) && !this.doc.isLayerLocked(o.layer))
      .map(o => o.id);
    if (ids.length) this.doc.selectMany(ids);
  }
  duplicateSelection() { this.addClones(this.doc.selectedObjects); }

  // ---- align / distribute a multi-selection ----
  private apply(moves: Move[]) {
    if (!moves.length) return;
    this.doc.commit();
    for (const m of moves) this.doc.update(m.id, m.obj);
  }
  align(edge: Edge) { this.apply(alignMoves(this.doc.selectedObjects, edge)); }

  /**
   * Bring the selected walls' faces onto one line. Returns what it refused to
   * touch so the panel can say so — walls that were silently left out would
   * look aligned everywhere the eye happens to land.
   */
  alignWallFaces(ref: Reference): { moved: number; skipped: number } {
    const walls = this.doc.selectedObjects.filter(o => o.kind === 'wall') as Wall[];
    const r = alignWalls(walls, ref);
    if (r.moves.length) {
      this.doc.commit();
      for (const m of r.moves) this.doc.update(m.id, { a: m.a, b: m.b } as any);
    }
    return { moved: r.moves.length, skipped: r.skipped.length };
  }

  private faceStepCache: { key: string; tol: number; out: FaceStep[] } | null = null;

  /**
   * Joins on the active floor whose faces nearly — but do not — line up.
   *
   * Memoised on the walls themselves. `findFaceSteps` compares every pair, so
   * it is O(n²) — 21.6 ms at 529 walls — and the panel that calls it is rebuilt
   * on **every document change**, including the overwhelming majority that
   * touch no wall at all: moving furniture, toggling a layer, changing floor,
   * undo of anything. Measured before this: 48.8 ms per refresh at 324 walls,
   * which is three dropped frames every time anything moves.
   *
   * The key is built in O(n) and covers exactly the inputs that matter — id,
   * both ends, thickness, curvature. Anything else changing cannot change the
   * answer, and rebuilding for it was the whole cost.
   */
  faceSteps(tol = 5): FaceStep[] {
    const walls = this.doc.objects.filter(o => o.kind === 'wall') as Wall[];
    let key = '';
    for (const w of walls) key += `${w.id}:${w.a.x},${w.a.y},${w.b.x},${w.b.y},${w.thickness},${w.bulge ?? 0};`;
    const c = this.faceStepCache;
    if (c && c.tol === tol && c.key === key) return c.out;
    const out = findFaceSteps(walls, tol);
    this.faceStepCache = { key, tol, out };
    return out;
  }

  /**
   * Pull one join flush, moving the thinner wall onto the chosen face.
   *
   * The wall's doors and windows go with it. They are stored in world
   * coordinates rather than as an offset along their wall, so a wall that moves
   * without them leaves its openings sitting 4.5 cm off centre — still inside
   * the wall, still punching a hole, just no longer where the frame is. That is
   * the kind of wrong that survives a screenshot.
   */
  alignFaceStep(s: FaceStep, side: 'left' | 'right'): void {
    const w = this.doc.objects.find(o => o.id === s.moverId);
    if (!w || w.kind !== 'wall') return;
    const shift = s.shift[side];
    if (Math.abs(shift) < 1e-9) return;
    const d = { x: s.normal.x * shift, y: s.normal.y * shift };

    this.doc.commit();
    const moved = { a: { x: w.a.x + d.x, y: w.a.y + d.y }, b: { x: w.b.x + d.x, y: w.b.y + d.y } };
    // Which openings are on it has to be answered before the wall moves.
    const riding = this.doc.objects.filter((o): o is Extract<Obj, { kind: 'door' | 'window' }> =>
      (o.kind === 'door' || o.kind === 'window')
      && distToSegment({ x: o.x, y: o.y }, w.a, w.b) <= w.thickness / 2 + 10);
    this.doc.update(w.id, moved as any);
    for (const o of riding) this.doc.update(o.id, { x: o.x + d.x, y: o.y + d.y } as any);
  }

  /** Cut the selected wall `atCm` from its a end. False when it declined. */
  splitSelectedWall(atCm: number): boolean {
    const w = this.doc.selected;
    if (!w || w.kind !== 'wall') return false;
    const out = splitWallAt(w as Wall, atCm);
    if (!out) return false;
    this.doc.commit();
    const [first, second] = out;
    this.doc.update(w.id, { a: first.a, b: first.b } as any);
    this.doc.add({ ...second, id: genId('wall') });
    return true;
  }
  distribute(axis: Axis) { this.apply(distributeMoves(this.doc.selectedObjects, axis)); }
}
