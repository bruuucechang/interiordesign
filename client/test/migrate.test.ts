import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, needsMigration, SCHEMA_VERSION } from '../src/model/migrate';
import { Doc } from '../src/model/doc';

// A pre-floors save, the shape 60 of the 147 stored plans still have: objects
// in one top-level list, no floors, no version stamp.
const legacy = () => ({
  id: 'proj_old',
  name: '舊檔',
  layers: [{ id: 'walls', name: '牆體', visible: true, locked: false, color: '#c9cfdb' }],
  objects: [
    { id: 'w1', kind: 'wall', layer: 'walls', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 12 },
  ],
});

test('a pre-floors plan keeps its objects, on a floor', () => {
  const p: any = migrate(legacy());
  assert.equal(p.floors.length, 1);
  assert.equal(p.floors[0].objects.length, 1);
  assert.equal(p.floors[0].objects[0].id, 'w1');
  assert.equal(p.activeFloorId, p.floors[0].id);
  assert.equal(p.objects, undefined, 'the old list must not linger alongside the floor');
});

test('migrating stamps the current version', () => {
  assert.equal((migrate(legacy()) as any).schemaVersion, SCHEMA_VERSION);
});

test('migration is idempotent', () => {
  const once = migrate(legacy());
  const twice = migrate(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test('a plan already at the current version is left at it', () => {
  const p: any = migrate({
    schemaVersion: SCHEMA_VERSION, id: 'p', name: 'n', layers: [],
    activeFloorId: 'f', floors: [{ id: 'f', name: '1F', elevation: 0, height: 280, objects: [] }],
  });
  assert.equal(p.schemaVersion, SCHEMA_VERSION);
  assert.equal(p.floors[0].id, 'f');
});

test('a plan from a newer client is not dragged backwards', () => {
  const future = {
    schemaVersion: SCHEMA_VERSION + 5, id: 'p', name: 'n', layers: [],
    activeFloorId: 'f', floors: [{ id: 'f', name: '1F', elevation: 0, height: 280, objects: [] }],
  };
  assert.equal((migrate(future) as any).schemaVersion, SCHEMA_VERSION + 5);
});

test('needsMigration only says yes when the version is behind', () => {
  assert.equal(needsMigration(legacy()), true);
  assert.equal(needsMigration({ schemaVersion: SCHEMA_VERSION }), false);
  assert.equal(needsMigration({ schemaVersion: SCHEMA_VERSION + 1 }), false);
  assert.equal(needsMigration(null), true);
});

test('a ceiling-hung beam is re-measured from the floor', () => {
  // Beams used to hang from a 270 cm ceiling, dropping `depth`. Two stored
  // plans still hold that shape; the solid must not move.
  const p: any = migrate({
    id: 'p', name: 'n', layers: [], activeFloorId: 'f',
    floors: [{
      id: 'f', name: '1F', elevation: 0, height: 280, objects: [
        { id: 'b1', kind: 'beam', layer: 'beams', a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, width: 20, depth: 40 },
      ],
    }],
  });
  const beam = p.floors[0].objects[0];
  assert.equal(beam.height, 40, 'the beam is as tall as it used to drop');
  assert.equal(beam.elevation, 230, 'its underside sits 270 - 40 off the floor');
  assert.equal(beam.elevation + beam.height, 270, 'its top is still at the ceiling');
  assert.equal(beam.depth, undefined);
});

test('a beam that already carries height and elevation is left alone', () => {
  const p: any = migrate({
    id: 'p', name: 'n', layers: [], activeFloorId: 'f',
    floors: [{
      id: 'f', name: '1F', elevation: 0, height: 280, objects: [
        { id: 'b1', kind: 'beam', layer: 'beams', a: { x: 0, y: 0 }, b: { x: 300, y: 0 },
          width: 20, height: 55, elevation: 200, depth: 40 },
      ],
    }],
  });
  const beam = p.floors[0].objects[0];
  assert.equal(beam.height, 55);
  assert.equal(beam.elevation, 200);
  assert.equal(beam.depth, undefined, 'the stale field still goes');
});

// ---- repair: runs every load, not gated on the version ----

test('a layer added since the plan was saved is back-filled', () => {
  const p: any = migrate(legacy());
  // the underlay/electrical/dims layers did not exist when this plan was saved
  const ids = p.layers.map((l: any) => l.id);
  assert.ok(ids.includes('electrical'), ids.join(','));
  assert.ok(ids.includes('dims'), ids.join(','));
  assert.equal(ids[ids.length - 1], 'dims', '尺寸標註 stays last');
});

test('an activeFloorId pointing at a deleted floor falls back to the first', () => {
  const p: any = migrate({
    schemaVersion: SCHEMA_VERSION, id: 'p', name: 'n', layers: [],
    activeFloorId: 'gone',
    floors: [{ id: 'f1', name: '1F', elevation: 0, height: 280, objects: [] }],
  });
  assert.equal(p.activeFloorId, 'f1');
});

test('a floor with no stacking values gets the default storey', () => {
  const p: any = migrate({
    schemaVersion: SCHEMA_VERSION, layers: [], activeFloorId: 'f',
    floors: [{ id: 'f', name: '1F', objects: [] }],
  });
  assert.equal(p.floors[0].elevation, 0);
  assert.equal(p.floors[0].height, 280);
  assert.equal(typeof p.id, 'string', 'a plan with no id gets one');
});

test('a plan at the current version but with no floors still gets one', () => {
  const p: any = migrate({ schemaVersion: SCHEMA_VERSION, id: 'p', name: 'n', layers: [] });
  assert.equal(p.floors.length, 1);
  assert.equal(p.activeFloorId, p.floors[0].id);
});

test('repair still runs on a plan that needs no migration', () => {
  const p: any = migrate({
    schemaVersion: SCHEMA_VERSION, id: 'p', name: 'n', layers: [],
    activeFloorId: 'f', floors: [{ id: 'f', name: '1F', elevation: 0, height: 280, objects: [] }],
  });
  assert.ok(p.layers.length > 0, 'empty layer list must be filled in');
});

// ---- the Doc is the only entry point users reach ----

test('Doc migrates whatever it is handed', () => {
  const d = new Doc(legacy() as any);
  assert.equal(d.floors.length, 1);
  assert.equal(d.objects.length, 1);
  assert.equal((d.serialize() as any).schemaVersion, SCHEMA_VERSION);
});

test('Doc.load migrates too, not just the constructor', () => {
  const d = new Doc();
  d.load(legacy() as any);
  assert.equal(d.objects.length, 1);
  assert.equal((d.serialize() as any).schemaVersion, SCHEMA_VERSION);
});

test('a blank doc is born at the current version', () => {
  assert.equal((new Doc().serialize() as any).schemaVersion, SCHEMA_VERSION);
});
