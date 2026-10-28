// The lamps that actually shine in the 3D view (B18). The numbers — candela,
// cone, colour, which ones are on — are ./lightEmit's; this only owns the
// THREE.SpotLight pool and moves it around.
//
// The pool has a fixed size and joins the scene only while the lamps are on:
// three compiles every material against the number of lights, so a pool that
// grew and shrank as you walked would recompile the whole scene each time.
// Switching the lamps on or off costs one recompile; walking costs nothing.
import * as THREE from 'three';
import { Emitter, ShadeSeg, ACTIVE_LIGHTS, SHADOW_LIGHTS, pickEmitters, threeIntensity } from './lightEmit';

export interface StoreyLamps { base: number; emitters: Emitter[]; walls: ShadeSeg[] }

/** Re-pick once the viewer has moved this far (cm), or every this many ms. */
const MOVE_CM = 40, REPICK_MS = 500;

export class Lamps3D {
  private pool: THREE.SpotLight[] = [];
  private group = new THREE.Group();
  private storeys: StoreyLamps[] = [];
  private on = false;
  private last = { x: NaN, y: NaN, t: 0, key: '' };
  /** The plan or the switch changed: re-aim even if the same ids come out (they may now be none). */
  private dirty = true;
  /** Ids lit right now, for tests and the bench. */
  active: string[] = [];

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    for (let i = 0; i < ACTIVE_LIGHTS; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 4, 1, 2);
      if (i < SHADOW_LIGHTS) {
        l.castShadow = true;
        l.shadow.mapSize.set(512, 512);
        l.shadow.camera.near = 5; l.shadow.camera.far = 2500;
        l.shadow.bias = -0.0005; l.shadow.normalBias = 1;
      }
      this.group.add(l, l.target);
      this.pool.push(l);
    }
  }

  get isOn() { return this.on; }

  setOn(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on) this.scene.add(this.group); else this.scene.remove(this.group);
    this.last.key = '';   // force a re-pick
    this.dirty = true;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** The plan's lamps, storey by storey; called on every rebuild. */
  setStoreys(s: StoreyLamps[]) {
    this.storeys = s;
    this.last.key = '';
    this.dirty = true;   // same ids may carry new numbers (lumens, colour, a moved lamp), or there may be none left
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** The storey whose floor is the highest one below `y`, or the lowest storey when `y` is under them all. */
  storeyAt(y: number): StoreyLamps | undefined {
    let st: StoreyLamps | undefined;
    for (const s of this.storeys) if (s.base <= y && (!st || s.base > st.base)) st = s;
    return st ?? this.storeys.reduce<StoreyLamps | undefined>((a, b) => (!a || b.base < a.base ? b : a), undefined);
  }

  /**
   * Point the pool at the lamps that matter. Standing in a room (the eye less
   * than one and a half storeys above its floor), around the eye; looking down
   * on the plan, around what the orbit turns about. Cheap when nothing changed.
   */
  update(eye: THREE.Vector3, target: THREE.Vector3, storeyHeight: number, now: number) {
    if (!this.on) return;
    const at = this.storeyAt(eye.y);
    const viewer = at && eye.y - at.base < storeyHeight * 1.5 ? eye : target;
    const moved = Math.hypot(viewer.x - this.last.x, viewer.z - this.last.y) > MOVE_CM;
    if (this.last.key && !moved && now - this.last.t < REPICK_MS) return;
    // The storey the viewer stands in: the highest whose floor is below the eye.
    const st = this.storeyAt(viewer.y);
    if (!st) return;
    const picked = pickEmitters(st.emitters, { x: viewer.x, y: viewer.z, h: viewer.y - st.base }, st.walls);
    const key = picked.map(e => e.id).join(',');
    this.last = { x: viewer.x, y: viewer.z, t: now, key };
    if (!this.dirty && key === this.active.join(',')) return;
    this.dirty = false;
    this.active = picked.map(e => e.id);
    // Shadow casters go to the nearest picks: `pickEmitters` already put them first.
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i], e = picked[i];
      // Unused ones go dark, never invisible: three counts only visible lights, so hiding one would recompile every material.
      if (!e) { l.intensity = 0; continue; }
      l.color.setRGB(...e.color, THREE.SRGBColorSpace);
      l.intensity = threeIntensity(e.candela);
      l.angle = e.cone;
      l.penumbra = 1;
      l.position.set(e.x, st.base + e.z, e.y);
      l.target.position.set(e.x + e.dir[0] * 100, st.base + e.z + e.dir[2] * 100, e.y + e.dir[1] * 100);
      l.target.updateMatrixWorld();
    }
    this.renderer.shadowMap.needsUpdate = true;
  }
}
