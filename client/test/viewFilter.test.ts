import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewGroup, shownWith, parseHidden, VIEW_GROUPS, ViewGroup } from '../src/core/viewFilter';
import { Obj } from '../src/model/schema';

const base = { id: 'x', layer: 'furniture' } as const;
const fit = (item: string) => ({ ...base, kind: 'electrical', item, x: 0, y: 0, angle: 0 }) as unknown as Obj;
const piece = (item: string) => ({ ...base, kind: 'furniture', item, x: 0, y: 0, w: 50, h: 50, angle: 0, label: '' }) as unknown as Obj;
const seg = (kind: string) => ({ ...base, kind, a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 12, offset: 0, width: 30 }) as unknown as Obj;

test('fittings: lights apart from sockets and switches', () => {
  for (const id of ['downlight', 'batten', 'ceilingLight', 'spotlight', 'pendant', 'wallLight']) assert.equal(viewGroup(fit(id)), 'lights', id);
  for (const id of ['socket', 'socket2', 'socketWater', 'tv', 'network', 'switch1', 'switch2', 'switch3']) assert.equal(viewGroup(fit(id)), 'outlets', id);
});

test('a catalogue lamp is a light, everything else in the catalogue is furniture', () => {
  for (const id of ['lamp_ceiling', 'lamp_pendant', 'lamp_floor', 'lamp_table', 'lamp_wall']) assert.equal(viewGroup(piece(id)), 'lights', id);
  // A1's 29 pieces, and an item the catalogue no longer has.
  for (const id of ['wardrobe', 'bed_double', 'desk', 'nightstand', 'toilet', 'shower', 'fridge', 'sink', 'stove', 'gone_from_catalogue']) {
    assert.equal(viewGroup(piece(id)), 'furniture', id);
  }
});

test('dimensions and sub-areas are notes; the room itself is always there', () => {
  assert.equal(viewGroup(seg('dimension')), 'notes');
  assert.equal(viewGroup({ ...base, kind: 'area', x: 0, y: 0, w: 1, h: 1 } as unknown as Obj), 'notes');
  for (const k of ['wall', 'beam', 'partition']) assert.equal(viewGroup(seg(k)), null, k);
  assert.equal(viewGroup({ ...base, kind: 'room', x: 0, y: 0, w: 1, h: 1 } as unknown as Obj), null);
  assert.equal(viewGroup({ ...base, kind: 'door', x: 0, y: 0, width: 90 } as unknown as Obj), null);
  assert.equal(viewGroup({ ...base, kind: 'window', x: 0, y: 0, width: 90 } as unknown as Obj), null);
});

test('everything unticked leaves only the rooms', () => {
  const all = new Set<ViewGroup>(VIEW_GROUPS.map(g => g.id));
  const objs = [fit('downlight'), fit('socket'), piece('wardrobe'), piece('lamp_floor'), seg('dimension'), seg('wall'),
    { ...base, kind: 'room', x: 0, y: 0, w: 1, h: 1 } as unknown as Obj];
  assert.deepEqual(objs.filter(o => shownWith(all, o)).map(o => o.kind), ['wall', 'room']);
  assert.equal(objs.filter(o => shownWith(new Set(), o)).length, objs.length);
  // One tick off hides that group only.
  assert.deepEqual(objs.filter(o => !shownWith(new Set<ViewGroup>(['lights']), o)).map(o => (o as { item?: string }).item), ['downlight', 'lamp_floor']);
});

test('the stored setting reads back whatever the browser holds', () => {
  assert.deepEqual([...parseHidden('["lights","notes"]')], ['lights', 'notes']);
  assert.deepEqual([...parseHidden(null)], []);
  assert.deepEqual([...parseHidden('not json')], []);
  assert.deepEqual([...parseHidden('{"lights":true}')], []);
  assert.deepEqual([...parseHidden('["lights","walls",3]')], ['lights']);   // a group that is not one is dropped
});

test('the 顯示 menu has one tick per group', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ticks = [...html.matchAll(/data-show="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(ticks, VIEW_GROUPS.map(g => g.id));
});
