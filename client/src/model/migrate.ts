// Bringing a saved plan up to the schema this build understands.
//
// The client owns the document schema, so it owns the migrations too, and this
// is the only implementation of them: the backfill script that upgrades stored
// plans runs this same function rather than reimplementing it in Python.
//
// Two different things happen here, and they are kept apart on purpose:
//
//   STEPS    version-gated, run once, each one moving a plan up by exactly one
//            version. A step may assume every earlier step has already run.
//   repair   idempotent fixes that run every load, for damage that is not a
//            schema change — a default layer added since the plan was saved,
//            an activeFloorId pointing at a floor that was deleted.
//
// Adding a breaking change means: add a step, bump SCHEMA_VERSION, and run
// `npm run backfill` so the stored plans move with it. Plans reached only
// through the offline mirror never see the backfill, which is fine — they are
// migrated the next time they are opened, and saved back on the next edit.

import { Project, Floor, Layer } from './schema';
import { defaultLayers } from './catalogue';
import { genId } from './ids';

export const SCHEMA_VERSION = 1;

// The ceiling height beams used to hang from. Frozen at the value it had when
// beams were reshaped — a migration describes what the data meant back then, so
// it must not follow WALL_H if that ever changes.
const LEGACY_CEILING_H = 270;

/** STEPS[v] upgrades a plan from version v to version v+1. */
const STEPS: ((p: any) => void)[] = [
  // 0 -> 1. Version 0 is every plan saved before this stamp existed, which
  // covers two shape changes that were never migrated at the time.
  (p) => {
    // Before floors, a plan kept its objects in one top-level list.
    if (!Array.isArray(p.floors) || !p.floors.length) {
      const floor: Floor = { ...blankFloor(), objects: Array.isArray(p.objects) ? p.objects : [] };
      p.floors = [floor];
      p.activeFloorId = floor.id;
    }
    delete p.objects;

    // A beam used to hang from the ceiling, dropping `depth` cm. It now stands
    // on its own: `height` tall with its underside `elevation` off the floor.
    // Same solid, described from the other end.
    for (const f of p.floors) {
      for (const o of f.objects ?? []) {
        if (o?.kind !== 'beam' || typeof o.depth !== 'number') continue;
        if (typeof o.height !== 'number') o.height = o.depth;
        if (typeof o.elevation !== 'number') o.elevation = LEGACY_CEILING_H - o.depth;
        delete o.depth;
      }
    }
  },
];

function blankFloor(): Floor {
  return { id: genId('floor'), name: '1F', elevation: 0, height: 280, objects: [] };
}

function repair(p: any): void {
  if (typeof p.id !== 'string' || !p.id) p.id = genId('proj');
  if (typeof p.name !== 'string') p.name = '未命名平面圖';
  // Not only reachable through the migration steps: a plan already stamped at
  // the current version can still arrive with no floors at all.
  if (!Array.isArray(p.floors) || !p.floors.length) p.floors = [blankFloor()];
  // A floor written without its stacking values — some very early saves, and
  // anything hand-assembled — would otherwise be unreadable rather than merely
  // sitting at the default storey height.
  for (const f of p.floors) {
    if (!Array.isArray(f.objects)) f.objects = [];
    if (typeof f.elevation !== 'number') f.elevation = 0;
    if (typeof f.height !== 'number') f.height = 280;
  }
  if (!Array.isArray(p.layers) || !p.layers.length) p.layers = defaultLayers();
  // A plan saved before a layer existed has no entry for it, and the renderer
  // only draws objects whose layer it can find — so back-fill the missing ones
  // rather than leaving those objects invisible.
  for (const def of defaultLayers()) {
    if (!p.layers.some((l: Layer) => l.id === def.id)) {
      const before = p.layers.findIndex((l: Layer) => l.id === 'dims');
      p.layers.splice(before < 0 ? p.layers.length : before, 0, def);
    }
  }
  if (!p.floors.find((f: Floor) => f.id === p.activeFloorId)) {
    p.activeFloorId = p.floors[0].id;
  }
}

/** Whether `migrate` would change this plan's version. */
export function needsMigration(raw: unknown): boolean {
  const v = (raw as any)?.schemaVersion;
  return !(typeof v === 'number' && v >= SCHEMA_VERSION);
}

/**
 * The plan as this build understands it. Mutates and returns `raw`.
 *
 * A plan stamped with a *newer* version than this build is left at its own
 * version rather than being dragged backwards: an older client should not
 * quietly rewrite a document it does not fully understand.
 */
export function migrate(raw: unknown): Project {
  const p: any = raw && typeof raw === 'object' ? raw : {};
  let v = typeof p.schemaVersion === 'number' ? p.schemaVersion : 0;
  for (; v < SCHEMA_VERSION; v++) STEPS[v](p);
  p.schemaVersion = v;
  repair(p);
  return p as Project;
}
