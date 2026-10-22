// 照明的五條健檢（docs/lighting-spec.md「區域與檢查」）：燈在枕頭上方、崁燈貼著
// 做到頂的櫃子、層板燈沒鎖在東西上或跨在門上、整間明暗差太大、區域不夠亮。
//
// 跟 `health.ts` 其他規則守同樣的三條界線（design-rules 第十節）：
//
//   · 只回報，永不打斷——這裡只產生 Finding。
//   · **只檢查標了需求的。** 一盞燈都沒有的房間不檢查：還沒排燈的平面圖如果每張
//     床都報「床面偏暗」，那是誤報製造機，使用者會學會忽略整張清單。
//   · 數字是預設值不是事實，全部在 `locale-defaults.ts::LIGHTING`。
//
// 亮度一律用同一個假設算：桌面高度、全部迴路開著、中間色牆面。面板可以切別的
// 看法，健檢不跟著切——同一張圖的提醒不該因為誰剛剛關了一路燈就變了。
//
// 純函式：物件進，findings 出。

import type { Electrical, Obj, Opening } from '../model/schema';
import type { Finding } from './health';
import type { Box } from './clearance';
import { wallBox } from './clearance';
import { ELECTRICAL_BY_ID } from '../model/catalogue';
import { LIGHTING } from '../model/locale-defaults';
import { Luminaire, PLANES, REFLECTANCE, grid, inside, lightRoom, luminaires, roomLuminaires } from './lighting';
import { fullHeightBoxes, fullHeightFurniture, furnitureBox } from './lightmap';
import { distToBox, litBy, pillowPoint, roomZones, toLocal, verdict, isBed, zoneStat } from './lightzones';

type Furniture = Extract<Obj, { kind: 'furniture' }>;
type Room = Extract<Obj, { kind: 'room' }>;
type Wall = Extract<Obj, { kind: 'wall' }>;
type Beam = Extract<Obj, { kind: 'beam' }>;

/** 健檢的固定看法：桌面、中間色、5 cm——跟面板預設一樣，數字才對得起來。 */
const RHO = REFLECTANCE.medium;
const STEP = 5;
/** 貼著＝離支撐面 2 cm 內（原型 1.5，多留一點給吸附的捨入）。 */
const MOUNT_TOL = 2;

const lampName = (e: Electrical) => ELECTRICAL_BY_ID[e.item]?.name ?? '燈';
const label = (f: Furniture) => f.label || '櫃子';
const deg = (r: number) => Math.round(r);


/**
 * 一支燈管有沒有鎖在某個東西上：它跟那個東西的某一面平行、中心離那一面 2 cm 內
 * （或埋在牆厚裡——圖上牆心線就是房間外框時，吸附會落在那裡）、整支長度都在那一面
 * 的範圍內，而且是朝外照（背靠著它）。
 */
function mountedOn(L: Luminaire, b: Box): boolean {
  const t = L.tube!;
  const c = toLocal(b, L.x, L.y);
  const a = b.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  // 燈照的方向，換到盒子自己的座標系。
  const fx = t.face[0] * ca + t.face[1] * sa, fy = -t.face[0] * sa + t.face[1] * ca;
  const half = t.length / 2;
  if (Math.abs(fx) > 0.99) {
    const s = Math.sign(fx), off = s * c.x;
    return off >= -MOUNT_TOL && off <= b.w / 2 + MOUNT_TOL && Math.abs(c.y) + half <= b.h / 2 + MOUNT_TOL;
  }
  if (Math.abs(fy) > 0.99) {
    const s = Math.sign(fy), off = s * c.y;
    return off >= -MOUNT_TOL && off <= b.h / 2 + MOUNT_TOL && Math.abs(c.x) + half <= b.w / 2 + MOUNT_TOL;
  }
  return false;
}

/**
 * 同一直線上、端點相接的牆段併成一個盒子。牆在這個 App 常被切段（在牆上點一下拆開、
 * 底圖辨識、DXF 匯入），一支跨過接縫的燈管兩邊都有牆可以鎖，不該因為牆是兩筆資料就
 * 被報「沒貼著」。厚度不同的段取厚的。
 */
export function mergeCollinear(boxes: Box[]): Box[] {
  const out = boxes.map(b => ({ ...b }));
  const same = (a: Box, b: Box) => {
    const d = ((a.angle - b.angle) % 180 + 180) % 180;
    if (Math.min(d, 180 - d) > 1) return false;
    const l = toLocal(a, b.cx, b.cy);
    return Math.abs(l.y) < 1 && Math.abs(l.x) <= (a.w + b.w) / 2 + 1;
  };
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) for (let j = i + 1; j < out.length && !merged; j++) {
      const a = out[i], b = out[j];
      if (!same(a, b)) continue;
      const lb = toLocal(a, b.cx, b.cy).x;
      const lo = Math.min(-a.w / 2, lb - b.w / 2), hi = Math.max(a.w / 2, lb + b.w / 2), mid = (lo + hi) / 2;
      const r = a.angle * Math.PI / 180;
      out[i] = { cx: a.cx + Math.cos(r) * mid, cy: a.cy + Math.sin(r) * mid, w: hi - lo, h: Math.max(a.h, b.h), angle: a.angle };
      out.splice(j, 1);
      merged = true;
    }
  }
  return out;
}

/**
 * 燈管有沒有穿過一道跟它不平行的牆——T 字接頭兩側的牆段併起來之後，跨過接頭的燈管
 * 看起來背後一整面都是牆，但隔間牆正從中間接上來，裝不上去。沿著燈管、往它照的方向
 * 退 2 cm，每 5 cm 一個點看有沒有落進那種牆裡。
 */
function crossesWall(L: Luminaire, walls: Box[]): boolean {
  const t = L.tube!;
  const n = Math.max(2, Math.ceil(t.length / 5));
  for (const b of walls) {
    const a = b.angle * Math.PI / 180;
    if (Math.abs(Math.cos(a) * t.axis[0] + Math.sin(a) * t.axis[1]) > 0.99) continue;
    for (let i = 0; i <= n; i++) {
      const u = (i / n - 0.5) * t.length;
      const x = L.x + t.axis[0] * u + t.face[0] * MOUNT_TOL, y = L.y + t.axis[1] * u + t.face[1] * MOUNT_TOL;
      if (distToBox(b, x, y) === 0) return true;
    }
  }
  return false;
}

/** 燈管跟門在同一道牆上、而且沿牆的範圍重疊。 */
function overDoor(L: Luminaire, door: Opening, reach: number): boolean {
  const t = L.tube!;
  const a = door.angle * Math.PI / 180, ax = { x: Math.cos(a), y: Math.sin(a) };
  if (Math.abs(ax.x * t.axis[0] + ax.y * t.axis[1]) < 0.99) return false;
  const dx = L.x - door.x, dy = L.y - door.y;
  if (Math.abs(-ax.y * dx + ax.x * dy) > reach) return false;
  const along = ax.x * dx + ax.y * dy;
  return Math.abs(along) < t.length / 2 + door.width / 2;
}

/**
 * 結果只取決於這幾種物件；照度要跑格點，而 `checkPlan` 每次文件變動都會叫——
 * 選取、改圖層名稱、畫尺寸線都不該重算。照度面板也呼叫這支，兩邊共用同一份。
 */
const RELEVANT = new Set(['room', 'wall', 'beam', 'door', 'furniture', 'electrical']);
let memo: { key: string; out: Finding[] } | null = null;

export function lightingFindings(objs: readonly Obj[], ceiling: number): Finding[] {
  if (!objs.some(o => o.kind === 'electrical')) return [];
  const key = ceiling + JSON.stringify(objs.filter(o => RELEVANT.has(o.kind)));
  if (memo?.key === key) return memo.out;
  const out = compute(objs, ceiling);
  memo = { key, out };
  return out;
}

function compute(objs: readonly Obj[], ceiling: number): Finding[] {
  const L = LIGHTING;
  const all = luminaires(objs, ceiling);
  if (!all.length) return [];
  const elec = new Map(objs.filter((o): o is Electrical => o.kind === 'electrical').map(e => [e.id, e]));
  const nameOf = (lm: Luminaire) => { const e = elec.get(lm.id); return e ? lampName(e) : '燈'; };
  const cabinets = fullHeightFurniture(objs, ceiling);
  const blocked = fullHeightBoxes(objs, ceiling);
  const walls = objs.filter((o): o is Wall => o.kind === 'wall');
  const beams = objs.filter((o): o is Beam => o.kind === 'beam');
  const doors = objs.filter((o): o is Opening => o.kind === 'door');
  const out: Finding[] = [];
  const rooms = objs.filter((o): o is Room => o.kind === 'room').map(room => {
    const lr = lightRoom(room, ceiling, blocked);
    return { room, lr, lums: roomLuminaires(lr, all) };
  });
  /** 燈屬於哪一間：第一間照到它的。面板靠這個把提醒分到房間。 */
  const roomOfLum = new Map<string, string>();
  for (const r of rooms) for (const lm of r.lums) if (!roomOfLum.has(lm.id)) roomOfLum.set(lm.id, r.room.id);

  // ---- 二：崁燈跟做到頂的櫃子，同一間裡才算——隔著牆的櫃子跟這盞燈無關
  for (const r of rooms) for (const lm of r.lums) {
    if (lm.tube || lm.z < ceiling) continue;   // 吊燈垂在櫃子前面不撞櫃頂
    if (roomOfLum.get(lm.id) !== r.room.id) continue;
    for (const f of cabinets.filter(f => inside(r.lr.poly, f.x + f.w / 2, f.y + f.h / 2))) {
      const d = distToBox(furnitureBox(f), lm.x, lm.y);
      if (d === 0) out.push({
        id: `light-cab-above:${lm.id}:${f.id}`, rule: 'light-cabinet', severity: 'lighting',
        title: `${nameOf(lm)}裝在做到頂的櫃子上方`,
        detail: `${nameOf(lm)}落在「${label(f)}」的範圍裡`,
        why: '櫃子做到天花板，這個位置裝不了燈；算出來的照度也不會是真的。',
        targets: [lm.id, f.id], room: r.room.id,
      });
      else if (d < L.downlightToCabinet) out.push({
        id: `light-cab-near:${lm.id}:${f.id}:${Math.round(d)}`, rule: 'light-cabinet', severity: 'lighting',
        title: `${nameOf(lm)}離做到頂的櫃子太近`,
        detail: `離「${label(f)}」只有 ${Math.round(d)}cm，建議 30～50cm`,
        why: '光大多打在櫃子頂端與櫃面上緣，櫃子前面反而暗。',
        targets: [lm.id, f.id], room: r.room.id,
      });
    }
  }

  // ---- 三：燈管要鎖在牆、樑或櫃子上，而且不能跨在門上
  const straight = walls.filter(w => !w.bulge);
  const wallBoxes = straight.map(w => wallBox(w.a, w.b, w.thickness)).filter((b): b is Box => !!b);
  const supports: Box[] = mergeCollinear([
    ...straight.map(w => wallBox(w.a, w.b, w.thickness)),
    ...beams.map(b => wallBox(b.a, b.b, b.width)),
  ].filter((b): b is Box => !!b));
  supports.push(...blocked);
  // 弧形牆：盒子是弦，貼在弧面上的燈離弦差一個拱高。先不精算——燈管落在弦到拱頂
  // 那一帶（加半個牆厚）就當作貼著，寧可少報。
  const curved = walls.filter(w => w.bulge).map(w => {
    const b = wallBox(w.a, w.b, w.thickness);
    return b && { ...b, h: b.h + 2 * Math.abs(w.bulge!) };
  }).filter((b): b is Box => !!b);
  const maxWall = Math.max(12, ...walls.map(w => w.thickness));
  for (const lm of all) {
    if (!lm.tube) continue;
    const room = roomOfLum.get(lm.id);
    const onCurve = curved.some(b => distToBox(b, lm.x, lm.y) <= MOUNT_TOL);
    if (!onCurve && (!supports.some(b => mountedOn(lm, b)) || crossesWall(lm, wallBoxes))) out.push({
      id: `light-mount:${lm.id}:${Math.round(lm.x)}:${Math.round(lm.y)}`, rule: 'light-mount', severity: 'lighting',
      title: `${nameOf(lm)}沒有貼著牆或櫃子`,
      detail: `整支 ${Math.round(lm.tube.length)}cm 要背靠在同一面牆、樑或做到頂的櫃子上`,
      why: '燈管要鎖在牆面、樑或櫃子封板上。拖到牆邊會自動貼齊。',
      targets: [lm.id], room,
    });
    const door = doors.find(d => overDoor(lm, d, maxWall / 2 + MOUNT_TOL + 1));
    if (door) out.push({
      id: `light-door:${lm.id}:${door.id}`, rule: 'light-door', severity: 'lighting',
      title: `${nameOf(lm)}跨在門上方`,
      detail: `跟門在同一道牆上，沿牆的範圍重疊 ${Math.round(Math.min(lm.tube.length, door.width))}cm 以內`,
      why: '門框上方要有足夠的牆面才鎖得住；不夠的話換短一號或往旁邊挪。',
      targets: [lm.id, door.id], room,
    });
  }

  // ---- 一、四、五：一間一間看，只看有燈的房間
  for (const { room, lr, lums } of rooms) {
    if (!lums.length) continue;
    const rname = room.name || '房間';

    // 一：枕頭上方
    const beds = objs.filter((o): o is Furniture => o.kind === 'furniture' && isBed(o.item)
      && inside(lr.poly, o.x + o.w / 2, o.y + o.h / 2));
    for (const bed of beds) {
      const hp = pillowPoint(bed);
      for (const lm of lums) {
        const ang = Math.atan2(Math.hypot(lm.x - hp.x, lm.y - hp.y), lm.z - L.pillowHeight) * 180 / Math.PI;
        const behind = (lm.x - hp.x) * hp.toHead.x + (lm.y - hp.y) * hp.toHead.y > 0;
        const base = { rule: 'light-pillow', severity: 'lighting' as const, targets: [lm.id, bed.id], room: room.id };
        if (behind && ang < L.glareNear) out.push({
          ...base, id: `light-pillow-behind:${lm.id}:${bed.id}:${deg(ang)}`,
          title: `${nameOf(lm)}在床頭後上方`,
          detail: `從枕頭看偏離正上方 ${deg(ang)}°，在床頭那一側`,
          why: '躺下來在視線上緣，不會正對眼睛；選有霧面燈罩的款比較不刺眼。',
        });
        else if (!behind && ang < L.glareDirect) out.push({
          ...base, id: `light-pillow:${lm.id}:${bed.id}:${deg(ang)}`,
          title: `${nameOf(lm)}在枕頭上方附近`,
          detail: `躺下來偏離正上方只有 ${deg(ang)}°（${L.glareDirect}° 以內會直視）`,
          why: '躺著會直接看到光源。建議移到床尾或床外側。',
        });
        else if (!behind && ang < L.glareNear && !lm.tube) out.push({
          ...base, id: `light-pillow-near:${lm.id}:${bed.id}:${deg(ang)}`,
          title: `${nameOf(lm)}離枕頭有點近`,
          detail: `偏離正上方 ${deg(ang)}°（${L.glareDirect}～${L.glareNear}° 之間）`,
          why: '躺下來眼角看得到；不一定要移，選深嵌防眩的款就好。',
        });
      }
    }

    // 四：整間均勻度
    const g = grid(lr, lums, { height: PLANES.desk, rho: RHO, step: STEP });
    if (g.avg > 0 && g.uniformity < L.uniformity) out.push({
      id: `light-uniform:${room.id}:${g.uniformity.toFixed(2)}`, rule: 'light-uniformity', severity: 'lighting',
      title: `${rname}明暗差比較大`,
      detail: `均勻度 ${g.uniformity.toFixed(2)}（最暗 ${Math.round(g.min)} ÷ 平均 ${Math.round(g.avg)} lux），低於 ${L.uniformity}`,
      why: '最暗的角落跟平均差太多，眼睛在亮暗之間來回會累。在暗處補一盞、或把燈往暗處挪。以桌面高度、全部迴路開著、中間色牆面計算。',
      targets: [room.id], room: room.id,
    });

    // 五：各區域達標
    const lit = litBy(lr, lums, RHO);
    for (const z of roomZones(lr, objs, ceiling)) {
      const st = zoneStat(lr, lit, z);
      if (!st) continue;
      const v = verdict(st.avg, z.need);
      if (v === 'ok') continue;
      const avg = Math.round(st.avg);
      const base = { id: `light-zone:${room.id}:${z.type}:${z.target}:${avg}`, rule: 'light-zone', severity: 'lighting' as const, targets: [z.target], room: room.id };
      if (z.type === 'desk') out.push({
        ...base, title: `${z.name}不夠亮`,
        detail: `約 ${avg} lux，寫字建議 ≥${z.need}`,
        why: '桌面要的亮度是一般照明的三倍，靠天花板的燈補上去很浪費；加一盞檯燈最直接。',
      });
      else out.push({
        ...base, title: `${z.type === 'door' ? rname : ''}${z.name}${v === 'dark' ? '偏暗' : '略暗'}`,
        detail: `約 ${avg} lux，建議 ≥${z.need}`,
        why: `${z.tip}。以全部迴路開著、中間色牆面計算。`,
      });
    }
  }
  return out;
}
