// All spatial units are centimeters (cm). The viewport converts cm <-> pixels.

export interface Vec { x: number; y: number; }

export type LayerId = string;

export interface Layer {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
}

export type ObjKind = 'wall' | 'beam' | 'room' | 'door' | 'window' | 'furniture' | 'dimension' | 'image' | 'electrical';

// `group`, when set, ties objects together: selecting any one of them selects
// them all, so every operation that already works on a multi-selection —
// moving, scaling, duplicating, deleting — works on the group for free.
interface Base { id: string; layer: LayerId; group?: string; }

// `bulge` (cm) curves the wall into an arc — signed apex offset from the chord; 0/undefined = straight.
// `height` (cm) is the 3D wall height (defaults to WALL_H). `color` is the wall finish (hex).
export interface Wall extends Base { kind: 'wall'; a: Vec; b: Vec; thickness: number; bulge?: number; height?: number; color?: string; }
// A beam: `width` across, `height` tall, its underside `elevation` cm off the floor.
export interface Beam extends Base { kind: 'beam'; a: Vec; b: Vec; width: number; height: number; elevation: number; }
// x,y,w,h is the bounding box (used for handles/labels). `poly`, when present,
// makes the room an arbitrary polygon auto-closed from surrounding walls.
// `auto` marks rooms created by wall-loop detection (they track the walls until
// the user renames/moves them, which detaches them into normal rooms).
// `floor` picks the floor finish: 'wood' | 'tile' | a hex color (default wood).
export interface Room extends Base { kind: 'room'; x: number; y: number; w: number; h: number; name: string; poly?: Vec[]; auto?: boolean; floor?: string; }
// `height` (cm) = opening height; `elevation` (cm) = sill height above the floor.
// `bulge` (cm) curves the opening to follow a curved wall (windows).
// `style` selects the leaf/sash form (see DOOR_STYLES / WINDOW_STYLES).
export interface Opening extends Base { kind: 'door' | 'window'; x: number; y: number; width: number; angle: number; height?: number; elevation?: number; bulge?: number; style?: string; }

// Selectable door/window forms. `id` is stored on the opening; the 2D renderer
// and the 3D view both branch on it. First entry is the default.
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
// `height` (cm) overrides the model's natural 3D height; `elevation` (cm) lifts it off the floor.
// `color` (hex) recolours the piece in both views; unset keeps the catalogue's own finish.
export interface Furniture extends Base { kind: 'furniture'; item: string; x: number; y: number; w: number; h: number; angle: number; label: string; height?: number; elevation?: number; color?: string; }
export interface Dimension extends Base { kind: 'dimension'; a: Vec; b: Vec; offset: number; }
// A traceable background image (floor-plan underlay). `src` is a data URL.
export interface ImageObj extends Base { kind: 'image'; x: number; y: number; w: number; h: number; src: string; opacity: number; }

// An electrical fitting: socket, switch or luminaire. Drawn with the symbols a
// Taiwanese 配置圖 uses. `angle` orients wall-mounted items so they read as
// facing into the room; ceiling items ignore it.
export interface Electrical extends Base {
  kind: 'electrical';
  item: ElectricalId;
  x: number; y: number;
  angle: number;
  /** Height above the floor (cm). Sockets sit low, switches at handle height. */
  elevation?: number;
  label?: string;
}

export type ElectricalId =
  | 'socket' | 'socket2' | 'socketWater' | 'tv' | 'network'
  | 'switch1' | 'switch2' | 'switch3'
  | 'ceilingLight' | 'downlight' | 'spotlight' | 'pendant' | 'wallLight' | 'exhaust';

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

export type Obj = Wall | Beam | Room | Opening | Furniture | Dimension | ImageObj | Electrical;

// A building level: its own objects, stacked in 3D at `elevation` (cm).
export interface Floor {
  id: string;
  name: string;
  elevation: number;   // cm above ground
  height: number;      // cm, level-to-level
  objects: Obj[];
}

export interface Project {
  id: string;
  name: string;
  layers: Layer[];
  floors: Floor[];
  activeFloorId: string;
}

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
