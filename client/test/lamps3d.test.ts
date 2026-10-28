import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Lamps3D } from '../src/core/lamps3d';
import { emitters, sightLines } from '../src/core/lightEmit';
import type { ElectricalId, Obj } from '../src/model/schema';

const elec = (id: string, x: number, y: number): Obj =>
  ({ id, kind: 'electrical', layer: 'electrical', item: 'downlight' as ElectricalId, x, y, angle: 0 } as Obj);
const storey = (base: number, objs: Obj[]) => ({ base, emitters: emitters(objs, 280), walls: sightLines(objs) });
const make = () => {
  const scene = new THREE.Scene();
  const lamps = new Lamps3D(scene, { shadowMap: {} } as unknown as THREE.WebGLRenderer);
  lamps.setOn(true);
  const lit = () => (scene.children[0] as THREE.Group).children.filter((c): c is THREE.SpotLight => (c as THREE.SpotLight).isSpotLight && (c as THREE.SpotLight).intensity > 0).length;
  return { lamps, lit };
};
const eye = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

test('removing every lamp darkens the pool, even though the picked set was already empty-looking', () => {
  const { lamps, lit } = make();
  lamps.setStoreys([storey(0, [elec('a', 0, 0), elec('b', 100, 0)])]);
  lamps.update(eye(0, 160, 0), eye(0, 0, 0), 280, 0);
  assert.equal(lit(), 2);
  lamps.setStoreys([storey(0, [])]);
  lamps.update(eye(0, 160, 0), eye(0, 0, 0), 280, 1);
  assert.equal(lit(), 0);
});

test('standing in a basement lights the basement, not the ground floor above it', () => {
  const { lamps } = make();
  lamps.setStoreys([storey(0, [elec('up', 0, 0)]), storey(-300, [elec('down', 0, 0)])]);
  lamps.update(eye(0, -140, 0), eye(0, -300, 0), 280, 0);
  assert.deepEqual(lamps.active, ['down']);
});

test('inside a room on the upper storey, lamps are picked around the eye, not the orbit target', () => {
  const { lamps } = make();
  lamps.setStoreys([storey(0, []), storey(280, [elec('here', 0, 0), elec('far', 3000, 0)])]);
  lamps.update(eye(0, 280 + 160, 0), eye(3000, 280, 0), 280, 0);
  assert.equal(lamps.active[0], 'here');
});
