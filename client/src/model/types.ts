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

export type ObjKind = 'wall' | 'room' | 'door' | 'window' | 'furniture' | 'dimension';

interface Base { id: string; layer: LayerId; }

// `bulge` (cm) curves the wall into an arc — signed apex offset from the chord; 0/undefined = straight.
// `height` (cm) is the 3D wall height (defaults to WALL_H). `color` is the wall finish (hex).
export interface Wall extends Base { kind: 'wall'; a: Vec; b: Vec; thickness: number; bulge?: number; height?: number; color?: string; }
// x,y,w,h is the bounding box (used for handles/labels). `poly`, when present,
// makes the room an arbitrary polygon auto-closed from surrounding walls.
// `auto` marks rooms created by wall-loop detection (they track the walls until
// the user renames/moves them, which detaches them into normal rooms).
// `floor` picks the floor finish: 'wood' | 'tile' | a hex color (default wood).
export interface Room extends Base { kind: 'room'; x: number; y: number; w: number; h: number; name: string; poly?: Vec[]; auto?: boolean; floor?: string; }
// `height` (cm) = opening height; `elevation` (cm) = sill height above the floor.
// `bulge` (cm) curves the opening to follow a curved wall (windows).
export interface Opening extends Base { kind: 'door' | 'window'; x: number; y: number; width: number; angle: number; height?: number; elevation?: number; bulge?: number; }
// `height` (cm) overrides the model's natural 3D height; `elevation` (cm) lifts it off the floor.
export interface Furniture extends Base { kind: 'furniture'; item: string; x: number; y: number; w: number; h: number; angle: number; label: string; height?: number; elevation?: number; }
export interface Dimension extends Base { kind: 'dimension'; a: Vec; b: Vec; offset: number; }

export type Obj = Wall | Room | Opening | Furniture | Dimension;

export interface Project {
  id: string;
  name: string;
  layers: Layer[];
  objects: Obj[];
}

export const LAYER_IDS = {
  walls: 'walls', rooms: 'rooms', openings: 'openings', furniture: 'furniture', dims: 'dims',
} as const;

export function defaultLayers(): Layer[] {
  return [
    { id: 'walls', name: '牆體', visible: true, locked: false, color: '#c9cfdb' },
    { id: 'rooms', name: '房間', visible: true, locked: false, color: '#6d7890' },
    { id: 'openings', name: '門窗', visible: true, locked: false, color: '#7bc6ff' },
    { id: 'furniture', name: '家具', visible: true, locked: false, color: '#e0b45a' },
    { id: 'dims', name: '尺寸標註', visible: true, locked: false, color: '#8bffb0' },
  ];
}

// which layer a newly created object of a kind belongs to
export function layerForKind(kind: ObjKind): LayerId {
  if (kind === 'wall') return 'walls';
  if (kind === 'room') return 'rooms';
  if (kind === 'door' || kind === 'window') return 'openings';
  if (kind === 'furniture') return 'furniture';
  return 'dims';
}
