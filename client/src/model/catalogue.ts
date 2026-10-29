// The runtime companion to schema.ts: the catalogues a plan's fields refer to,
// the default layer set, and the mapping from object kind to layer.
//
// These live apart from the schema because they are values, not shapes. The
// codegen that feeds the backend reads schema.ts only, so anything with a
// runtime body has to be here or it would quietly vanish from the generated
// definitions.

import { ElectricalId, LayerId, Layer, ObjKind, T5Size } from './schema';

// Selectable door/window forms. `id` is stored on the opening (Opening.style);
// the 2D renderer and the 3D view both branch on it. First entry is the default.
export const DOOR_STYLES = [
  { id: 'single', label: '單開門' },
  { id: 'double', label: '雙開門' },
  { id: 'sliding', label: '推拉門' },
  { id: 'glass', label: '玻璃門' },
];
export const WINDOW_STYLES = [
  { id: 'single', label: '格窗' },
  { id: 'sliding', label: '橫拉窗' },
  { id: 'casement', label: '平開窗' },
  { id: 'picture', label: '景觀窗' },
];

export interface ElectricalSpec {
  id: ElectricalId;
  name: string;
  /** 'wall' items snap onto a wall; 'ceiling' items are placed anywhere in a room. */
  mount: 'wall' | 'ceiling';
  /** Default height above the floor, in cm — the values Taiwanese practice uses. */
  elevation: number;
  cat: string;
  /** B29: which palette row a luminaire sits in; absent = the original 燈位與排風 row. */
  series?: '鋁擠燈' | '崁燈系列';
}

// Defaults follow common Taiwanese practice: general sockets at 30 cm, sockets
// over a counter at 110 cm, switches at 120 cm.
export const ELECTRICAL: ElectricalSpec[] = [
  { id: 'socket',      name: '單插座',   mount: 'wall',    elevation: 30,  cat: '插座' },
  { id: 'socket2',     name: '雙插座',   mount: 'wall',    elevation: 30,  cat: '插座' },
  { id: 'socketWater', name: '防水插座', mount: 'wall',    elevation: 110, cat: '插座' },
  { id: 'tv',          name: '電視出線', mount: 'wall',    elevation: 60,  cat: '插座' },
  { id: 'network',     name: '網路出線', mount: 'wall',    elevation: 30,  cat: '插座' },
  { id: 'switch1',     name: '單切開關', mount: 'wall',    elevation: 120, cat: '開關' },
  { id: 'switch2',     name: '雙切開關', mount: 'wall',    elevation: 120, cat: '開關' },
  { id: 'switch3',     name: '三切開關', mount: 'wall',    elevation: 120, cat: '開關' },
  { id: 'ceilingLight', name: '吸頂燈',  mount: 'ceiling', elevation: 270, cat: '燈具' },
  { id: 'downlight',   name: '崁燈',     mount: 'ceiling', elevation: 270, cat: '燈具' },
  { id: 'spotlight',   name: '投射燈',   mount: 'ceiling', elevation: 270, cat: '燈具' },
  { id: 'pendant',     name: '吊燈',     mount: 'ceiling', elevation: 200, cat: '燈具' },
  { id: 'wallLight',   name: '壁燈',     mount: 'wall',    elevation: 180, cat: '燈具' },
  { id: 'batten',      name: 'T5 層板燈', mount: 'wall',   elevation: 265, cat: '燈具' },
  { id: 'exhaust',     name: '排風扇',   mount: 'ceiling', elevation: 270, cat: '燈具' },
  // B29 (docs/spec-luxury.md §2). Linear lights run along the symbol's local x
  // and are as long as `Electrical.length`; the two ceiling ones light the floor
  // below, the wall ones the side they face.
  { id: 'linearRecessed', name: '嵌入式鋁擠線燈', mount: 'ceiling', elevation: 270, cat: '燈具', series: '鋁擠燈' },
  { id: 'linearSurface',  name: '明裝鋁擠線燈',   mount: 'ceiling', elevation: 270, cat: '燈具', series: '鋁擠燈' },
  { id: 'linearCove',     name: '間接燈槽',       mount: 'wall',    elevation: 265, cat: '燈具', series: '鋁擠燈' },
  { id: 'linearWash',     name: '洗牆鋁擠燈',     mount: 'wall',    elevation: 265, cat: '燈具', series: '鋁擠燈' },
  { id: 'linearShelf',    name: '櫃內層板燈',     mount: 'wall',    elevation: 180, cat: '燈具', series: '鋁擠燈' },
  { id: 'dlFrameless', name: '無邊框崁燈',       mount: 'ceiling', elevation: 270, cat: '燈具', series: '崁燈系列' },
  { id: 'dlDeep',      name: '深藏防眩崁燈',     mount: 'ceiling', elevation: 270, cat: '燈具', series: '崁燈系列' },
  { id: 'dlAdjust',    name: '可調角度投射崁燈', mount: 'ceiling', elevation: 270, cat: '燈具', series: '崁燈系列' },
  { id: 'dlWash',      name: '洗牆崁燈',         mount: 'ceiling', elevation: 270, cat: '燈具', series: '崁燈系列' },
  { id: 'dlTwin',      name: '雙頭格柵崁燈',     mount: 'ceiling', elevation: 270, cat: '燈具', series: '崁燈系列' },
];
export const ELECTRICAL_BY_ID: Record<string, ElectricalSpec> =
  Object.fromEntries(ELECTRICAL.map(e => [e.id, e]));

/**
 * How each luminaire lights a room, before the user overrides it on the object.
 * These are typical values, not facts (design-rules 9.5.4): the downlight is a
 * 9 cm 8 W unit's datasheet, the rest are the usual order of magnitude.
 *
 * `down` lights are Lambertian-like cosⁿ sources pointing at the floor, with n
 * derived from `beam` (120° → n = 1). `tube` lights are a line of half-cylinder
 * segments that light the side the symbol faces; `length` is the tube's.
 */
export type LightDistribution =
  | { type: 'down'; beam: number }
  | { type: 'tube'; length: number };
export interface LightSpec { lumens: number; watts: number; dist: LightDistribution; }

export const LIGHT_DEFAULTS: Partial<Record<ElectricalId, LightSpec>> = {
  downlight:    { lumens: 720,  watts: 8,  dist: { type: 'down', beam: 120 } },
  ceilingLight: { lumens: 3000, watts: 40, dist: { type: 'down', beam: 120 } },
  spotlight:    { lumens: 600,  watts: 7,  dist: { type: 'down', beam: 36 } },
  pendant:      { lumens: 1000, watts: 12, dist: { type: 'down', beam: 120 } },
  wallLight:    { lumens: 400,  watts: 5,  dist: { type: 'tube', length: 20 } },
  // B29 downlights, 3000K. The 7.5 cm units are OSRAM's 7 W 560 lm (Costco TW
  // listing, 2026-10); the rest are the same order for their wattage. An
  // adjustable or wall-wash head is still counted pointing straight down —
  // the maths has no aim (lighting.ts).
  dlFrameless: { lumens: 560,  watts: 7,  dist: { type: 'down', beam: 60 } },
  dlDeep:      { lumens: 800,  watts: 10, dist: { type: 'down', beam: 36 } },
  dlAdjust:    { lumens: 560,  watts: 7,  dist: { type: 'down', beam: 24 } },
  dlWash:      { lumens: 750,  watts: 10, dist: { type: 'down', beam: 80 } },
  dlTwin:      { lumens: 1100, watts: 14, dist: { type: 'down', beam: 36 } },
};

/**
 * LED aluminium linear lights (B29), 3000K, per metre of light. Recessed and
 * surface profiles are a 10 W/m, 800 lm/m strip behind a diffuser (DIALux
 * listing of a typical profile); a cove is the bare 8 W/m, 800 lm/m strip
 * (舞光 2835 strip); a wall washer is a denser 12 W/m; a shelf light a 5 W/m
 * strip in a slim profile. `length` (cm) is the default and its bounds — a run
 * longer than 6 m is two drivers and two objects.
 *
 * `down` ones light the floor below as a row of cosⁿ sources; `tube` ones are
 * mounted on a wall or cabinet face like a T5 and light the side they face,
 * hanging `belowCeiling` under the ceiling when no elevation is stored.
 */
export interface LinearSpec {
  lmPerM: number; wPerM: number;
  length: { def: number; min: number; max: number };
  dist: { type: 'down'; beam: number } | { type: 'tube'; belowCeiling?: number };
}
export const LINEAR_LIGHTS: Partial<Record<ElectricalId, LinearSpec>> = {
  linearRecessed: { lmPerM: 800,  wPerM: 10, length: { def: 120, min: 30, max: 600 }, dist: { type: 'down', beam: 110 } },
  linearSurface:  { lmPerM: 1000, wPerM: 12, length: { def: 120, min: 30, max: 600 }, dist: { type: 'down', beam: 120 } },
  linearCove:     { lmPerM: 800,  wPerM: 8,  length: { def: 240, min: 30, max: 600 }, dist: { type: 'tube', belowCeiling: 15 } },
  linearWash:     { lmPerM: 900,  wPerM: 12, length: { def: 180, min: 30, max: 600 }, dist: { type: 'tube', belowCeiling: 5 } },
  linearShelf:    { lmPerM: 400,  wPerM: 5,  length: { def: 60,  min: 20, max: 240 }, dist: { type: 'tube' } },
};

/** T5 battens by length in feet: 舞光 3000K datasheet figures. */
export const T5_SIZES: Record<T5Size, { length: number; lumens: number; watts: number }> = {
  1: { length: 31.2,  lumens: 550,  watts: 5 },
  2: { length: 61.2,  lumens: 1000, watts: 9 },
  3: { length: 91.2,  lumens: 1540, watts: 14 },
  4: { length: 119.4, lumens: 2000, watts: 18 },
};
/** Does this fitting give light (a T5, a catalogue luminaire or a B29 linear light)? */
export const isLightItem = (id: string) => id === 'batten' || !!LIGHT_DEFAULTS[id as ElectricalId] || !!LINEAR_LIGHTS[id as ElectricalId];
/** Lights mounted on a wall or cabinet face that light the side they face (step into the room along it to find their room). */
export const isWallLight = (id: string) => id === 'batten' || id === 'wallLight' || (LINEAR_LIGHTS[id as ElectricalId]?.dist.type === 'tube');
export const T5_DEFAULT_SIZE: T5Size = 4;
/** A batten sits this far below the ceiling when no elevation is given (cove lighting). */
export const T5_BELOW_CEILING = 15;
/** How far under the ceiling a fitting hangs when it has no elevation of its own (a T5, a cove or wall-wash strip), or undefined if it has a fixed height. */
export function belowCeiling(id: string): number | undefined {
  if (id === 'batten') return T5_BELOW_CEILING;
  const d = LINEAR_LIGHTS[id as ElectricalId]?.dist;
  return d?.type === 'tube' ? d.belowCeiling : undefined;
}

/**
 * Furniture that gets a lit work zone of its own (`core/lightzones.ts`): the
 * top of a kitchen counter, measured at its own height, and the floor in front
 * of a washbasin. A cooktop or oven is not a counter — it sits in one, and the
 * counter's zone already covers it. Targets are `LIGHTING.counterLux`/`vanityLux`.
 */
export const COUNTER_ITEMS: ReadonlySet<string> = new Set([
  'cabinet_kitchen', 'kitchen_island', 'sink', 'sh_cab_sink', 'sh_cab_lower', 'sh_cab_corner', 'sh_cab_drawers',
  'cabinet_kitchen_lx', 'cabinet_kitchen_lx_sink', 'cabinet_kitchen_lx_hob', 'kitchen_island_lx',
]);
export const VANITY_ITEMS: ReadonlySet<string> = new Set(['vanity', 'sh_vanity', 'sh_washbasin', 'vanity_lx']);
/** Worktop height where a piece's catalogue height is not its top: the shop sink unit's 121 includes the tap. */
export const COUNTER_TOP: Readonly<Record<string, number>> = { sh_cab_sink: 88, cabinet_kitchen_lx_sink: 90 };

/**
 * The default layers.
 *
 * The names are stored **in the plan**, so they are data, not interface — a
 * plan created in one language and opened in another must not silently change
 * what its layers are called, and a layer the user renamed must keep the name
 * they typed. So these stay canonical here and are translated where they are
 * *drawn* (`buildLayers`), which leaves a renamed layer untouched because its
 * name is not a key in any dictionary.
 */
export function defaultLayers(): Layer[] {
  return [
    { id: 'underlay', name: '底圖', visible: true, locked: false, color: '#8b93a3' },
    { id: 'walls', name: '牆體', visible: true, locked: false, color: '#c9cfdb' },
    { id: 'beams', name: '樑', visible: true, locked: false, color: '#b07de0' },
    { id: 'rooms', name: '房間', visible: true, locked: false, color: '#6d7890' },
    { id: 'openings', name: '門窗', visible: true, locked: false, color: '#7bc6ff' },
    { id: 'furniture', name: '家具', visible: true, locked: false, color: '#e0b45a' },
    { id: 'electrical', name: '水電配置', visible: true, locked: false, color: '#ffd166' },
    { id: 'dims', name: '尺寸標註', visible: true, locked: false, color: '#8bffb0' },
  ];
}

// which layer a newly created object of a kind belongs to
export function layerForKind(kind: ObjKind): LayerId {
  if (kind === 'image') return 'underlay';
  if (kind === 'wall') return 'walls';
  if (kind === 'beam') return 'beams';
  if (kind === 'partition') return 'rooms';   // it exists to make rooms, so it hides with them
  if (kind === 'room') return 'rooms';
  if (kind === 'area') return 'rooms';        // drawn inside rooms, hides with them
  if (kind === 'door' || kind === 'window') return 'openings';
  if (kind === 'furniture') return 'furniture';
  if (kind === 'electrical') return 'electrical';
  return 'dims';
}
