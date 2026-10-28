// What a room is for, and what it still lacks (B23, docs/spec-game-polish.md §3).
//
// Read off the furniture, the way a game's room recipe works: a bed makes it a
// bedroom, and a bedroom with no light and no wardrobe says so. Pure — a room
// and the floor's objects in, a reading out. Nothing here touches the saved
// name: the screen shows the reading only while the name is still the default
// 「房間」, and once the user names the room theirs wins.
import type { Obj, Vec } from '../model/schema';
import { FURNITURE_BY_ID } from '../data/furniture';
import { pointInPolygon } from './geometry';

export type RoomUseName = '浴室' | '廚房' | '臥室' | '書房' | '餐廳' | '客廳';
export interface RoomReading { use: RoomUseName | null; missing: string[]; }

type Room = Extract<Obj, { kind: 'room' }>;
type Furniture = Extract<Obj, { kind: 'furniture' }>;
/** What roomUse needs from a catalogue entry. */
export interface UseItem { name: string; cat?: string; mount?: string; }

/** The name the draw tool and room detection give a room. */
export const DEFAULT_ROOM_NAME = '房間';
export const isDefaultRoomName = (name: string | undefined) => !name?.trim() || name.trim() === DEFAULT_ROOM_NAME;

const BATH = /馬桶|淋浴間|浴缸|坐浴盆/;
const STOVE = /爐具|雙口爐|爐台/;
const HOOD = /抽油煙機/;
const KITCHEN = /水槽/;
const WARDROBE = /衣櫃/;
const DESK = /書桌/;
const DINING_TABLE = /餐桌|大圓桌|長桌|橡木桌/;
const SOFA = /沙發/;
const SEAT = /椅|凳/;
const LAMP = /燈/, FAN = /扇/;
const EXHAUST = /排風扇|抽風機/;

/**
 * A bed: a name that ends in 床 or reads 床（…）, a bunk, a cot, a bed frame or a
 * sleeping platform. Not a 床頭櫃 — a bedside table ends in 櫃, so the suffix rule
 * already leaves it out, and that is the whole reason the rule is a suffix.
 */
const isBed = (n: string) => {
  const s = n.replace(/\s+[IVX]+$/, '');   // 床頭櫃 II → 床頭櫃
  return /床$/.test(s) || s.includes('床（') || /床架$/.test(s) || s === '上下舖' || s === '榻榻米地台' || s === '布團台';
};
// Something to sit at a desk or a table on — not a footstool, a piano stool, a
// rocker, a lounge chair or a hall bench, which have 椅／凳 in the name too (B23 review).
const NOT_TABLE_SEAT = /貴妃椅|^腳凳|琴凳|搖椅|單椅|扶手椅|長凳|矮凳/;
const isSeat = (n: string) => SEAT.test(n) && !SOFA.test(n) && !NOT_TABLE_SEAT.test(n);
const isDesk = (n: string) => DESK.test(n) && !SEAT.test(n);
const isDiningTable = (n: string) => DINING_TABLE.test(n) && !SEAT.test(n);

/** How far into the room a wall-mounted thing is looked for, cm. */
const WALL_REACH = 30;

const polyOf = (r: Room): Vec[] =>
  r.poly && r.poly.length >= 3 ? r.poly : [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

/**
 * The names a thing on the plan goes by, plus what kind of thing it is.
 * Furniture answers to its catalogue name and to its own label (a piece traced
 * off a drawing is called whatever the drawing called it).
 */
function describe(o: Obj, poly: Vec[], itemOf: (id: string) => UseItem | undefined):
  { names: string[]; lamp: boolean; exhaust: boolean } | null {
  if (o.kind === 'electrical') {
    // Wall fittings sit on the wall's centre line or face, which is the room's
    // edge: step into the room along the way the symbol faces (local -y turned
    // by `angle`, see place.ts fitElectricalToWall) before asking which room.
    let p: Vec = { x: o.x, y: o.y };
    if (o.item === 'wallLight' || o.item === 'batten') {
      const r = o.angle * Math.PI / 180;
      p = { x: o.x + Math.sin(r) * WALL_REACH, y: o.y - Math.cos(r) * WALL_REACH };
    }
    if (!pointInPolygon(p, poly)) return null;
    const light = ['ceilingLight', 'downlight', 'spotlight', 'pendant', 'wallLight', 'batten'].includes(o.item);
    return { names: [], lamp: light, exhaust: o.item === 'exhaust' };
  }
  if (o.kind !== 'furniture') return null;
  const f = o as Furniture;
  const item = itemOf(f.item);
  const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  // A wall-hung piece sits against the wall, a few centimetres from the room's
  // edge (the polygon runs along wall centre lines). Step into the room it faces
  // before asking — (-sin a, cos a), the inward normal fitFurnitureToWall turned
  // it to — so it never counts for the room behind the wall (B23 review).
  const r = (f.angle ?? 0) * Math.PI / 180;
  const p = item?.mount === 'wall' ? { x: c.x - Math.sin(r) * WALL_REACH, y: c.y + Math.cos(r) * WALL_REACH } : c;
  if (!pointInPolygon(p, poly)) return null;
  const names = [item?.name, f.label].filter((n): n is string => !!n && !!n.trim()).map(n => n.trim());
  // A catalogue lamp counts by its category (a 吊扇 is filed under 燈具 and is not one);
  // a traced piece counts by its label.
  const lamp = (item?.cat === '燈具' && !FAN.test(item.name)) || names.some(n => LAMP.test(n) && !FAN.test(n));
  return { names, lamp, exhaust: names.some(n => EXHAUST.test(n)) };
}

const defaultItemOf = (id: string): UseItem | undefined => FURNITURE_BY_ID[id];

/**
 * Read a room's use off what stands in it. First recipe that matches wins, in
 * the spec's order (bathroom > kitchen > bedroom > study > dining > living):
 * a bathroom with a desk in it is still a bathroom.
 */
export function roomUse(room: Room, objs: readonly Obj[], itemOf: (id: string) => UseItem | undefined = defaultItemOf): RoomReading {
  const poly = polyOf(room);
  const names: string[] = [];
  let lamp = false, exhaust = false;
  for (const o of objs) {
    if (o === room) continue;
    const d = describe(o, poly, itemOf);
    if (!d) continue;
    names.push(...d.names);
    lamp ||= d.lamp; exhaust ||= d.exhaust;
  }
  const has = (f: (n: string) => boolean) => names.some(f);
  const re = (r: RegExp) => (n: string) => r.test(n);

  let use: RoomUseName | null = null;
  const missing: string[] = [];
  if (has(re(BATH))) {
    use = '浴室';
    if (!lamp) missing.push('燈');
    if (!exhaust) missing.push('排風扇');
  } else if (has(re(STOVE)) || has(re(KITCHEN)) || has(re(HOOD))) {
    use = '廚房';
    if (!lamp) missing.push('燈');
    if (has(re(STOVE)) && !has(re(HOOD))) missing.push('抽油煙機');
  } else if (has(isBed)) {
    use = '臥室';
    if (!lamp) missing.push('燈');
    if (!has(re(WARDROBE))) missing.push('衣櫃');
  } else if (has(isDesk)) {
    use = '書房';
    if (!lamp) missing.push('燈');
    if (!has(isSeat)) missing.push('椅子');
  } else if (has(isDiningTable)) {
    use = '餐廳';
    if (!lamp) missing.push('燈');
    if (!has(isSeat)) missing.push('餐椅');
  } else if (has(re(SOFA))) {
    use = '客廳';
    if (!lamp) missing.push('燈');
  }
  return { use, missing };
}

/** The name to show: the reading while the saved name is the default, the user's name otherwise. Untranslated. */
export function shownRoomName(room: Room, reading: RoomReading): string {
  if (isDefaultRoomName(room.name)) return reading.use ?? DEFAULT_ROOM_NAME;
  return room.name;
}
