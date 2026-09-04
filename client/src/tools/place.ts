import { Tool, ToolCtx, PointerInfo } from './types';
import { genId, Doc } from '../model/doc';
import { Vec, Obj } from '../model/schema';
import { layerForKind, ELECTRICAL_BY_ID } from '../model/catalogue';
import { closestOnSegment, angleDeg, dist, fmtLen, arcOpening, arcSpan, wallControl } from '../core/geometry';
import { Box, wallBox, pushOut, groupPushOut } from '../core/clearance';
import { FURNITURE_BY_ID } from '../data/furniture';
import { ELECTRICAL_SYMBOLS } from '../data/electrical';

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
    this.ctx.selectTool('select');   // place one → select it (don't keep placing another)
  }
  onUp() {}
  deactivate() { this.cand = null; this.ctx.setPreview(); }
}

const FURN_SNAP = 60;   // cm — 游標離牆多近才算「要靠牆放」

/**
 * 靠牆放的家具要背對牆。
 *
 * 沙發、床、櫃子、書桌的正面都在 local +y（3D 是 +z）那一側——`furniture3d.ts`
 * 的沙發把椅背放在 `-h/2`，圖例也把椅背畫在上緣。所以「背靠牆」就是讓 local +y
 * 指向室內，也就是牆的內法線。
 *
 * 之前一律 `angle: 0`，於是靠上牆放的沙發是對的，靠下牆放的沙發背朝著房間中央、
 * 臉貼著牆——而那是四面牆裡的三面。
 *
 * 兩種東西不轉：
 *   · 天花板件（吊燈、吊扇）——它掛在上面，沒有正面
 *   · 高度 ≤ 5cm 的地面覆蓋物（地毯、榻榻米、門墊）——轉了看不出來，
 *     但位置會被推去貼牆，那不是使用者要的
 */
export function fitFurnitureToWall(
  doc: Doc, cursor: Vec, item: { w: number; h: number; height?: number; mount?: string },
): { pos: Vec; angle: number } | null {
  if (item.mount === 'ceiling' || (item.height ?? 999) <= 5) return null;
  let best: { pos: Vec; angle: number } | null = null, bestD = FURN_SNAP;
  for (const o of doc.objects) {
    if (o.kind !== 'wall' || !doc.isLayerVisible(o.layer)) continue;
    const cs = closestOnSegment(cursor, o.a, o.b);
    const d = dist(cursor, cs.point);
    if (d >= bestD || d < 1e-6) continue;
    // 內法線：從牆指向游標那一側。牆有兩面，使用者點的那一面就是要靠的那一面。
    const n = { x: (cursor.x - cs.point.x) / d, y: (cursor.y - cs.point.y) / d };
    const off = (o.thickness ?? 12) / 2 + item.h / 2;
    bestD = d;
    best = {
      pos: { x: cs.point.x + n.x * off, y: cs.point.y + n.y * off },
      angle: Math.atan2(-n.x, n.y) * 180 / Math.PI,
    };
  }
  return best;
}

/** 這一層樓所有直牆的包圍盒。 */
function wallBoxes(doc: Doc): Box[] {
  const walls: Box[] = [];
  for (const o of doc.objects) {
    if (o.kind !== 'wall' || !doc.isLayerVisible(o.layer)) continue;
    // 曲線牆用弦當包圍盒會把弧的內側整片當成實心，把家具從房間中央推出去。
    // 直牆才推——曲線牆的碰撞留著沒做，寫在這裡比讓它安靜地推錯誠實。
    if (o.bulge) continue;
    const wb = wallBox(o.a, o.b, o.thickness ?? 12);
    if (wb) walls.push(wb);
  }
  return walls;
}

/**
 * 家具不能放進牆壁裡面。
 *
 * `fitFurnitureToWall` 只在游標離牆 60cm 內才動作，而且它做的是「貼上去」——
 * 離牆遠一點、或者用拖曳的、或者按方向鍵推過去，都可以把一張沙發推到牆的正中間。
 * 2D 看起來只是畫在牆上面，像是一個決定；3D 是一面牆從沙發中間穿過去。
 *
 * 規則是**推出來**而不是擋住：重疊了就沿最短的方向推到剛好貼著牆面。物件因此
 * 不一定跟著游標走，但它一定在一個合法的位置——這跟「靠牆家具的預覽當下就轉好」
 * 是同一個取捨，寧可讓使用者看到最後的結果，也不要讓他對著一個不會成真的畫面瞄準。
 *
 * 三種東西不算違規，因為它們本來就該在牆上或牆裡：
 *   · `mount: 'wall'`（壁燈、壁掛電視）——它掛在牆面上
 *   · `mount: 'ceiling'`（吊燈、吊扇）——它在天花板高度，平面上的重疊不是碰撞
 *   · 電氣配件（插座、開關）——`ElectricalTool` 本來就把它們吸到牆的中心線上
 *
 * 多選拖曳走 `groupClearOfWalls`，不是逐一呼叫這支——理由寫在那裡。
 */
export function keepOutOfWalls(
  doc: Doc, box: Box, item?: { mount?: string },
): Vec {
  if (item?.mount === 'wall' || item?.mount === 'ceiling') return { x: box.cx, y: box.cy };
  const walls = wallBoxes(doc);
  if (!walls.length) return { x: box.cx, y: box.cy };
  const out = pushOut(box, walls);
  return { x: out.cx, y: out.cy };
}

/** `keepOutOfWalls` for an object already in the document. */
export function furnitureClearOfWalls(
  doc: Doc, o: Extract<Obj, { kind: 'furniture' }>,
): Vec {
  const item = FURNITURE_BY_ID[o.item];
  const c = keepOutOfWalls(doc, { cx: o.x + o.w / 2, cy: o.y + o.h / 2, w: o.w, h: o.h, angle: o.angle }, item);
  return { x: c.x - o.w / 2, y: c.y - o.h / 2 };
}

/**
 * 一整組物件要移到 `at` 時，共用的那一個修正位移。
 *
 * **不是逐一物件推。** 逐一推是最直覺的寫法，也會安靜地把使用者排好的東西拆掉：
 * 沙發、茶几、地毯一起拖過牆，三件各自拿到不同的修正量，到位之後就散開了。相對
 * 位置是使用者親手排的，那才是要保住的東西。上一輪這個功能被還原，缺的就是這條。
 *
 * 非家具（牆、房間、門窗）不參與計算——它們有自己的規則，而且牆不需要躲開牆。
 */
export function groupClearOfWalls(
  doc: Doc, items: { o: Obj; at: Vec }[],
): Vec {
  const boxes: Box[] = [];
  for (const { o, at } of items) {
    if (o.kind !== 'furniture') continue;
    const item = FURNITURE_BY_ID[o.item];
    if (item?.mount === 'wall' || item?.mount === 'ceiling') continue;
    boxes.push({ cx: at.x + o.w / 2, cy: at.y + o.h / 2, w: o.w, h: o.h, angle: o.angle });
  }
  if (!boxes.length) return { x: 0, y: 0 };
  return groupPushOut(boxes, wallBoxes(doc));
}

// Place the currently-selected furniture item, then switch to the select tool.
export class FurnitureTool implements Tool {
  name = 'furniture'; cursor = 'crosshair'; hint = '點擊放置所選家具（可再選取調整）';
  constructor(private ctx: ToolCtx) {}

  private fit: { pos: Vec; angle: number } | null = null;


  /** 貼牆轉向之後再推出牆體：先轉再推，因為轉過的家具佔的是不同一塊地。 */
  private resolve(cursor: Vec, item: { w: number; h: number; height?: number; mount?: string }) {
    const fit = fitFurnitureToWall(this.ctx.doc, cursor, item);
    const angle = fit?.angle ?? 0, at = fit?.pos ?? cursor;
    const pos = keepOutOfWalls(this.ctx.doc, { cx: at.x, cy: at.y, w: item.w, h: item.h, angle }, item);
    return { pos, angle };
  }

  onMove(p: PointerInfo) {
    const item = FURNITURE_BY_ID[this.ctx.currentFurniture];
    if (!item) { this.ctx.setPreview(); return; }
    // 預覽就要轉好、也要推好。放下去才動的話，使用者是在對著一個跟結果不一樣的鬼影瞄準。
    this.fit = this.resolve(p.snapped, item);
    const c = this.fit.pos, a = this.fit.angle;
    this.ctx.setPreview(ctx => {
      ctx.save(); ctx.globalAlpha = 0.55;
      ctx.translate(c.x, c.y); ctx.rotate(a * Math.PI / 180); ctx.translate(-item.w / 2, -item.h / 2);
      item.draw(ctx, item.w, item.h); ctx.restore();
    });
    this.ctx.render();
  }
  onDown(p: PointerInfo) {
    const item = FURNITURE_BY_ID[this.ctx.currentFurniture];
    if (!item) return;
    this.ctx.doc.commit();
    const id = genId('furn');
    // A ceiling piece hangs from this storey's ceiling, a wall piece sits at eye
    // level. Worked out here rather than stored in the catalogue because the
    // ceiling height belongs to the floor, not to the lamp.
    const ceiling = this.ctx.doc.activeFloor.height;
    const elevation = item.mount === 'ceiling' ? Math.max(0, ceiling - 60)
      : item.mount === 'wall' ? 150 : undefined;
    const fit = this.fit ?? this.resolve(p.snapped, item);
    const c = fit.pos;
    this.ctx.doc.add({ id, kind: 'furniture', layer: layerForKind('furniture'), item: item.id, x: c.x - item.w / 2, y: c.y - item.h / 2, w: item.w, h: item.h, angle: fit.angle, label: item.name, ...(elevation ? { elevation } : {}), ...(item.height ? { height: item.height } : {}) });
    this.ctx.doc.select(id);
    this.ctx.selectTool('select');
  }
  onUp() {}
  deactivate() { this.ctx.setPreview(); }
}

/**
 * Place an electrical fitting.
 *
 * Wall-mounted items (sockets, switches) snap onto the nearest wall and turn to
 * face into the room, because that is how they are drawn and how they are
 * installed — a socket floating mid-room is always a mistake. Ceiling items go
 * wherever they are put.
 */
export class ElectricalTool implements Tool {
  name = 'electrical'; cursor = 'crosshair';
  hint = '點擊放置；插座／開關會自動貼牆並轉向，燈具可放在任意位置';
  constructor(private ctx: ToolCtx) {}

  private spec() { return ELECTRICAL_BY_ID[this.ctx.currentElectrical]; }

  /** Snap onto a wall and face into the room, or null if none is close enough. */
  private fitToWall(p: Vec): { pos: Vec; angle: number } | null {
    const walls = this.ctx.doc.objects.filter(o => o.kind === 'wall') as Extract<Obj, { kind: 'wall' }>[];
    let best: { pos: Vec; angle: number; d: number } | null = null;
    for (const w of walls) {
      const { point } = closestOnSegment(p, w.a, w.b);
      const d = dist(p, point);
      if (d > WALL_SNAP) continue;
      // The symbol's "up" is -y, so face it along the wall normal that points
      // towards the cursor — i.e. into the room the user is working in.
      const ang = angleDeg(w.a, w.b);
      const nx = -Math.sin(ang * Math.PI / 180), ny = Math.cos(ang * Math.PI / 180);
      const side = (p.x - point.x) * nx + (p.y - point.y) * ny >= 0 ? 1 : -1;
      const facing = ang + (side > 0 ? 0 : 180);
      if (!best || d < best.d) best = { pos: point, angle: facing, d };
    }
    return best ? { pos: best.pos, angle: best.angle } : null;
  }

  private place(p: Vec): { pos: Vec; angle: number } {
    const spec = this.spec();
    if (spec?.mount === 'wall') {
      const fit = this.fitToWall(p);
      if (fit) return fit;
    }
    return { pos: p, angle: 0 };
  }

  onMove(p: PointerInfo) {
    const spec = this.spec();
    if (!spec) { this.ctx.setPreview(); return; }
    const { pos, angle } = this.place(p.world);
    const sym = ELECTRICAL_SYMBOLS[spec.id];
    this.ctx.setPreview(ctx => {
      ctx.save(); ctx.globalAlpha = 0.6;
      ctx.translate(pos.x, pos.y); ctx.rotate(angle * Math.PI / 180);
      ctx.strokeStyle = '#ffd166'; ctx.fillStyle = '#ffd166';
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      sym(ctx);
      ctx.restore();
    });
    this.ctx.render();
  }

  onDown(p: PointerInfo) {
    const spec = this.spec();
    if (!spec) return;
    const { pos, angle } = this.place(p.world);
    this.ctx.doc.commit();
    const id = genId('elec');
    this.ctx.doc.add({
      id, kind: 'electrical', layer: layerForKind('electrical'),
      item: spec.id, x: pos.x, y: pos.y, angle,
      elevation: spec.elevation, label: spec.name,
    } as Obj);
    this.ctx.doc.select(id);
    // Stay on the tool: a plan needs many fittings, and re-picking the tool
    // between every socket would be its own kind of tedium.
  }
  onUp() {}
  deactivate() { this.ctx.setPreview(); }
}
