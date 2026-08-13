// The saved-document schema — and nothing else.
//
// This file is the single source of truth for the shape of a stored plan. It is
// the input to `npm run codegen`, which turns it into schema/plan.schema.json
// and from there into server/app/plan_schema.py, so the backend reads plans
// through the same definitions instead of guessing at dictionary keys.
//
// Therefore: **types only**. No constants, no functions, no imports. Anything
// runtime — catalogues, defaults, lookup helpers — belongs in catalogue.ts.
// A value added here would be silently dropped by the generator and the two
// sides would drift apart again, which is exactly what the split prevents.
//
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

export type ObjKind = 'wall' | 'beam' | 'partition' | 'room' | 'door' | 'window' | 'furniture' | 'dimension' | 'image' | 'electrical';

// `group`, when set, ties objects together: selecting any one of them selects
// them all, so every operation that already works on a multi-selection —
// moving, scaling, duplicating, deleting — works on the group for free.
interface Base { id: string; layer: LayerId; group?: string; }

// `bulge` (cm) curves the wall into an arc — signed apex offset from the chord; 0/undefined = straight.
// `height` (cm) is the 3D wall height (defaults to WALL_H).
// `finish` names a material from core/materials.ts (paint, brick, walltile…).
// `color` is a plain hex fill and *wins over* `finish` — it is the older field
// and plans in the wild carry it; a wall that has both was painted a colour on
// purpose, and silently switching it to a texture would repaint the plan.
export interface Wall extends Base { kind: 'wall'; a: Vec; b: Vec; thickness: number; bulge?: number; height?: number; color?: string; finish?: string; }
// A partition line: divides an area without a physical wall — an open kitchen
// off a dining room, a hallway counted separately from the space it runs
// through. It closes a region for room detection and area take-off, and that is
// all it does: nothing is built for it in 3D and nothing is quantified from it.
export interface Partition extends Base { kind: 'partition'; a: Vec; b: Vec; }
// A beam: `width` across, `height` tall, its underside `elevation` cm off the floor.
export interface Beam extends Base { kind: 'beam'; a: Vec; b: Vec; width: number; height: number; elevation: number; }
// x,y,w,h is the bounding box (used for handles/labels). `poly`, when present,
// makes the room an arbitrary polygon auto-closed from surrounding walls.
// `auto` marks rooms created by wall-loop detection (they track the walls until
// the user renames/moves them, which detaches them into normal rooms).
// `floor` picks the floor finish: a material id from core/materials.ts
// ('wood' | 'walnut' | 'tile' | 'marble' | …) or a hex colour. Unknown ids fall
// back to the first floor material, so an old plan naming a removed one still
// renders — as the wrong floor, but never as nothing.
export interface Room extends Base { kind: 'room'; x: number; y: number; w: number; h: number; name: string; poly?: Vec[]; auto?: boolean; floor?: string; }
// `height` (cm) = opening height; `elevation` (cm) = sill height above the floor.
// `bulge` (cm) curves the opening to follow a curved wall (windows).
// `style` selects the leaf/sash form (see DOOR_STYLES / WINDOW_STYLES in catalogue.ts).
// `hinge` is which end of the opening the door is hung on and `swing` is which
// side it opens to, both read along the opening's own `angle`. Four
// combinations, which is what a door has. Absent means left-hung, opening back
// — the only thing that was drawable before, and the reason a plan could not
// say whether a door swings into the room or into the corridor.
export type Hinge = 'left' | 'right';
export type Swing = 'in' | 'out';
export interface Opening extends Base { kind: 'door' | 'window'; x: number; y: number; width: number; angle: number; height?: number; elevation?: number; bulge?: number; style?: string; hinge?: Hinge; swing?: Swing; }
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

export type Obj = Wall | Beam | Partition | Room | Opening | Furniture | Dimension | ImageObj | Electrical;

// A building level: its own objects, stacked in 3D at `elevation` (cm).
export interface Floor {
  id: string;
  name: string;
  elevation: number;   // cm above ground
  height: number;      // cm, level-to-level
  objects: Obj[];
}

export interface Project {
  /**
   * Which revision of this schema the plan was written against. Bumped only by
   * a change that older plans cannot satisfy; migrate.ts holds the step that
   * moves a plan up to it, and the backend can then assume one shape.
   */
  schemaVersion: number;
  id: string;
  name: string;
  layers: Layer[];
  floors: Floor[];
  activeFloorId: string;
}
