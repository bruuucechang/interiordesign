// Walk mode in the 3D view (B19): eyes 160 cm up, mouse-look under pointer
// lock, WASD to walk and Shift to run, walls that stop you and doors that do
// not, stairs between storeys. Where you may stand is ./walk's (pure); this
// owns the camera while it is on and hands it back to the orbit controls after.
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Doc } from '../model/doc';
import { Blocker, Walker, WALK, blockers, spawn, walkStep } from './walk';
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

  /**
   * Step in where the camera is looking: the point on the current storey's
   * floor straight ahead of the orbit (its target), pushed clear of walls.
   */
  enter(floor: number) {
    if (!this.doc || this.active) return;
    const floors = this.doc.project.floors;
    const t = this.controls.target;
    this.walker = spawn(floors, floor, { x: t.x, y: t.z }, this.walls[floor] ?? []);
    this.floorId = floors[this.walker.floor]?.id ?? '';
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
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
    // Hand the orbit a target 3 m ahead, so the next drag turns around what you were looking at.
    const ahead = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(300);
    this.controls.target.copy(this.camera.position).add(ahead).setY(this.walker.z + 100);
    this.controls.enabled = true;
    this.controls.update();
    this.onToggle?.(false);
  }

  /** One frame: WASD from the 3D key set (`up` is Shift — run here, not rise). */
  frame(dt: number, pressed: ReadonlySet<string>) {
    if (!this.active || !this.doc) return;
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
