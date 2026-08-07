// The runtime companion to schema.ts: the catalogues a plan's fields refer to,
// the default layer set, and the mapping from object kind to layer.
//
// These live apart from the schema because they are values, not shapes. The
// codegen that feeds the backend reads schema.ts only, so anything with a
// runtime body has to be here or it would quietly vanish from the generated
// definitions.

import { ElectricalId, LayerId, Layer, ObjKind } from './schema';

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
  { id: 'exhaust',     name: '排風扇',   mount: 'ceiling', elevation: 270, cat: '燈具' },
];
export const ELECTRICAL_BY_ID: Record<string, ElectricalSpec> =
  Object.fromEntries(ELECTRICAL.map(e => [e.id, e]));

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
  if (kind === 'room') return 'rooms';
  if (kind === 'door' || kind === 'window') return 'openings';
  if (kind === 'furniture') return 'furniture';
  if (kind === 'electrical') return 'electrical';
  return 'dims';
}
