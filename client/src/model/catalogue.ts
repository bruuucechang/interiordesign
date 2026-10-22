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
};

/** T5 battens by length in feet: 舞光 3000K datasheet figures. */
export const T5_SIZES: Record<T5Size, { length: number; lumens: number; watts: number }> = {
  1: { length: 31.2,  lumens: 550,  watts: 5 },
  2: { length: 61.2,  lumens: 1000, watts: 9 },
  3: { length: 91.2,  lumens: 1540, watts: 14 },
  4: { length: 119.4, lumens: 2000, watts: 18 },
};
export const T5_DEFAULT_SIZE: T5Size = 4;
/** A batten sits this far below the ceiling when no elevation is given (cove lighting). */
export const T5_BELOW_CEILING = 15;

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
  if (kind === 'door' || kind === 'window') return 'openings';
  if (kind === 'furniture') return 'furniture';
  if (kind === 'electrical') return 'electrical';
  return 'dims';
}
