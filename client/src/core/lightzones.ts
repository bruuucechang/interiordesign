// The parts of a room somebody actually uses, and whether they are lit enough:
// the bed, the desk, the floor in front of a full-height cabinet, the first
// steps inside a door. Plus the switch-group table — every combination of
// groups, what each one gives the room and the bed and the desk.
//
// The zones are the prototype's (`zones`/`zoneStat` in
// docs/lighting-prototype.html), generalised from its axis-aligned boxes to the
// app's rotated furniture: a zone is an oriented box, sampled every 10 cm in its
// own frame. On an unrotated plan the sample points are the prototype's.
//
// Pure: objects in, numbers out.

import type { Furniture, Obj, Opening, Vec } from '../model/schema';
import type { Box } from './clearance';
import { FURNITURE_BY_ID } from '../data/furniture';
import { LIGHTING } from '../model/locale-defaults';
import { COUNTER_ITEMS, VANITY_ITEMS } from '../model/catalogue';
import { LightRoom, Luminaire, PLANES, Source, grid, indirect, inside, isBlocked, lux, reachAt, sources, surfaceArea } from './lighting';
import { fullHeightFurniture, furnitureBox } from './lightmap';

export type ZoneType = 'bed' | 'desk' | 'counter' | 'vanity' | 'cabinet' | 'door';

export interface Zone {
  type: ZoneType;
  /** 「床（床面）」「衣櫃前」 */
  name: string;
  /** What the light there is for. */
  tip: string;
  box: Box;
  /** Plane the zone is measured on, cm. */
  height: number;
  /** Average lux it needs. */
  need: number;
  /** The furniture or door it belongs to. */
  target: string;
}

export interface ZoneStat { avg: number; min: number }

/** Same prefixes as the clearance rules (`health.ts::needsFor`), plus the shop catalogue's beds. */
export const isBed = (item: string) => /^(sh_)?bed(_|\d|$)/.test(item);
export const isDesk = (item: string) => /^desk/.test(item);

const furnitureName = (f: Furniture, fallback: string) => f.label || FURNITURE_BY_ID[f.item]?.name || fallback;

/** Unit vectors along a box's own +x and +y. */
function axes(b: Box): { right: Vec; front: Vec } {
  const a = b.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { right: { x: c, y: s }, front: { x: -s, y: c } };
}

/** A point in a box's own frame (origin at its centre). */
export function toLocal(b: Box, x: number, y: number): Vec {
  const { right, front } = axes(b), dx = x - b.cx, dy = y - b.cy;
  return { x: dx * right.x + dy * right.y, y: dx * front.x + dy * front.y };
}

/** Distance from a point to a box; 0 inside it. */
export function distToBox(b: Box, x: number, y: number): number {
  const l = toLocal(b, x, y);
  return Math.hypot(Math.max(0, Math.abs(l.x) - b.w / 2), Math.max(0, Math.abs(l.y) - b.h / 2));
}

/**
 * Where the head lies on a bed: `pillowInset` in from the headboard, which is
 * the piece's local −y (the catalogue draws the pillows at the top, and placing
 * against a wall turns the back to the wall). `toHead` points from there to the
 * headboard — a light on that side is behind the sleeper's line of sight.
 */
export function pillowPoint(f: Furniture): { x: number; y: number; toHead: Vec } {
  const b = furnitureBox(f), { front } = axes(b), k = f.h / 2 - LIGHTING.pillowInset;
  return { x: b.cx - front.x * k, y: b.cy - front.y * k, toHead: { x: -front.x, y: -front.y } };
}

function distToOutline(p: Vec[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[j], b = p[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    d = Math.min(d, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
  }
  return d;
}


/** The zones in one room, in the prototype's order — beds, desks, then counters and washbasins, cabinets, doors. */
export function roomZones(r: LightRoom, objs: readonly Obj[], ceiling: number): Zone[] {
  const L = LIGHTING;
  const mine = (f: Furniture) => inside(r.poly, f.x + f.w / 2, f.y + f.h / 2);
  const furn = objs.filter((o): o is Furniture => o.kind === 'furniture').filter(mine);
  const out: Zone[] = [];
  for (const f of furn) if (isBed(f.item)) out.push({
    type: 'bed', name: `${furnitureName(f, '床')}（床面）`, tip: '躺著看書另開床頭燈',
    box: furnitureBox(f), height: PLANES.bed, need: L.bedLux, target: f.id,
  });
  for (const f of furn) if (isDesk(f.item)) out.push({
    type: 'desk', name: `${furnitureName(f, '書桌')}桌面`, tip: '寫字建議 300～500，不夠就加檯燈',
    box: furnitureBox(f), height: PLANES.desk, need: L.deskLux, target: f.id,
  });

  // A kitchen counter: its top, at its own height. A sink drawn into a counter
  // run is part of that run, not a second zone on top of it.
  const counters = furn.filter(f => COUNTER_ITEMS.has(f.item));
  for (const f of counters) {
    const b = furnitureBox(f);
    if (counters.some(g => g !== f && g.w * g.h > f.w * f.h && distToBox(furnitureBox(g), b.cx, b.cy) === 0)) continue;
    out.push({
      type: 'counter', name: `${furnitureName(f, '流理台')}面`, tip: '切菜、看清楚火候',
      box: b, height: (f.elevation ?? 0) + (f.height ?? FURNITURE_BY_ID[f.item]?.height ?? PLANES.desk),
      need: L.counterLux, target: f.id,
    });
  }
  // In front of a washbasin: `vanityDepth` deep off its front (local +y, the
  // side placing turns away from the wall), as wide as it is.
  const vd = L.vanityDepth;
  for (const f of furn) if (VANITY_ITEMS.has(f.item)) {
    const b = furnitureBox(f), { front } = axes(b), k = b.h / 2 + vd / 2;
    out.push({
      type: 'vanity', name: `${furnitureName(f, '洗手台')}前`, tip: '洗臉、刮鬍子要看清楚臉',
      box: { cx: b.cx + front.x * k, cy: b.cy + front.y * k, w: b.w, h: vd, angle: b.angle },
      height: PLANES.desk, need: L.vanityLux, target: f.id,
    });
  }

  // In front of a full-height cabinet: its longest face that opens onto the
  // room — not the one against a wall, not the one against another cabinet.
  const d = L.cabinetDepth;
  for (const f of fullHeightFurniture(objs, ceiling).filter(mine)) {
    const b = furnitureBox(f), { right, front } = axes(b);
    const faces = [
      { dir: { x: -right.x, y: -right.y }, half: b.w / 2, len: b.h, across: false },
      { dir: right, half: b.w / 2, len: b.h, across: false },
      { dir: { x: -front.x, y: -front.y }, half: b.h / 2, len: b.w, across: true },
      { dir: front, half: b.h / 2, len: b.w, across: true },
    ].filter(fc => {
      const px = b.cx + fc.dir.x * (fc.half + 10), py = b.cy + fc.dir.y * (fc.half + 10);
      return inside(r.poly, px, py) && !isBlocked(r, px, py);
    }).sort((a, z) => z.len - a.len);
    const fc = faces[0];
    if (!fc) continue;
    out.push({
      type: 'cabinet', name: `${furnitureName(f, '櫃子')}前`, tip: '找衣服、拿東西',
      box: {
        cx: b.cx + fc.dir.x * (fc.half + d / 2), cy: b.cy + fc.dir.y * (fc.half + d / 2),
        w: fc.across ? b.w : d, h: fc.across ? d : b.h, angle: b.angle,
      },
      height: PLANES.desk, need: L.cabinetLux, target: f.id,
    });
  }

  // Inside each door: a strip as wide as the door and `doorDepth` deep, on
  // whichever side of it this room is. A door between two rooms has one in each.
  const dd = L.doorDepth;
  const doorZones: Zone[] = [];
  for (const o of objs) {
    if (o.kind !== 'door') continue;
    const door = o as Opening;
    const reach = reachAt(r, door.x, door.y);
    if (distToOutline(r.poly, door.x, door.y) > reach) continue;
    const a = door.angle * Math.PI / 180, n = { x: -Math.sin(a), y: Math.cos(a) };
    const side = [1, -1].filter(s => inside(r.poly, door.x + n.x * s * reach, door.y + n.y * s * reach));
    if (side.length !== 1) continue;
    const s = side[0];
    doorZones.push({
      type: 'door', name: '門口', tip: '進門就看得清楚',
      box: { cx: door.x + n.x * s * dd / 2, cy: door.y + n.y * s * dd / 2, w: door.width, h: dd, angle: door.angle },
      height: PLANES.desk, need: L.doorLux, target: door.id,
    });
  }
  // Openings carry no name; with two doors in a room they are told apart by number.
  if (doorZones.length > 1) doorZones.forEach((z, i) => { z.name = `門口 ${i + 1}`; });
  return [...out, ...doorZones];
}

/** The lit inputs every sample in a room shares. */
export interface Lit { src: Source[]; ind: number }
export const litBy = (r: LightRoom, lums: readonly Luminaire[], rho: number): Lit => ({
  src: sources(lums), ind: indirect(lums.reduce((a, L) => a + L.lumens, 0), surfaceArea(r), rho),
});

const ZONE_STEP = 10;

/** Average and darkest lux over a zone, every 10 cm, skipping what is outside the room or inside a cabinet. */
export function zoneStat(r: LightRoom, lit: Lit, z: Zone): ZoneStat | null {
  const { right, front } = axes(z.box);
  let sum = 0, cnt = 0, mn = Infinity;
  for (let v = -z.box.h / 2 + ZONE_STEP / 2; v < z.box.h / 2; v += ZONE_STEP) {
    for (let u = -z.box.w / 2 + ZONE_STEP / 2; u < z.box.w / 2; u += ZONE_STEP) {
      const x = z.box.cx + right.x * u + front.x * v, y = z.box.cy + right.y * u + front.y * v;
      if (!inside(r.poly, x, y) || isBlocked(r, x, y)) continue;
      const e = lux(lit.src, x, y, z.height, lit.ind);
      sum += e; cnt++;
      if (e < mn) mn = e;
    }
  }
  return cnt ? { avg: sum / cnt, min: mn } : null;
}

/** ok: meets it; dim: within 70 %; dark: below that. The prototype's three pills. */
export type Verdict = 'ok' | 'dim' | 'dark';
export const verdict = (avg: number, need: number): Verdict => avg >= need ? 'ok' : avg >= need * 0.7 ? 'dim' : 'dark';

export interface Combo {
  circuits: number[];
  lumens: number;
  avg: number; min: number;
  bed: number | null; desk: number | null;
}

/** Past this many switch groups the table would have 2ⁿ − 1 rows; it stops being something to read. */
export const MAX_COMBO_CIRCUITS = 5;
/** The prototype's comparison grid. */
export const COMBO_STEP = 12;

/**
 * Every non-empty set of the room's switch groups, with what it gives: the
 * room's average and darkest point on the desk plane, and the first bed's and
 * desk's averages. `lums` is every light in the room, whatever is switched on.
 */
export function combos(r: LightRoom, lums: readonly Luminaire[], zones: readonly Zone[], rho: number): Combo[] {
  const cs = [...new Set(lums.map(L => L.circuit))].sort((a, b) => a - b);
  if (cs.length > MAX_COMBO_CIRCUITS) return [];
  const bed = zones.find(z => z.type === 'bed'), desk = zones.find(z => z.type === 'desk');
  const out: Combo[] = [];
  for (let m = 1; m < (1 << cs.length); m++) {
    const on = cs.filter((_, i) => m & (1 << i));
    const sub = lums.filter(L => on.includes(L.circuit));
    const g = grid(r, sub, { height: PLANES.desk, rho, step: COMBO_STEP });
    const lit = litBy(r, sub, rho);
    out.push({
      circuits: on, lumens: sub.reduce((a, L) => a + L.lumens, 0), avg: g.avg, min: g.min,
      bed: bed ? zoneStat(r, lit, bed)?.avg ?? null : null,
      desk: desk ? zoneStat(r, lit, desk)?.avg ?? null : null,
    });
  }
  return out;
}
