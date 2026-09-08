// 空間健檢：這張圖畫對了嗎，以及照這樣蓋出來住不住得了人。
//
// 這個 repo 的每一條幾何規則都在守同一件事——**不要超出使用者畫的線**。這支檔案
// 守的是反過來的那一半：**線本身畫得對不對、圍出來的空間夠不夠人用**。兩者的失敗
// 模式一模一樣，也是 `design-rules.md` 開頭那句話的意思：照樣跑完、看起來合理、
// 沒有例外、結果是錯的。一張牆端點差 2cm 沒接上的平面圖，2D 看不出來、面積算得
// 出來、PDF 印得出來，只有 3D 會露出一條縫，而工地會有人要處理它。
//
// 三個設計上的決定，每一個都是為了「不要變成雜訊」：
//
//   · **只回報，永不打斷。** 沒有任何一條會自己跳出來——工具列上一顆帶數字的按鈕
//     就是全部的存在感。描圖描到一半本來就有一半的牆沒接上，那是正常狀態不是錯誤
//     狀態，所以計數可以是兩位數而不該有人因此被彈窗攔下來。
//   · **一個 finding 要能被指認。** `id` 是從規則、物件 id 與四捨五入過的數字算出
//     來的，所以同一個問題在使用者改了別的地方之後仍然是同一個 finding——「忽略」
//     才有意義。反過來，真的改動到它，id 就變了，忽略自然失效。
//   · **只有唯一正解的才給一鍵修正。** 「牆端接上去」有唯一答案；「床邊不夠 70cm」
//     要挪床還是挪櫃、往哪邊挪，只有人知道。代勞會很容易挪出新的問題。
//
// 純函式：物件進，findings 出。不碰 DOM、不碰 doc、不碰 localStorage。

import { Obj, Vec } from '../model/schema';
import { dist, distToSegment, closestOnSegment, pointInPolygon, polygonCentroid } from './geometry';
import { Box, wallBox } from './clearance';
import { CLEARANCE, DEFAULTS } from '../model/locale-defaults';

type Wall = Extract<Obj, { kind: 'wall' }>;
type Furniture = Extract<Obj, { kind: 'furniture' }>;
type Room = Extract<Obj, { kind: 'room' }>;
type Opening = Extract<Obj, { kind: 'door' | 'window' }>;

export type Severity = 'geometry' | 'clearance';

/** Something that can be put right with one press, because it has one answer. */
export type Fix =
  /** Move this wall's endpoint onto the point it was reaching for. */
  | { kind: 'joinWall'; wallId: string; end: 'a' | 'b'; to: Vec };

export interface Finding {
  /**
   * Stable across unrelated edits, so "ignore this one" keeps meaning the same
   * thing — and *not* stable across edits to the thing itself, so fixing it
   * properly clears the ignore instead of hiding the next problem.
   */
  id: string;
  rule: string;
  severity: Severity;
  /** 「牆好像沒接上」 */
  title: string;
  /** The measurement, with its number. 「牆端離隔壁牆還差 7.3cm」 */
  detail: string;
  /** Why it matters, in the words somebody would use to a builder. */
  why: string;
  /** Objects to select when the row is clicked. */
  targets: string[];
  fix?: Fix;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const cm = (n: number) => `${r1(n)}cm`;

/** Corners of an oriented box, in world coordinates. */
function corners(b: Box): Vec[] {
  const rad = b.angle * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  const hw = b.w / 2, hh = b.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({
    x: b.cx + x * c - y * s,
    y: b.cy + x * s + y * c,
  }));
}

const boxOf = (f: Furniture): Box => ({ cx: f.x + f.w / 2, cy: f.y + f.h / 2, w: f.w, h: f.h, angle: f.angle ?? 0 });

/** Unit vectors along the box's own +x (right) and +y (front) axes. */
function axesOf(b: Box): { right: Vec; front: Vec } {
  const rad = b.angle * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  return { right: { x: c, y: s }, front: { x: -s, y: c } };
}

/**
 * Free distance from one face of `b` outwards, before hitting a wall or another
 * piece — capped at `want`, because "there is 4 m of space here" and "there is
 * enough" are the same answer and the cheaper one is enough.
 *
 * Measured from three points along the face rather than one: a bed pushed into
 * a corner has its centre clear and its head blocked, and a single ray down the
 * middle would call that fine.
 */
function freeFace(b: Box, dir: Vec, half: number, blockers: Box[], want: number): number {
  const { right, front } = axesOf(b);
  // The face's own tangent — whichever axis is perpendicular to `dir`.
  const along = Math.abs(dir.x * right.x + dir.y * right.y) > 0.5 ? front : right;
  const halfAlong = along === front ? b.h / 2 : b.w / 2;
  let worst = want;
  for (const t of [-0.7, 0, 0.7]) {
    const from: Vec = {
      x: b.cx + dir.x * half + along.x * halfAlong * t,
      y: b.cy + dir.y * half + along.y * halfAlong * t,
    };
    let d = want;
    for (let step = 1; step <= 12; step++) {
      const probe = { x: from.x + dir.x * (want * step / 12), y: from.y + dir.y * (want * step / 12) };
      if (blockers.some(z => insideBox(probe, z))) { d = want * (step - 1) / 12; break; }
    }
    worst = Math.min(worst, d);
  }
  return worst;
}

function insideBox(p: Vec, b: Box): boolean {
  const rad = -b.angle * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  const dx = p.x - b.cx, dy = p.y - b.cy;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

// ---------------------------------------------------------------- 甲：幾何
//
// 「圖畫錯了」那一類。不需要目錄上的任何額外資料，而且不可能誤報：一個沒有碰到
// 任何東西的牆端點就是沒有碰到，沒有第二種解釋。

/**
 * `design-rules.md` 1.6：**牆不會無緣無故伸一根出來**。
 *
 * 這條規則寫在那份文件裡很久了，守它的卻只有 `scripts/check-0199.mjs`——一支綁死
 * 某一張圖的一次性腳本。這裡把它變成每一張圖都在跑的檢查。
 *
 * 只抓「差一點點」的：端點離最近的牆 0 到 `JOIN_MAX` 公分之間。真的獨立的一道牆
 * （量一段長度、標一個尺寸）離所有東西都很遠，不該被唸。
 */
const JOIN_MAX = 30;

function wallJoins(walls: Wall[]): Finding[] {
  const out: Finding[] = [];
  /**
   * One gap, one row.
   *
   * A 5 cm gap between two walls is *two* loose endpoints — A reaching for B and
   * B reaching for A — and reporting both is worse than it sounds: pressing 接上
   * once closes the gap and the count drops by two, which reads like the button
   * did something it did not. Keyed on the pair plus the distance, so two
   * genuinely different gaps between the same two walls still both show.
   */
  const seen = new Set<string>();
  for (const w of walls) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      let best: { d: number; at: Vec; otherId: string } | null = null;
      for (const other of walls) {
        if (other.id === w.id) continue;
        // Already touching one of its endpoints? Then this end is joined.
        if (dist(p, other.a) < 0.5 || dist(p, other.b) < 0.5) { best = null; break; }
        const d = distToSegment(p, other.a, other.b);
        if (d < 0.5) { best = null; break; }
        if (d <= JOIN_MAX && (!best || d < best.d)) best = { d, at: closestOnSegment(p, other.a, other.b).point, otherId: other.id };
      }
      if (!best) continue;
      const pair = [w.id, best.otherId].sort().join('~') + ':' + Math.round(best.d * 10);
      if (seen.has(pair)) continue;
      seen.add(pair);
      out.push({
        id: `join:${w.id}:${end}:${Math.round(best.d * 10)}`,
        rule: 'wall-join',
        severity: 'geometry',
        title: '牆好像沒接上',
        detail: `牆端離隔壁牆還差 ${cm(best.d)} 沒接上`,
        why: '差幾公分沒碰到的話，2D 看不出來、面積照樣算得出來，只有 3D 與出圖會在這裡露出一條縫。',
        targets: [w.id],
        fix: { kind: 'joinWall', wallId: w.id, end, to: best.at },
      });
    }
  }
  return out;
}

/** 牆圍不出房間——畫了牆卻一個房間都沒偵測到，多半是有一處沒封起來。 */
function noRooms(walls: Wall[], rooms: Room[]): Finding[] {
  if (walls.length < 3 || rooms.length > 0) return [];
  return [{
    id: `norooms:${walls.length}`,
    rule: 'no-rooms',
    severity: 'geometry',
    title: '牆還沒圍成任何房間',
    detail: `畫了 ${walls.length} 道牆，但一個房間都沒有被認出來`,
    why: '房間是自動從封閉的牆圈算出來的。一個房間都沒有，通常代表有一處沒有真的接起來——面積報表與地坪材質都會跟著是空的。',
    targets: walls.slice(0, 1).map(w => w.id),
  }];
}

// ---------------------------------------------------------------- 乙：淨距
//
// 「住不住得了人」那一類。數字全部來自 `locale-defaults.ts` 的具名表，介面上會說
// 它們是「台灣住宅的預設值，可以直接改」——跟牆厚 12cm、樓高 280cm 同一個做法。
//
// **只檢查目錄上明確標了需求的品項。** 通用的「走道要 70cm」聽起來最有用，實際上
// 是誤報製造機：沙發離茶几 30cm 是對的，而任何不知道那是茶几的規則都會唸它。寧可
// 少抓，也不要變成一個大家學會忽略的清單。

/** Which face(s) of a piece need room, and how much. Keyed by catalogue id. */
export interface ClearanceNeed {
  /** 至少一側要通過（床、餐桌），而不是每一側都要 */
  anyOf?: ('front' | 'back' | 'left' | 'right')[];
  /** 每一側都要通過（馬桶兩側） */
  allOf?: ('front' | 'back' | 'left' | 'right')[];
  need: number;
  title: string;
  why: string;
}

const FACES: Record<'front' | 'back' | 'left' | 'right', { label: string; dir: (b: Box) => Vec; half: (b: Box) => number }> = {
  front: { label: '前方', dir: b => axesOf(b).front, half: b => b.h / 2 },
  back: { label: '後方', dir: b => ({ x: -axesOf(b).front.x, y: -axesOf(b).front.y }), half: b => b.h / 2 },
  right: { label: '右側', dir: b => axesOf(b).right, half: b => b.w / 2 },
  left: { label: '左側', dir: b => ({ x: -axesOf(b).right.x, y: -axesOf(b).right.y }), half: b => b.w / 2 },
};

/** `item` id → what it needs. Prefixes, so `bed_double` and `bed_single` share one entry. */
export function needsFor(item: string): ClearanceNeed | null {
  const c = CLEARANCE;
  if (/^bed(_|$)/.test(item)) return {
    anyOf: ['left', 'right'], need: c.bedSide,
    title: '床邊下床空間不足',
    why: `床邊到牆、櫃或門面約需 ${c.bedSide}cm，方便下床、鋪床與打掃；至少留一側。`,
  };
  if (/^(dining|roundtable|table_wood|table_round|table_painted)/.test(item)) return {
    anyOf: ['front', 'back'], need: c.diningPullOut,
    title: '餐桌兩側都無法入座',
    why: `拉開餐椅入座約需 ${c.diningPullOut}cm；至少讓一側長邊留得出來。`,
  };
  if (/^toilet/.test(item)) return {
    allOf: ['left', 'right'], need: c.toiletSide,
    title: '馬桶側邊淨空不足',
    why: `馬桶兩側各建議留 ≥${c.toiletSide}cm，起身與清潔才不卡手卡腳。`,
  };
  if (/^(basin|washbasin|sink_bath|vanity)/.test(item)) return {
    allOf: ['front'], need: c.basinFront,
    title: '洗手台前空間不足',
    why: `洗手台前建議 ≥${c.basinFront}cm；若盥洗時後方還要過人，建議再多一些。`,
  };
  if (/^(washer|dryer|fridge|oven|dishwasher)/.test(item)) return {
    allOf: ['front'], need: c.applianceFront,
    title: '設備前方開門空間不足',
    why: `門片或抽屜要完全打開、東西要進得去，前方建議 ≥${c.applianceFront}cm。`,
  };
  if (/^wardrobe/.test(item)) return {
    allOf: ['front'], need: c.wardrobeFront,
    title: '衣櫃前方空間不足',
    why: `開門加上站著拿衣服，櫃前建議 ≥${c.wardrobeFront}cm；滑門可以少一些。`,
  };
  return null;
}

function clearances(furniture: Furniture[], blockers: Box[]): Finding[] {
  const out: Finding[] = [];
  for (const f of furniture) {
    const need = needsFor(f.item);
    if (!need) continue;
    const b = boxOf(f);
    const others = blockers.filter(z => !(z.cx === b.cx && z.cy === b.cy && z.w === b.w && z.h === b.h));
    const measure = (k: keyof typeof FACES) => freeFace(b, FACES[k].dir(b), FACES[k].half(b), others, need.need);

    if (need.anyOf) {
      const got = need.anyOf.map(k => ({ k, d: measure(k) }));
      if (got.some(g => g.d >= need.need)) continue;
      const worstFirst = got.sort((x, y) => y.d - x.d);
      out.push({
        id: `clear:${f.id}:${need.title}:${Math.round(worstFirst[0].d)}`,
        rule: 'clearance-any',
        severity: 'clearance',
        title: need.title,
        detail: `${f.label || f.item}：${got.map(g => `${FACES[g.k].label} ${cm(g.d)}`).join('、')}（至少要留一側 ≥${need.need}cm）`,
        why: need.why,
        targets: [f.id],
      });
      continue;
    }
    for (const k of need.allOf ?? []) {
      const d = measure(k);
      if (d >= need.need) continue;
      out.push({
        id: `clear:${f.id}:${k}:${Math.round(d)}`,
        rule: 'clearance-all',
        severity: 'clearance',
        title: need.title,
        detail: `${f.label || f.item}：${FACES[k].label}只有 ${cm(d)}（建議 ≥${need.need}cm）`,
        why: need.why,
        targets: [f.id],
      });
    }
  }
  return out;
}

/** 門前要開得出來：門扇掃過的那一塊不該被家具佔住。 */
function doorSwings(openings: Opening[], furniture: Furniture[]): Finding[] {
  const out: Finding[] = [];
  for (const o of openings) {
    if (o.kind !== 'door') continue;
    const depth = Math.max(o.width, DEFAULTS.doorWidth);
    const rad = (o.angle ?? 0) * Math.PI / 180;
    const n = { x: -Math.sin(rad), y: Math.cos(rad) };
    const hit = furniture.find(f => {
      const b = boxOf(f);
      // 只看門的兩側各一個探點：門扇真正掃到的區域比這個大，但寧可少抓。
      return [1, -1].some(sgn => insideBox({ x: o.x + n.x * sgn * depth * 0.6, y: o.y + n.y * sgn * depth * 0.6 }, b));
    });
    if (!hit) continue;
    out.push({
      id: `door:${o.id}:${hit.id}`,
      rule: 'door-swing',
      severity: 'clearance',
      title: '門前被家具擋住',
      detail: `門前約 ${Math.round(depth * 0.6)}cm 內有「${hit.label || hit.item}」`,
      why: '門扇要開得完全，而且進出的人需要站的地方。門後放矮櫃很常見，但它會讓門只開得了一半。',
      targets: [o.id, hit.id],
    });
  }
  return out;
}

/** 家具掉在所有房間外面——多半是放的時候沒對到，或牆後來被移走了。 */
function strays(furniture: Furniture[], rooms: Room[]): Finding[] {
  if (!rooms.length) return [];
  const polys = rooms.map(r => (r.poly && r.poly.length >= 3
    ? r.poly
    : [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]));
  const out: Finding[] = [];
  for (const f of furniture) {
    const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    if (polys.some(p => pointInPolygon(c, p))) continue;
    out.push({
      id: `stray:${f.id}`,
      rule: 'stray',
      severity: 'clearance',
      title: '家具在房間外面',
      detail: `「${f.label || f.item}」的中心不在任何房間裡`,
      why: '通常是牆被改過之後家具留在原地，或是放的時候放到室外。出圖與面積報表都不會提到它。',
      targets: [f.id],
    });
  }
  return out;
}

/**
 * 全部跑一遍。
 *
 * 順序就是顯示順序：幾何在前，因為它們有唯一正解、能一鍵修，而且**修完之後淨距那
 * 一組才算得準**——牆沒接上的時候，房間的形狀本來就是錯的。
 */
export function checkPlan(objects: Obj[]): Finding[] {
  const walls = objects.filter(o => o.kind === 'wall') as Wall[];
  const rooms = objects.filter(o => o.kind === 'room') as Room[];
  const furniture = objects.filter(o => o.kind === 'furniture') as Furniture[];
  const openings = objects.filter(o => o.kind === 'door' || o.kind === 'window') as Opening[];

  const blockers: Box[] = [
    ...walls.map(w => wallBox(w.a, w.b, w.thickness)).filter((b): b is Box => !!b),
    ...furniture.map(boxOf),
  ];

  return [
    ...wallJoins(walls),
    ...noRooms(walls, rooms),
    ...clearances(furniture, blockers),
    ...doorSwings(openings, furniture),
    ...strays(furniture, rooms),
  ];
}

/** Everything not silenced. The ignore list is owned by the caller. */
export function visible(findings: Finding[], ignored: ReadonlySet<string>): Finding[] {
  return findings.filter(f => !ignored.has(f.id));
}

export { corners, boxOf, polygonCentroid };
