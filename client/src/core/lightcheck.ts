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

export function lightingFindings(objs: readonly Obj[], ceiling: number): Finding[] {
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

  // ---- 二：崁燈跟做到頂的櫃子
  for (const lm of all) {
    if (lm.tube || lm.z < ceiling) continue;   // 吊燈垂在櫃子前面不撞櫃頂
    for (const f of cabinets) {
      const d = distToBox(furnitureBox(f), lm.x, lm.y);
      if (d === 0) out.push({
        id: `light-cab-above:${lm.id}:${f.id}`, rule: 'light-cabinet', severity: 'lighting',
        title: `${nameOf(lm)}裝在做到頂的櫃子上方`,
        detail: `${nameOf(lm)}落在「${label(f)}」的範圍裡`,
        why: '櫃子做到天花板，這個位置裝不了燈；算出來的照度也不會是真的。',
        targets: [lm.id, f.id],
      });
      else if (d < L.downlightToCabinet) out.push({
        id: `light-cab-near:${lm.id}:${f.id}:${Math.round(d)}`, rule: 'light-cabinet', severity: 'lighting',
        title: `${nameOf(lm)}離做到頂的櫃子太近`,
        detail: `離「${label(f)}」只有 ${Math.round(d)}cm，建議 30～50cm`,
        why: '光大多打在櫃子頂端與櫃面上緣，櫃子前面反而暗。',
        targets: [lm.id, f.id],
      });
    }
  }

  // ---- 三：燈管要鎖在牆、樑或櫃子上，而且不能跨在門上
  const supports: { box: Box; wall?: Wall }[] = [
    ...walls.map(w => ({ box: wallBox(w.a, w.b, w.thickness), wall: w })),
    ...beams.map(b => ({ box: wallBox(b.a, b.b, b.width) })),
  ].filter((s): s is { box: Box; wall?: Wall } => !!s.box);
  supports.push(...blocked.map(box => ({ box })));
  const maxWall = Math.max(12, ...walls.map(w => w.thickness));
  for (const lm of all) {
    if (!lm.tube) continue;
    if (!supports.some(s => mountedOn(lm, s.box))) out.push({
      id: `light-mount:${lm.id}:${Math.round(lm.x)}:${Math.round(lm.y)}`, rule: 'light-mount', severity: 'lighting',
      title: `${nameOf(lm)}沒有貼著牆或櫃子`,
      detail: `整支 ${Math.round(lm.tube.length)}cm 要背靠在同一面牆、樑或做到頂的櫃子上`,
      why: '燈管要鎖在牆面、樑或櫃子封板上。拖到牆邊會自動貼齊。',
      targets: [lm.id],
    });
    const door = doors.find(d => overDoor(lm, d, maxWall / 2 + MOUNT_TOL + 1));
    if (door) out.push({
      id: `light-door:${lm.id}:${door.id}`, rule: 'light-door', severity: 'lighting',
      title: `${nameOf(lm)}跨在門上方`,
      detail: `跟門在同一道牆上，沿牆的範圍重疊 ${Math.round(Math.min(lm.tube.length, door.width))}cm 以內`,
      why: '門框上方要有足夠的牆面才鎖得住；不夠的話換短一號或往旁邊挪。',
      targets: [lm.id, door.id],
    });
  }

  // ---- 一、四、五：一間一間看，只看有燈的房間
  for (const room of objs.filter((o): o is Room => o.kind === 'room')) {
    const lr = lightRoom(room, ceiling, blocked);
    const lums = roomLuminaires(lr, all);
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
        const base = { rule: 'light-pillow', severity: 'lighting' as const, targets: [lm.id, bed.id] };
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
      targets: [room.id],
    });

    // 五：各區域達標
    const lit = litBy(lr, lums, RHO);
    for (const z of roomZones(lr, objs, ceiling)) {
      const st = zoneStat(lr, lit, z);
      if (!st) continue;
      const v = verdict(st.avg, z.need);
      if (v === 'ok') continue;
      const avg = Math.round(st.avg);
      const base = { id: `light-zone:${room.id}:${z.type}:${z.target}:${avg}`, rule: 'light-zone', severity: 'lighting' as const, targets: [z.target] };
      if (z.type === 'desk') out.push({
        ...base, title: `${z.name}不夠亮`,
        detail: `約 ${avg} lux，寫字建議 ≥${z.need}`,
        why: '桌面要的亮度是一般照明的三倍，靠天花板的燈補上去很浪費；加一盞檯燈最直接。',
      });
      else out.push({
        ...base, title: `${z.name}${v === 'dark' ? '偏暗' : '略暗'}`,
        detail: `約 ${avg} lux，建議 ≥${z.need}`,
        why: `${z.tip}。以全部迴路開著、中間色牆面計算。`,
      });
    }
  }
  return out;
}
