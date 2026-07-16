import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from '../src/model/doc';

const sofa = (id: string) => ({ id, kind: 'furniture', layer: 'furniture', item: 'sofa', x: 0, y: 0, w: 100, h: 50, angle: 0, label: '' }) as any;

test('a new doc has one floor and no objects', () => {
  const d = new Doc();
  assert.equal(d.floors.length, 1);
  assert.equal(d.objects.length, 0);
});

test('add() puts the object on the active floor', () => {
  const d = new Doc();
  d.add(sofa('a'));
  assert.equal(d.objects.length, 1);
  assert.equal(d.activeFloor.objects[0].id, 'a');
});

test('addFloor() creates a new empty active floor stacked above', () => {
  const d = new Doc();
  d.add(sofa('a'));
  d.addFloor();
  assert.equal(d.floors.length, 2);
  assert.equal(d.objects.length, 0);                       // the new floor is empty
  assert.ok(d.activeFloor.elevation > 0);                  // stacked above 1F
});

test('switching floors swaps which objects are visible', () => {
  const d = new Doc();
  const f1 = d.activeFloor.id;
  d.add(sofa('a'));
  d.addFloor();
  d.add(sofa('b'));
  d.setActiveFloor(f1);
  assert.equal(d.objects.length, 1);
  assert.equal(d.objects[0].id, 'a');
});

test('undo/redo restores the object list', () => {
  const d = new Doc();
  d.commit();
  d.add(sofa('a'));
  assert.equal(d.objects.length, 1);
  d.undo();
  assert.equal(d.objects.length, 0);
  d.redo();
  assert.equal(d.objects.length, 1);
});

test('undo reverts an addFloor and the edits after it (whole-stack snapshot)', () => {
  const d = new Doc();
  d.add(sofa('a'));
  d.commit();                 // snapshot: 1 floor with sofa a
  d.addFloor();               // commits internally, then adds 2F
  d.add(sofa('b'));           // on 2F
  assert.equal(d.floors.length, 2);
  d.undo();                   // back to before addFloor
  assert.equal(d.floors.length, 1);
  assert.equal(d.objects.length, 1);   // sofa a still on 1F
});

test('an old flat project migrates into a single floor', () => {
  const legacy = { id: 'p', name: 'x', layers: [], objects: [sofa('a'), sofa('b')] } as any;
  const d = new Doc(legacy);
  assert.equal(d.floors.length, 1);
  assert.equal(d.objects.length, 2);
  assert.equal((d.project as any).objects, undefined);     // legacy field removed
});
