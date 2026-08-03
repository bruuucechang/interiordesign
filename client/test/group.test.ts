import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Doc, genId } from '../src/model/doc';
import { Obj } from '../src/model/types';

const furn = (id: string, x: number): Obj =>
  ({ id, kind: 'furniture', layer: 'furniture', item: 'sofa',
     x, y: 0, w: 100, h: 50, angle: 0, label: '沙發' }) as Obj;

function docWith(n: number): { doc: Doc; ids: string[] } {
  const doc = new Doc();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) { const id = `f${i}`; doc.add(furn(id, i * 200)); ids.push(id); }
  return { doc, ids };
}

test('a single object cannot be grouped', () => {
  const { doc, ids } = docWith(3);
  doc.select(ids[0]);
  assert.equal(doc.canGroup, false);
  assert.equal(doc.groupSelection(), null);
});

test('grouping stamps one id on every member', () => {
  const { doc, ids } = docWith(3);
  doc.selectMany([ids[0], ids[1]]);
  const gid = doc.groupSelection();
  assert.ok(gid);
  assert.equal(doc.get(ids[0])!.group, gid);
  assert.equal(doc.get(ids[1])!.group, gid);
  assert.equal(doc.get(ids[2])!.group, undefined);
});

test('selecting one member selects the whole group', () => {
  const { doc, ids } = docWith(3);
  doc.selectMany([ids[0], ids[1]]);
  doc.groupSelection();
  doc.select(ids[1]);
  assert.deepEqual(doc.selectedIds.sort(), [ids[0], ids[1]].sort());
});

test('selecting an ungrouped object stays a single selection', () => {
  const { doc, ids } = docWith(3);
  doc.selectMany([ids[0], ids[1]]);
  doc.groupSelection();
  doc.select(ids[2]);
  assert.deepEqual(doc.selectedIds, [ids[2]]);
});

test('a box selection touching a group pulls in the rest of it', () => {
  const { doc, ids } = docWith(4);
  doc.selectMany([ids[0], ids[1], ids[2]]);
  doc.groupSelection();
  doc.selectMany([ids[3], ids[0]]);          // rubber band caught one member
  assert.deepEqual(doc.selectedIds.sort(), ids.sort());
});

test('ungrouping releases the members', () => {
  const { doc, ids } = docWith(3);
  doc.selectMany([ids[0], ids[1]]);
  doc.groupSelection();
  doc.select(ids[0]);                         // expands to both
  assert.equal(doc.ungroupSelection(), true);
  assert.equal(doc.get(ids[0])!.group, undefined);
  doc.select(ids[0]);
  assert.deepEqual(doc.selectedIds, [ids[0]]);
});

test('ungrouping does nothing when nothing is grouped', () => {
  const { doc, ids } = docWith(2);
  doc.selectMany(ids);
  assert.equal(doc.canUngroup, false);
  assert.equal(doc.ungroupSelection(), false);
});

test('grouping a selection that contains a group absorbs it whole', () => {
  const { doc, ids } = docWith(4);
  doc.selectMany([ids[0], ids[1]]);
  const first = doc.groupSelection();
  doc.selectMany([ids[0], ids[2]]);            // expands to f0, f1, f2
  const second = doc.groupSelection();
  assert.notEqual(second, first);
  assert.equal(doc.get(ids[0])!.group, second);
  assert.equal(doc.get(ids[1])!.group, second, 'the old group came along');
  assert.equal(doc.get(ids[2])!.group, second);
  assert.equal(doc.get(ids[3])!.group, undefined);
});

test('grouping is undoable', () => {
  const { doc, ids } = docWith(2);
  doc.selectMany(ids);
  doc.groupSelection();
  assert.ok(doc.get(ids[0])!.group);
  doc.undo();
  assert.equal(doc.get(ids[0])!.group, undefined);
});

test('removing a member leaves the rest of the group intact', () => {
  const { doc, ids } = docWith(3);
  doc.selectMany(ids);
  const gid = doc.groupSelection();
  doc.remove(ids[1]);
  assert.equal(doc.get(ids[0])!.group, gid);
  assert.equal(doc.get(ids[2])!.group, gid);
  doc.select(ids[0]);
  assert.deepEqual(doc.selectedIds.sort(), [ids[0], ids[2]].sort());
});

test('groups survive a save/load round trip', () => {
  const { doc, ids } = docWith(2);
  doc.selectMany(ids);
  const gid = doc.groupSelection();
  const reloaded = new Doc(JSON.parse(JSON.stringify(doc.serialize())));
  assert.equal(reloaded.get(ids[0])!.group, gid);
  reloaded.select(ids[0]);
  assert.deepEqual(reloaded.selectedIds.sort(), ids.sort());
});

test('duplicating a group makes a new group, not more members of the old one', () => {
  // cloneWithOffset remaps group ids; without that, dragging the copy would
  // drag the original along with it.
  const { doc, ids } = docWith(2);
  doc.selectMany(ids);
  const gid = doc.groupSelection();

  // mirror what Editor.cloneWithOffset does
  const remap = new Map<string, string>();
  const clones = doc.selectedObjects.map(o => {
    const c = JSON.parse(JSON.stringify(o));
    c.id = genId(o.kind);
    if (c.group) { if (!remap.has(c.group)) remap.set(c.group, genId('grp')); c.group = remap.get(c.group); }
    return c as Obj;
  });
  for (const c of clones) doc.add(c);

  const newGid = clones[0].group;
  assert.ok(newGid);
  assert.notEqual(newGid, gid);
  assert.equal(clones[1].group, newGid, 'the copies stay grouped with each other');

  doc.select(clones[0].id);
  assert.deepEqual(doc.selectedIds.sort(), clones.map(c => c.id).sort(),
    'selecting a copy must not reach back into the original');
});
