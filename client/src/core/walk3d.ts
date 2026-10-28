// Walk mode in the 3D view (B19): eyes 160 cm up, mouse-look under pointer
// lock, WASD to walk and Shift to run, walls that stop you and doors that do
// not, stairs between storeys. Where you may stand is ./walk's (pure); this
// owns the camera while it is on and hands it back to the orbit controls after.
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Doc } from '../model/doc';
import { Blocker, Walker, WALK, blockers, spawn, walkSpawn, walkStep } from './walk';
import { FEEL_BASE } from './controlFeel';

/** How far up and down you can look, radians — short of straight, where yaw stops meaning anything. */
const PITCH_MAX = 85 * Math.PI / 180;

export class WalkMode {
  active = false;
  private walker: Walker = { x: 0, y: 0, floor: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private walls: Blocker[][] = [];
  private doc: Doc | null = null;
  /** Mouse-look multiplier from the controls settings panel. */
  look = 1;
  /** Called after every move: plan position, heading (radians, plan frame) and storey — the 2D map marker. */
  onMove: ((x: number, y: number, heading: number, floor: number) => void) | null = null;
  onToggle: ((on: boolean) => void) | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private controls: OrbitControls, private dom: HTMLElement) {
    dom.addEventListener('click', () => {
      if (!this.active || document.pointerLockElement === dom) return;
      // Refused in some frames and in headless browsers; walking still works on the keys alone.
      void Promise.resolve(dom.requestPointerLock?.()).catch(() => {});
    });
    document.addEventListener('mousemove', e => {
      if (!this.active || document.pointerLockElement !== dom) return;
      const k = FEEL_BASE.look * this.look * Math.PI / 180;
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.pitch - e.movementY * k));
      this.place();
    });
  }

  /** The storey being walked, by id: an index would point at another storey once one is added below or removed. */
  private floorId = '';

  /**
   * The plan's walls, storey by storey; called on every rebuild. While
   * walking, find the walker's storey again by id (gone → step out), stand
   * clear of any wall that moved onto you, and put the camera back on the eye
   * — a rebuild may have reframed it.
   */
  setPlan(doc: Doc) {
    this.doc = doc;
    this.walls = doc.project.floors.map(f => blockers(f.objects.filter(o => doc.isLayerVisible(o.layer))));
    if (!this.active) return;
    const i = doc.project.floors.findIndex(f => f.id === this.floorId);
    if (i < 0) { this.exit(); return; }
    this.walker = spawn(doc.project.floors, i, this.walker, this.walls[i] ?? [], this.walker.z);
    this.place();
  }

  /** The orbit view walking started from: leaving puts the camera back there (B21). */
  private before: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  /**
   * Step in at the room the camera is looking at: its most open point, facing
   * the longest clear view (`walkSpawn`). It used to be the orbit target itself,
   * facing the camera's way — nose to a wall on the A1 plan.
   */
  enter(floor: number) {
    if (!this.doc || this.active) return;
    const floors = this.doc.project.floors;
    const t = this.controls.target;
    this.before = { pos: this.camera.position.clone(), target: t.clone() };
    const walls = this.walls[floor] ?? [];
    const objs = (floors[floor]?.objects ?? []).filter(o => this.doc!.isLayerVisible(o.layer));
    const at = walkSpawn(objs, walls, { x: t.x, y: t.z });
    this.walker = spawn(floors, floor, at.p, walls);
    this.floorId = floors[this.walker.floor]?.id ?? '';
    // Plan forward (cos h, sin h) is (−sin yaw, −cos yaw) in this camera's frame.
    this.yaw = Math.atan2(-Math.cos(at.heading), -Math.sin(at.heading));
    this.pitch = 0;
    this.active = true;
    this.controls.enabled = false;
    this.place();
    this.onToggle?.(true);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    if (document.pointerLockElement === this.dom) document.exitPointerLock?.();
    // Back to the view walking started from — like leaving first person in a build
    // game. Staying where the walker stood left the orbit camera against a wall.
    if (this.before) {
      this.camera.position.copy(this.before.pos);
      this.controls.target.copy(this.before.target);
      this.before = null;
    }
    this.controls.enabled = true;
    this.controls.update();
    this.onToggle?.(false);
  }

  /** One frame: WASD from the 3D key set (`up` is Shift — run here, not rise). */
  frame(dt: number, pressed: ReadonlySet<string>) {
    if (!this.active || !this.doc) return;
    // A storey added or removed since the last rebuild: find ours by id, and
    // wait for the rebuild if the walls are still the old list.
    const floors = this.doc.project.floors;
    const i = floors.findIndex(f => f.id === this.floorId);
    if (i < 0) { this.exit(); return; }
    if (this.walls.length !== floors.length) return;
    if (i !== this.walker.floor) this.walker = { ...this.walker, floor: i };
    const f = (pressed.has('w') ? 1 : 0) - (pressed.has('s') ? 1 : 0);
    const r = (pressed.has('d') ? 1 : 0) - (pressed.has('a') ? 1 : 0);
    if (!f && !r) return;
    const len = Math.hypot(f, r), v = (pressed.has('up') ? WALK.run : WALK.speed) * dt / len;
    // Plan frame: three's −z is plan −y. Facing yaw, forward is (−sin, −cos), right is (cos, −sin).
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const dx = (-sy * f + cy * r) * v, dy = (-cy * f - sy * r) * v;
    this.walker = walkStep(this.doc.project.floors, this.walker, dx, dy, i => this.walls[i] ?? []);
    this.floorId = this.doc.project.floors[this.walker.floor]?.id ?? this.floorId;
    this.place();
  }

  /** Where you are, for tests and the bench. */
  get state() { return { ...this.walker, yaw: this.yaw, pitch: this.pitch }; }

  private place() {
    this.camera.position.set(this.walker.x, this.walker.z + WALK.eye, this.walker.y);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    this.onMove?.(this.walker.x, this.walker.y, Math.atan2(-Math.cos(this.yaw), -Math.sin(this.yaw)), this.walker.floor);
  }
}
