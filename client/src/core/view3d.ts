import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Doc } from '../model/doc';
import { Obj, Vec } from '../model/schema';
import { dist, angleDeg, quadPoints, wallControl } from './geometry';
import { wallPieces, curvedWallBands } from './wallGeometry';
import { buildDoor3D, buildWindow3D } from './openings3d';
import { getFurnitureModel, getModelHeight } from './furniture3d';
import { surfaceMaterial } from './textures3d';
import { material as materialDef } from './materials';
import { capturePanorama } from './panorama';
import { nextResolution, onWorkloadChange, initialState, ResolutionState } from './resolution';
import { mark, done } from './perf';
import { DEFAULTS } from '../model/locale-defaults';

/** 台灣住宅的預設牆高——見 model/locale-defaults.ts。 */
const WALL_H = DEFAULTS.wallHeight;

// Time-of-day lighting presets: sun colour/intensity/angle, sky fills, exposure.
type TimeKey = 'morning' | 'noon' | 'dusk' | 'night';
const LIGHTING: Record<TimeKey, { sun: number; intensity: number; hemi: number; amb: number; env: number; bg: number; exposure: number; elev: number; azim: number }> = {
  morning: { sun: 0xffe6c2, intensity: 2.0, hemi: 0.55, amb: 0.16, env: 0.50, bg: 0xdfe8f0, exposure: 1.00, elev: 20, azim: 100 },
  noon:    { sun: 0xfff4e2, intensity: 2.0, hemi: 0.48, amb: 0.12, env: 0.40, bg: 0xdbe2ea, exposure: 0.85, elev: 68, azim: 40 },
  dusk:    { sun: 0xff9e5e, intensity: 1.9, hemi: 0.40, amb: 0.14, env: 0.38, bg: 0xe9c9a8, exposure: 1.05, elev: 12, azim: -60 },
  night:   { sun: 0x9fb6ff, intensity: 0.5, hemi: 0.12, amb: 0.10, env: 0.10, bg: 0x161c28, exposure: 1.15, elev: 42, azim: 20 },
};

// plan coords (x, y) map to 3D (X = x, Z = y, Y = up)
/**
 * How much of a frame the 3D view is worth, by situation.
 *
 * `full` is the view the user is driving. `shared` is the other half of a split
 * — a real, full-size view that is not being touched right now, so it still
 * needs to be correct and still needs ambient occlusion (dropping AO would make
 * the image visibly change every time the pointer crossed the divider), just
 * not sixty times a second while the 2D canvas is the thing being dragged.
 *
 * Both compete for one main thread with the 2D renderer. That competition is
 * what "卡頓" was.
 */
export type Budget = 'full' | 'shared';

/**
 * How far onto the camera's side a run of wall has to be before it is cut away,
 * as a fraction of the plan's half size on that axis.
 *
 * 0 cuts everything past the middle, including partitions that were not in the
 * way. Near 1 only the outermost wall goes and the second row of rooms stays
 * shut. 0.3 opens the front rooms and keeps the back of the building standing.
 */
const NEAR_WALL_CUT = 0.3;

/**
 * How close to the plan's edge a run of wall has to be to count as an outside
 * wall. Anything nearer the middle than this is a partition and is never cut.
 */
const EDGE_BAND = 0.7;
const SHARED_FPS = 20;
const SHARED_FRAME_MS = 1000 / SHARED_FPS;

export class View3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private renderPass!: RenderPass;
  private sky!: THREE.Mesh;
  private gtao: GTAOPass;
  private tintCache = new Map<string, THREE.Material>();   // (material, colour) → recoloured clone
  private ceilingGroup = new THREE.Group();   // per-room ceilings, shown only from inside
  private _ceilMat?: THREE.Material;
  private staticGroup = new THREE.Group();   // walls/floors/openings — rebuilt+disposed each time
  private furnGroup = new THREE.Group();      // cloned cached furniture — cleared without disposing
  private ground?: THREE.Mesh;                // the infinite ground plane (excluded from 3D export)
  private dir: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private amb!: THREE.AmbientLight;
  private time: TimeKey = 'noon';
  private sunCenter = { x: 0, z: 0 };
  private sunSpan = 500;
  private running = false;
  private raf = 0;
  private clock = new THREE.Clock();
  private pressed = new Set<string>();
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  contextLost = false;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  private keyChips: Record<string, HTMLElement> = {};
  private fly = false;   // WASD/QE camera movement
  private moveSpeed = 500; // cm/s, scaled to the scene in build()
  onFloorClick: ((floor: { x: number; y: number }, sceneHit: { x: number; y: number } | null) => void) | null = null;   // click → floor-plane point + nearest-mesh hit (walls)
  onRotate90: ((deg: number) => void) | null = null;                        // Q/E in 3D → rotate the selected object ±90°
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);      // y = 0
  private downXY: { x: number; y: number } | null = null;
  private previewItem: { id: string; w: number; h: number } | null = null;  // furniture to ghost while placing
  private ghost: THREE.Object3D | null = null;
  onHover: ((floor: { x: number; y: number } | null, sceneHit: { x: number; y: number } | null) => void) | null = null;  // per-move probe (openings)
  private openingGhost: THREE.Object3D | null = null;
  private openingGhostKey = '';

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(this.pixelRatio);   // adaptive from here on — see adaptResolution

    // A lost context is not a crash, it is a pause — the browser takes the GPU
    // back when a tab is backgrounded for long enough, when the driver resets,
    // or when another tab is greedy. Without these two the view goes black and
    // stays black for the life of the page, and the only fix a user finds is
    // reloading and losing the last autosave interval.
    //
    // `preventDefault()` on the loss is what makes the browser promise to send
    // `webglcontextrestored` at all; skip it and the restore never fires.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.stop();
      this.onContextLost?.();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      // Everything on the GPU went with the context — textures, geometry,
      // compiled programs. Rebuilding the scene is the only honest recovery;
      // resuming the loop alone draws with handles that no longer exist.
      this.onContextRestored?.();
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;   // we refresh shadows only on rebuild
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;   // lower exposure so shading/shadows read instead of washing out
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdbe2ea);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;   // dial back the flat image-based light so surfaces show form
    pmrem.dispose();

    // Sky dome as real geometry — a reliable background through the post-processing
    // composer (scene.background alone doesn't survive the render passes).
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 24, 16), new THREE.MeshBasicMaterial({ color: 0xdbe2ea, side: THREE.BackSide }));
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // near/far decide how much depth precision there is to go round, and the ratio
    // between them is what matters: 1 to 200000 spends almost all of it in the
    // first few centimetres and leaves the floor of a room fighting with whatever
    // is under it. The scene is a building — the sky dome and the 80 m ground
    // plane are the furthest things in it — so 5 cm to 400 m is generous, and it
    // is a 4000× tighter ratio.
    this.camera = new THREE.PerspectiveCamera(52, 1, 5, 40000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

    // Contrast-forward lighting: a strong key sun for crisp cast shadows, a weak
    // opposite fill so shadowed faces stay legible, minimal ambient. Depth/contact
    // cues come from the GTAO pass below.
    this.hemi = new THREE.HemisphereLight(0xeaf1ff, 0x555a63, 0.75); this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, 0.15); this.scene.add(this.amb);   // tiny lift so nothing is pitch black
    this.dir = new THREE.DirectionalLight(0xfff4e2, 2.4);
    this.dir.castShadow = true;
    this.dir.shadow.mapSize.set(4096, 4096);   // sharper contact shadows
    this.dir.shadow.bias = -0.0004;
    this.dir.shadow.radius = 4;          // soft edges without smearing
    this.dir.shadow.intensity = 0.92;    // strong, clearly-read cast shadows
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
    fill.position.set(-1, 0.6, -0.8);
    this.scene.add(this.dir, this.dir.target, fill, this.staticGroup, this.furnGroup, this.ceilingGroup);

    // Post-processing: ground-truth ambient occlusion for object-to-floor and
    // object-to-object contact darkening — the main recognizability boost.
    // The renderer's `antialias: true` above does nothing on its own here: it
    // only applies to the default framebuffer, and every frame goes through the
    // composer's offscreen target instead — which defaults to `samples: 0`. So
    // the flag was set and the picture was still fully aliased: stair-stepped
    // door frames and wall corners, and the raised door panels, about one pixel
    // wide at room distance, breaking into a dashed line that reads as dirt on
    // the door. Giving the composer a multisampled target is what actually
    // turns it on.
    //
    // 4 samples and the default 8-bit format — not HalfFloat. Tone mapping runs
    // in OutputPass at the end, so the intermediate does not need the range, and
    // a multisampled float target at pixel ratio 2 on a large window is a couple
    // of hundred megabytes of GPU memory for nothing.
    //
    // The GPU cost of the samples could not be measured here: headless Chromium
    // rasterises in software, where MSAA is pathologically expensive and the
    // numbers came out as noise (0 samples measured *slower* than 4). What
    // covers it instead is the machine's own answer — `adaptResolution` already
    // drops the pixel ratio when frames pass 20 ms, and multisampling makes the
    // frame more fill-bound, which is exactly what that valve responds to.
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4 }));
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.9;
    // screen-space radius keeps the AO scale sane regardless of the cm-based scene size
    this.gtao.updateGtaoMaterial({ screenSpaceRadius: true, radius: 0.5, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());   // applies tone mapping + sRGB after the AO blend

    // On-screen key indicator — lights up as movement keys arrive, so it's obvious
    // the fly controls are receiving input (and a quick diagnostic if they aren't).
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;left:50%;bottom:10px;transform:translateX(-50%);display:flex;gap:4px;padding:5px 7px;border-radius:8px;background:rgba(17,22,30,0.5);font:600 11px system-ui,sans-serif;pointer-events:none;z-index:6;user-select:none;';
    for (const [label, key] of [['W', 'w'], ['A', 'a'], ['S', 's'], ['D', 'd'], ['⇧', 'shift'], ['␣', 'space'], ['Q', 'q'], ['E', 'e']]) {
      const c = document.createElement('div');
      c.textContent = label;
      c.style.cssText = 'min-width:15px;text-align:center;padding:2px 4px;border-radius:4px;background:rgba(255,255,255,0.06);color:#8b93a3;transition:background .07s,color .07s;';
      hud.appendChild(c); this.keyChips[key] = c;
    }
    container.appendChild(hud);

    // Match on e.code (physical key position), NOT e.key: a Chinese/Japanese IME or
    // a non-US layout rewrites e.key (W becomes "Process" or a composition char) while
    // e.code stays "KeyW". Matching e.key was silently dropping WASD under an active IME.
    const MOVE: Record<string, string> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
    // The arrow keys slide the view without turning it: up is always up the
    // screen, whichever way the camera is pointing.
    //
    // WASD is a fly — W goes where you are looking — so after orbiting 180° it
    // walks the other way across the plan, which is correct for walking through
    // a room and wrong for pushing a drawing around. Measured before changing
    // anything: W tracked the camera's heading exactly at 8 headings × 7 pitches
    // and D was on the right at every one, so the fly was never broken. What was
    // missing was the other gesture, not a fix to this one.
    const PAN: Record<string, string> = {
      ArrowUp: 'panUp', ArrowDown: 'panDown', ArrowLeft: 'panLeft', ArrowRight: 'panRight',
    };
    const isShift = (code: string) => code === 'ShiftLeft' || code === 'ShiftRight';
    // Real text entry (project name, labels) must keep the keys; but the property
    // panel's number inputs treat letters as junk, so WASD there should fly instead
    // of getting swallowed — a common "WASD stopped working" trap after editing a value.
    const isTextField = (el: HTMLElement | null) => {
      if (!el) return false;
      if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
      if (el.tagName !== 'INPUT') return false;
      return !['number', 'range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type);
    };
    // Capture phase so we can release a focused number field and prevent it from
    // also consuming the key before the browser's default runs.
    window.addEventListener('keydown', e => {
      if (!this.fly) return;
      const el = document.activeElement as HTMLElement | null;
      if (isTextField(el)) return;                 // genuinely typing — leave the keys alone
      // Q/E rotate the selected object 90° (one-shot per press; ignore auto-repeat)
      if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat) {
        e.preventDefault();
        this.onRotate90?.(e.code === 'KeyE' ? 90 : -90);
        this.flashChip(e.code === 'KeyE' ? 'e' : 'q', true);
        return;
      }
      const mv = MOVE[e.code], pan = PAN[e.code], up = isShift(e.code), down = e.code === 'Space';
      if (!mv && !pan && !up && !down) return;
      if (el && el !== document.body) el.blur();    // drop focus off a number field so it stops eating keys
      e.preventDefault();
      if (up) { this.pressed.add('up'); this.flashChip('shift', true); }         // Shift → rise
      else if (down) { this.pressed.add('down'); this.flashChip('space', true); } // Space → descend
      else if (pan) this.pressed.add(pan);
      else { this.pressed.add(mv); this.flashChip(mv, true); }
    }, { capture: true });
    window.addEventListener('keyup', e => {
      const mv = MOVE[e.code], pan = PAN[e.code];
      if (pan) this.pressed.delete(pan);
      if (mv) { this.pressed.delete(mv); this.flashChip(mv, false); }
      else if (isShift(e.code)) { this.pressed.delete('up'); this.flashChip('shift', false); }
      else if (e.code === 'Space') { this.pressed.delete('down'); this.flashChip('space', false); }
      else if (e.code === 'KeyQ') this.flashChip('q', false);
      else if (e.code === 'KeyE') this.flashChip('e', false);
    });
    window.addEventListener('blur', () => { this.pressed.clear(); for (const k in this.keyChips) this.flashChip(k, false); });   // don't let a held key stick across an alt-tab

    // A click (not an orbit drag) on the floor reports the plan coords, so the
    // app can place an object there; while a placement is armed, a translucent
    // ghost of the item follows the cursor on the floor.
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', e => { this.downXY = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', e => {
      const d = this.downXY; this.downXY = null;
      if (!this.onFloorClick || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;   // moved → it was orbiting
      const p = this.floorPoint(e);
      if (p) this.onFloorClick(p, this.sceneHit(e));
    });
    dom.addEventListener('pointermove', e => {
      if (this.previewItem) {                        // furniture ghost follows the floor
        const p = this.floorPoint(e);
        const g = p ? (this.ghost ?? this.buildGhost()) : null;
        if (g && p) { g.visible = true; g.position.set(p.x, 0, p.y); }
      }
      if (this.onHover) this.onHover(this.floorPoint(e), this.sceneHit(e));   // openings: app computes wall snap
    });
    dom.addEventListener('pointerleave', () => {
      if (this.ghost) this.ghost.visible = false;
      if (this.openingGhost) this.openingGhost.visible = false;
    });

    this.setTimeOfDay('noon');   // initialize lights + background consistently
  }

  setFly(on: boolean) { this.fly = on; if (!on) this.pressed.clear(); }

  // raycast the cursor onto the y=0 floor plane → plan coords (x, y), or null
  private floorPoint(e: PointerEvent): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? { x: hit.x, y: hit.z } : null;
  }

  // raycast against the built geometry (walls/floor) → plan coords of the nearest
  // surface hit; used to place openings on the wall the cursor is over.
  private sceneHit(e: PointerEvent): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.staticGroup.children, true);
    return hits.length ? { x: hits[0].point.x, y: hits[0].point.z } : null;
  }

  // Arm/disarm the placement ghost. Pass the furniture item (id + size) to show
  // a translucent preview that follows the cursor, or null to remove it.
  setPlacementPreview(item: { id: string; w: number; h: number } | null) {
    const same = item && this.previewItem && item.id === this.previewItem.id && item.w === this.previewItem.w && item.h === this.previewItem.h;
    this.previewItem = item;
    if (!item || !same) this.clearGhost();   // rebuilt for the new item on the next hover
  }

  // turn a model into a translucent, non-shadowing ghost (clones its materials)
  /**
   * Recolour a furniture instance without disturbing the shared cache.
   *
   * getFurnitureModel caches one model per (item, size) and clone() shares its
   * materials, so tinting in place would repaint every copy in the scene. Each
   * distinct (material, colour) pair therefore gets one cloned material, reused
   * across instances so a room full of matching chairs still shares them.
   *
   * Only the base colour changes: roughness, metalness and clearcoat stay, so a
   * fabric sofa still reads as fabric and a glazed basin still reads as glazed.
   */
  private recolour(root: THREE.Object3D, hex: string) {
    const tint = new THREE.Color(hex);
    const swap = (m: THREE.Material): THREE.Material => {
      const key = `${m.uuid}|${hex}`;
      let c = this.tintCache.get(key);
      if (!c) {
        c = m.clone();
        const col = (c as THREE.MeshStandardMaterial).color;
        if (col) col.copy(tint);
        this.tintCache.set(key, c);
      }
      return c;
    };
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
  }

  private ghostify(g: THREE.Object3D) {
    const gm = (m: THREE.Material) => { const c = m.clone(); (c as any).transparent = true; (c as any).opacity = 0.42; (c as any).depthWrite = false; return c; };
    g.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false; m.receiveShadow = false;
      m.material = Array.isArray(m.material) ? m.material.map(gm) : gm(m.material);
    });
    g.renderOrder = 999;
  }

  private buildGhost(): THREE.Object3D | null {
    if (!this.previewItem) return null;
    const g = getFurnitureModel(this.previewItem.id, this.previewItem.w, this.previewItem.h).clone(true);
    this.ghostify(g);   // shared cloned geometry — only the materials are cloned
    this.scene.add(g);
    this.ghost = g;
    return g;
  }

  /**
   * Rebuild the placement ghost in place.
   *
   * The ghost is built once per item and kept until the item changes, so a model
   * that lands afterwards leaves the preview showing the built stand-in — and
   * then the piece changes shape the instant it is dropped, which is the one
   * thing a preview exists to prevent. Called when a model finishes loading.
   */
  refreshGhost() {
    if (!this.ghost || !this.previewItem) return;
    const pos = this.ghost.position.clone();
    const rot = this.ghost.rotation.clone();
    const vis = this.ghost.visible;
    this.clearGhost();
    const g = this.buildGhost();
    if (!g) return;
    g.position.copy(pos); g.rotation.copy(rot); g.visible = vis;
  }

  private clearGhost() {
    if (!this.ghost) return;
    this.ghost.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => mm.dispose()); });
    this.scene.remove(this.ghost);
    this.ghost = null;
  }

  // Show/move a translucent door/window ghost snapped onto a wall. `spec` comes
  // from the app (it does the wall snapping); null hides it. Geometry is rebuilt
  // only when the kind/width changes — otherwise just repositioned.
  setOpeningGhost(spec: { kind: 'door' | 'window'; x: number; y: number; angle: number; width: number } | null) {
    if (!spec) { if (this.openingGhost) this.openingGhost.visible = false; return; }
    const key = `${spec.kind}_${Math.round(spec.width)}`;
    if (this.openingGhostKey !== key) {
      this.clearOpeningGhost();
      const g = spec.kind === 'door' ? buildDoor3D(spec.width, 210, 0) : buildWindow3D(spec.width, 100, 90);
      this.ghostify(g);
      this.scene.add(g);
      this.openingGhost = g; this.openingGhostKey = key;
    }
    this.openingGhost!.position.set(spec.x, 0, spec.y);
    this.openingGhost!.rotation.y = -spec.angle * Math.PI / 180;
    this.openingGhost!.visible = true;
  }

  private clearOpeningGhost() {
    if (!this.openingGhost) return;
    this.openingGhost.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry?.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => mm.dispose()); } });
    this.scene.remove(this.openingGhost);
    this.openingGhost = null; this.openingGhostKey = '';
  }

  // ---- lighting ----
  setTimeOfDay(t: TimeKey) {
    this.time = t;
    const P = LIGHTING[t];
    this.dir.color.setHex(P.sun); this.dir.intensity = P.intensity;
    this.hemi.intensity = P.hemi; this.amb.intensity = P.amb;
    this.scene.environmentIntensity = P.env;   // IBL lights the ground/walls — key for a dark night
    this.scene.background = new THREE.Color(P.bg);
    (this.sky.material as THREE.MeshBasicMaterial).color.setHex(P.bg);   // sky above the horizon
    this.renderer.toneMappingExposure = P.exposure;
    this.applySun();
    this.renderer.shadowMap.needsUpdate = true;
  }
  private applySun() {
    const P = LIGHTING[this.time];
    const el = P.elev * Math.PI / 180, az = P.azim * Math.PI / 180, d = this.sunSpan * 1.6;
    this.dir.position.set(this.sunCenter.x + Math.cos(el) * Math.cos(az) * d, Math.max(80, Math.sin(el) * d), this.sunCenter.z + Math.cos(el) * Math.sin(az) * d);
    this.dir.target.position.set(this.sunCenter.x, 0, this.sunCenter.z);
  }

  private flashChip(k: string, on: boolean) {
    const c = this.keyChips[k];
    if (!c) return;
    c.style.background = on ? '#7bc6ff' : 'rgba(255,255,255,0.06)';
    c.style.color = on ? '#0b0f14' : '#8b93a3';
  }

  /**
   * Arrow keys: slide the view along the screen, not along the model.
   *
   * The axes are the camera's own right and up, so "up" is up the picture at
   * any heading and any pitch — including looking straight down, where the
   * fly's horizontal projection has no answer at all and falls back to a fixed
   * direction. Camera and orbit target move together, so the pivot travels with
   * the view and the next drag orbits around what is now in front of you.
   */
  private applyPan(dt: number) {
    const P = this.pressed;
    let x = 0, y = 0;
    if (P.has('panRight')) x += 1;
    if (P.has('panLeft')) x -= 1;
    if (P.has('panUp')) y += 1;
    if (P.has('panDown')) y -= 1;
    if (!x && !y) return;
    const m = this.camera.matrixWorld.elements;
    const right = new THREE.Vector3(m[0], m[1], m[2]).normalize();
    const up = new THREE.Vector3(m[4], m[5], m[6]).normalize();
    const speed = this.moveSpeed * dt;
    const move = new THREE.Vector3()
      .addScaledVector(right, x * speed)
      .addScaledVector(up, y * speed);
    this.camera.position.add(move);
    this.controls.target.add(move);
  }

  private applyFly(dt: number) {
    const P = this.pressed;
    let fwd = 0, strafe = 0, vert = 0;
    if (P.has('w')) fwd += 1;
    if (P.has('s')) fwd -= 1;
    if (P.has('d')) strafe += 1;
    if (P.has('a')) strafe -= 1;
    if (P.has('up')) vert += 1;     // Shift → rise
    if (P.has('down')) vert -= 1;   // Space → descend
    if (!fwd && !strafe && !vert) return;
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const speed = this.moveSpeed * dt;
    const move = new THREE.Vector3().addScaledVector(dir, fwd * speed).addScaledVector(right, strafe * speed);
    move.y += vert * speed;
    this.camera.position.add(move); this.controls.target.add(move);
  }

  private mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04, envMapIntensity: 1.1, ...opts });
  }

  /**
   * The floor finish for a room: a material id, or a hex colour for a plain
   * fill. Sized in centimetres so the material tiles at its real scale rather
   * than a fixed number of repeats — a 2 m bathroom and an 8 m living room get
   * the same size of tile, which is the whole point of a scale.
   */
  private floorMaterial(floor: string | undefined, wCm: number, hCm: number): THREE.MeshStandardMaterial {
    if (floor && floor.startsWith('#')) {
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(floor).getHex(), roughness: 0.8, metalness: 0.02, envMapIntensity: 1.1 });
    }
    return surfaceMaterial(floor, 'floor', wCm, hCm, { envMapIntensity: 1.2 });
  }

  /** The wall finish: a material id, or a hex colour for plain paint. */
  private wallMaterial(o: { color?: string; finish?: string }, wCm: number, hCm: number): THREE.MeshStandardMaterial {
    if (o.color) {
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color).getHex(), roughness: 0.92, envMapIntensity: 1 });
    }
    return surfaceMaterial(o.finish, 'wall', wCm, hCm, { envMapIntensity: 1 });
  }

  private clearStatic() {
    this.staticGroup.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => {
        const s = mm as THREE.MeshStandardMaterial;
        // Both maps: these are per-surface clones. Missing the normal map here
        // leaks one 512² upload per wall per rebuild, and a rebuild happens
        // after every edit.
        s.map?.dispose(); s.normalMap?.dispose();
        mm.dispose();
      });
    });
    this.staticGroup.clear();
    // Ceilings share one material, so only their geometry is released.
    this.ceilingGroup.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.ceilingGroup.clear();
  }

  build(doc: Doc, reframe = false) {
    const _t0 = mark();
    this.clearStatic();
    this.furnGroup.clear();               // clones share cached geometry/materials — do NOT dispose

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    const grow = (x: number, z: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };

    // Below the slabs, not level with them. A room's floor is a 4 cm box sitting
    // at y = 2, so its underside was exactly coplanar with a ground plane at
    // y = 0 — two surfaces at the same depth, which flickers as the camera moves
    // and which the ambient occlusion pass then samples, so it reads as the
    // texture itself breaking up rather than as two bits of geometry arguing.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), this.mat(0xccd3dc, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -6;
    ground.receiveShadow = true; this.staticGroup.add(ground);
    this.ground = ground;

    // stack every floor at its elevation
    for (const floor of doc.project.floors) {
      const openings = floor.objects.filter(o => o.kind === 'door' || o.kind === 'window') as Extract<Obj, { kind: 'door' | 'window' }>[];
      // Which wall ends meet another wall. A wall is a box running from one
      // centre-line endpoint to the other, so at a corner neither box covers the
      // square where the two centre lines cross: two 15 cm walls meeting leave a
      // 7.5 x 7.5 cm notch bitten out of the outside corner. Measured, not
      // guessed — the boxes come out x ∈ [0,400] and z ∈ [0,400] and nothing
      // covers x,z ∈ [-7.5,0].
      //
      // The 2D plan has never had this: it strokes walls with `lineCap:
      // 'square'`, which is exactly the same half-thickness overhang.
      const joins = new Map<string, number>();
      const jkey = (p: { x: number; y: number }) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
      for (const o of floor.objects) {
        if (o.kind !== 'wall') continue;
        for (const p of [o.a, o.b]) joins.set(jkey(p), (joins.get(jkey(p)) ?? 0) + 1);
      }
      for (const o of floor.objects) {
        if (o.kind === 'image' || !doc.isLayerVisible(o.layer)) continue;   // underlay images are 2D-only
        // Everything a wall-like object adds gets stamped with where it stands,
        // so the doll's-house cull below can find the near side without having
        // to work out what each mesh was for.
        const from = this.staticGroup.children.length;
        if (o.kind === 'wall') this.buildWall(o, openings, floor.elevation, joins);
        else this.buildObject(o, floor.elevation);
        if (o.kind === 'wall' || o.kind === 'beam' || o.kind === 'door' || o.kind === 'window') {
          // Which way the run of wall faces decides which direction it blocks:
          // one running east–west stands between the camera and the rooms when
          // the camera is north or south of it, and never when it is east.
          const c = 'a' in o
            ? { x: (o.a.x + o.b.x) / 2, z: (o.a.y + o.b.y) / 2 }
            : { x: o.x, z: o.y };
          const alongX = 'a' in o
            ? Math.abs(o.b.x - o.a.x) >= Math.abs(o.b.y - o.a.y)
            : Math.abs(Math.cos(o.angle * Math.PI / 180)) >= Math.abs(Math.sin(o.angle * Math.PI / 180));
          const blocks: 'x' | 'z' = alongX ? 'z' : 'x';
          for (let i = from; i < this.staticGroup.children.length; i++) {
            this.staticGroup.children[i].userData.occludeAt = c;
            this.staticGroup.children[i].userData.occludeBlocks = blocks;
          }
        }
        this.growObject(o, grow);
      }
    }
    // shadows for static meshes (furniture clones inherit from the cache)
    this.staticGroup.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m !== ground) { m.castShadow = true; m.receiveShadow = true; } });

    if (!isFinite(minX)) { minX = -200; maxX = 200; minZ = -200; maxZ = 200; }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ, 300) + 200;
    this.moveSpeed = Math.max(300, span * 0.7);   // perceptible regardless of scene scale

    this.sunCenter = { x: cx, z: cz }; this.sunSpan = span;
    const sc = this.dir.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = span * 4; sc.updateProjectionMatrix();
    this.applySun();                              // position the sun for the current time of day
    this.renderer.shadowMap.needsUpdate = true;   // refresh shadows once for this rebuild

    if (reframe) {
      this.controls.target.set(cx, 40, cz);
      this.camera.position.set(cx + span * 0.7, span * 0.8, cz + span * 0.9);
      this.controls.update();
    }
    done('build3d', _t0);
  }

  private growObject(o: Obj, grow: (x: number, z: number) => void) {
    if (o.kind === 'wall' || o.kind === 'beam' || o.kind === 'partition' || o.kind === 'dimension') { grow(o.a.x, o.a.y); grow(o.b.x, o.b.y); }
    else if (o.kind === 'room' && o.poly?.length) { for (const p of o.poly) grow(p.x, p.y); }
    else if (o.kind === 'room' || o.kind === 'furniture') { grow(o.x, o.y); grow(o.x + o.w, o.y + o.h); }
    else grow(o.x, o.y);
  }

  // One continuous band swept along a plan polyline, from yLo..yHi with thickness
  // T. The two side faces share vertices along the sweep, so computeVertexNormals
  // shades the curve smoothly (no per-segment facets/seams); the top and end caps
  // get their own vertices so those edges stay crisp. Double-sided (walls are seen
  // from both rooms). Returns nothing — adds the mesh to the static group.
  private sweptWall(pts: Vec[], yLo: number, yHi: number, T: number, yBase: number, mat: THREE.Material) {
    const n = pts.length;
    if (n < 2 || yHi - yLo < 0.5) return;
    const ht = T / 2, yb = yBase + yLo, yt = yBase + yHi;
    const nrm = pts.map((_, i) => {
      const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
      const tx = q.x - p.x, tz = q.y - p.y, L = Math.hypot(tx, tz) || 1;
      return { x: -tz / L, y: tx / L };   // unit perpendicular to the tangent (in plan)
    });
    const outer = pts.map((p, i) => ({ x: p.x + nrm[i].x * ht, z: p.y + nrm[i].y * ht }));
    const inner = pts.map((p, i) => ({ x: p.x - nrm[i].x * ht, z: p.y - nrm[i].y * ht }));
    const pos: number[] = [], idx: number[] = [];
    const V = (x: number, y: number, z: number) => (pos.push(x, y, z), pos.length / 3 - 1);
    const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
    const oB: number[] = [], oT: number[] = [], iB: number[] = [], iT: number[] = [];
    for (let i = 0; i < n; i++) { oB.push(V(outer[i].x, yb, outer[i].z)); oT.push(V(outer[i].x, yt, outer[i].z)); }
    for (let i = 0; i < n; i++) { iB.push(V(inner[i].x, yb, inner[i].z)); iT.push(V(inner[i].x, yt, inner[i].z)); }
    for (let i = 0; i < n - 1; i++) { quad(oB[i], oB[i + 1], oT[i + 1], oT[i]); quad(iB[i + 1], iB[i], iT[i], iT[i + 1]); }  // outer + inner side faces
    const tO: number[] = [], tI: number[] = [];
    for (let i = 0; i < n; i++) { tO.push(V(outer[i].x, yt, outer[i].z)); tI.push(V(inner[i].x, yt, inner[i].z)); }
    for (let i = 0; i < n - 1; i++) quad(tO[i], tI[i], tI[i + 1], tO[i + 1]);                                              // crisp top face
    const cap = (i: number) => { const a = V(outer[i].x, yb, outer[i].z), b = V(outer[i].x, yt, outer[i].z), c = V(inner[i].x, yt, inner[i].z), d = V(inner[i].x, yb, inner[i].z); quad(a, b, c, d); };
    cap(0); cap(n - 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = (mat as THREE.Material).clone(); m.side = THREE.DoubleSide;
    this.staticGroup.add(new THREE.Mesh(geo, m));
  }

  // Build a wall, cutting real holes for its doors/windows (straight walls).
  private buildWall(
    o: Extract<Obj, { kind: 'wall' }>, openings: Extract<Obj, { kind: 'door' | 'window' }>[],
    yBase: number, joins?: Map<string, number>,
  ) {
    const wallMat = this.wallMaterial(o, dist(o.a, o.b), o.height ?? WALL_H);
    const wh = o.height ?? WALL_H;

    if (o.bulge) {   // curved wall: swept bands, cut where openings sit
      const pts = quadPoints(o.a, wallControl(o.a, o.b, o.bulge), o.b, 48);   // dense sampling → smooth curve
      for (const band of curvedWallBands(pts, o, openings, wh)) {
        this.sweptWall(pts.slice(band.from, band.to + 1), band.yLo, band.yHi, o.thickness, yBase, wallMat);
      }
      return;
    }

    const a = o.a, b = o.b, L = dist(a, b);
    if (L < 1) return;
    const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, ang = -angleDeg(a, b) * Math.PI / 180;
    // Run half a thickness past each end that meets another wall, so the corner
    // square gets filled. Only at joined ends: doing it everywhere would leave a
    // free-standing wall poking 7.5 cm out of its own drawn length. The two
    // walls overlap inside the corner — they are the same material, and an
    // overlap is invisible where a hole is not.
    const jkey = (p: { x: number; y: number }) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
    const half = o.thickness / 2;
    const extA = (joins?.get(jkey(a)) ?? 0) > 1 ? half : 0;
    const extB = (joins?.get(jkey(b)) ?? 0) > 1 ? half : 0;
    for (const piece of wallPieces(o, openings, wh)) {
      const p = {
        ...piece,
        s0: piece.s0 <= 0.01 ? piece.s0 - extA : piece.s0,
        s1: piece.s1 >= L - 0.01 ? piece.s1 + extB : piece.s1,
      };
      const mid = (p.s0 + p.s1) / 2;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(p.s1 - p.s0, p.yHi - p.yLo, o.thickness), wallMat,
      );
      box.position.set(a.x + dir.x * mid, yBase + (p.yLo + p.yHi) / 2, a.y + dir.y * mid);
      box.rotation.y = ang;
      this.staticGroup.add(box);
    }
  }

  private addCeiling(shape: THREE.Shape, yBase: number) {
    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, this.ceilingMaterial());
    mesh.rotation.x = Math.PI / 2;    // plan XY -> world XZ, facing down
    mesh.position.y = yBase + WALL_H;
    mesh.receiveShadow = true;
    this.ceilingGroup.add(mesh);
  }

  private ceilingMaterial(): THREE.Material {
    if (!this._ceilMat) {
      this._ceilMat = new THREE.MeshStandardMaterial({
        color: 0xf4f5f7, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
      });
    }
    return this._ceilMat;
  }

  /**
   * Show the ceilings only when the camera is under them and inside the plan —
   * i.e. when the view is one a person standing in the room would have.
   */
/**
   * Hide the walls between the camera and the plan — the doll's-house view.
   *
   * Looking at a plan from outside, the near walls are opaque and the room
   * behind them is simply not there: the floor finish, the furniture, the whole
   * design. The first multi-room screenshot of the 3D pane looked like an empty
   * grey box with a sliver of wood at the bottom, and everything in it was
   * present and correct — just behind a wall.
   *
   * The test is which side of the plan's centre a wall sits on, projected onto
   * the direction the camera is looking from. Normalised by the plan's half
   * size so the threshold means the same thing on a studio and on a whole
   * floor. Openings are stamped with the same position as their wall, so a
   * hidden wall takes its windows with it rather than leaving frames floating.
   *
   * Only when the camera is outside: from inside a room the near wall is behind
   * the camera anyway, and hiding walls then would open the room to the sky.
   */
  private updateWallVisibility(box: THREE.Box3, inside: boolean) {
    const cam = this.camera.position;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    // Per axis, not projected onto one camera direction: a single cutting plane
    // works when the camera faces a side square-on and fails on the diagonal —
    // it opens the corner nearest the camera and leaves the other two rooms
    // shut. Each run of wall is tested against the axis it actually blocks.
    const halfX = (box.max.x - box.min.x) / 2 || 1;
    const halfZ = (box.max.z - box.min.z) / 2 || 1;
    // Which side the camera is on, with a dead zone around the centre line.
    //
    // Taking the sign directly means that as the camera swings through the
    // middle of the plan, a hair of movement flips it and a whole side of the
    // building appears or vanishes between one frame and the next. Near the
    // centre line the camera is edge-on to those walls anyway — they are not
    // blocking anything — so the last decision is kept until it is clearly past.
    if (Math.abs(cam.x - cx) > halfX * 0.15) this.cullSignX = Math.sign(cam.x - cx) || 1;
    if (Math.abs(cam.z - cz) > halfZ * 0.15) this.cullSignZ = Math.sign(cam.z - cz) || 1;
    const sx = this.cullSignX, sz = this.cullSignZ;

    for (const m of this.staticGroup.children) {
      const at = m.userData.occludeAt as { x: number; z: number } | undefined;
      if (!at) continue;                       // floors and ground always stay
      // Only the outside wall facing the camera comes off. Cutting interior
      // partitions too is what a doll's house does *not* do, and it is what was
      // reported as 「牆壁有時會消失」: a wall in the middle of the plan has no
      // reason to vanish, so when it does it reads as the model breaking rather
      // than as a view being helpful.
      const onEdge = m.userData.occludeBlocks === 'z'
        ? Math.abs(at.z - cz) > halfZ * EDGE_BAND
        : Math.abs(at.x - cx) > halfX * EDGE_BAND;
      const near = onEdge && (m.userData.occludeBlocks === 'z'
        ? (at.z - cz) * sz > halfZ * NEAR_WALL_CUT
        : (at.x - cx) * sx > halfX * NEAR_WALL_CUT);
      m.visible = inside || !near;
    }
  }

  private updateCeilingVisibility() {
    const cam = this.camera.position;
    // One bounding box for both decisions — it was being rebuilt from the whole
    // static group every frame for the ceiling alone.
    const box = this.planBox.makeEmpty();
    for (const m of this.staticGroup.children) if (m.userData.occludeAt) box.expandByObject(m);
    if (box.isEmpty()) box.setFromObject(this.staticGroup);
    const inside = cam.x >= box.min.x && cam.x <= box.max.x
                && cam.z >= box.min.z && cam.z <= box.max.z;

    this.updateWallVisibility(box, inside);

    const g = this.ceilingGroup;
    if (!g.children.length) return;
    let lowest = Infinity;
    for (const c of g.children) lowest = Math.min(lowest, c.position.y);
    g.visible = inside && cam.y < lowest;
  }

  private planBox = new THREE.Box3();
  private cullSignX = 1;
  private cullSignZ = 1;

  private buildObject(o: Obj, yBase = 0) {
    switch (o.kind) {
      case 'room': {
        if (o.poly && o.poly.length >= 3) {
          const shape = new THREE.Shape();
          shape.moveTo(o.poly[0].x, o.poly[0].y);
          for (let i = 1; i < o.poly.length; i++) shape.lineTo(o.poly[i].x, o.poly[i].y);
          shape.closePath();
          const geo = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false });
          // ExtrudeGeometry lays UVs out in world centimetres, so the repeat is
          // the inverse of the material's tile size rather than a count.
          const def = materialDef(o.floor, 'floor');
          const fm = this.floorMaterial(o.floor, def.tileCm, def.tileCm);
          for (const m of [fm.map, fm.normalMap]) if (m) m.repeat.set(1 / def.tileCm, 1 / def.tileCm);
          const floor = new THREE.Mesh(geo, fm);
          floor.rotation.x = Math.PI / 2;   // shape lies in plan XY -> lay flat on world XZ
          floor.position.y = 4 + yBase;
          this.staticGroup.add(floor);
          this.addCeiling(shape, yBase);
        } else {
          const fm = this.floorMaterial(o.floor, o.w, o.h);
          const floor = new THREE.Mesh(new THREE.BoxGeometry(o.w, 4, o.h), fm);
          floor.position.set(o.x + o.w / 2, 2 + yBase, o.y + o.h / 2);
          this.staticGroup.add(floor);
        }
        break;
      }
      case 'beam': {
        const L = dist(o.a, o.b);
        const box = new THREE.Mesh(new THREE.BoxGeometry(L, o.height, o.width), this.mat(0xcfc9bf, { roughness: 0.9 }));
        box.position.set((o.a.x + o.b.x) / 2, yBase + o.elevation + o.height / 2, (o.a.y + o.b.y) / 2);   // underside at elevation
        box.rotation.y = -angleDeg(o.a, o.b) * Math.PI / 180;
        box.castShadow = true; box.receiveShadow = true;
        this.staticGroup.add(box);
        break;
      }
      case 'door': case 'window': {
        const isDoor = o.kind === 'door';
        const h = o.height ?? (isDoor ? 210 : 100);
        const elev = o.elevation ?? (isDoor ? 0 : 90);
        if (o.bulge) {
          // curved-wall opening: smooth arc-swept leaf/glass + frame
          const hw = o.width / 2, ca = Math.cos(o.angle * Math.PI / 180), sa = Math.sin(o.angle * Math.PI / 180);
          const toPlan = (lx: number, ly: number) => ({ x: o.x + lx * ca - ly * sa, y: o.y + lx * sa + ly * ca });
          const plan = quadPoints({ x: -hw, y: 0 }, { x: 0, y: 2 * o.bulge }, { x: hw, y: 0 }, 24).map(pt => toPlan(pt.x, pt.y));
          const d = 10, fw = 6;
          const frameM = this.mat(0xf2f4f7, { roughness: 0.5, metalness: 0.1 });
          const leafM = new THREE.MeshPhysicalMaterial({ color: 0x8a5a34, roughness: 0.4, metalness: 0, clearcoat: 0.35, envMapIntensity: 1.1 });
          const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfe0f0, roughness: 0.03, metalness: 0, transmission: 0.9, thickness: 3, ior: 1.5, transparent: true, opacity: 0.5, envMapIntensity: 1.4 });
          if (isDoor) {
            this.sweptWall(plan, elev, elev + h, 8, yBase, leafM);
          } else {
            this.sweptWall(plan, elev + fw, elev + h - fw, 3, yBase, glass);      // glass
            this.sweptWall(plan, elev, elev + fw, d, yBase, frameM);              // bottom rail
            this.sweptWall(plan, elev + h - fw, elev + h, d, yBase, frameM);      // top rail
            this.sweptWall(plan, elev - 4, elev, d + 6, yBase, this.mat(0xe7eaee, { roughness: 0.6 }));  // sill
          }
        } else {
          const grp = isDoor ? buildDoor3D(o.width, h, elev, o.style) : buildWindow3D(o.width, h, elev, o.style);
          grp.position.set(o.x, yBase, o.y);
          grp.rotation.y = -o.angle * Math.PI / 180;
          this.staticGroup.add(grp);
        }
        break;
      }
      case 'furniture': {
        const inst = getFurnitureModel(o.item, o.w, o.h).clone();
        if (o.color) this.recolour(inst, o.color);
        inst.position.set(o.x + o.w / 2, (o.elevation ?? 0) + yBase, o.y + o.h / 2);
        // *= not =: buildFurniture has already scaled the model to the object's
        // footprint, and getModelHeight measures it *after* that. Assigning
        // would throw that factor away. Invisible until the models stopped all
        // being their own real size — every scan scales by 1, so = and *= were
        // the same thing right up until Kenney's grid-authored kit arrived, and
        // then a 200 cm wardrobe came out 83.
        if (o.height) inst.scale.y *= o.height / getModelHeight(o.item, o.w, o.h);   // stretch to the set height
        inst.rotation.y = -o.angle * Math.PI / 180;
        this.furnGroup.add(inst);
        break;
      }
    }
  }

  // Export the current 3D model — walls, floors, openings and furniture — as a
  // binary glTF (.glb). Geometry + materials/colours are included; the infinite
  // ground plane, sky, and lights are left out so the file holds just the design.
  async exportGLB(filename: string) {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const groundWasVisible = this.ground?.visible ?? true;
    if (this.ground) this.ground.visible = false;   // omit the 80 m ground plane
    try {
      const exporter = new GLTFExporter();
      const gltf = await exporter.parseAsync([this.staticGroup, this.furnGroup], { binary: true, onlyVisible: true }) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([gltf], { type: 'model/gltf-binary' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename.replace(/\.(glb|gltf)$/i, '') + '.glb';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      if (this.ground) this.ground.visible = groundWasVisible;
    }
  }

  /** Where the panorama would be shot from, and which way the viewer should first face. */
  panoramaPose(): { position: THREE.Vector3; yaw: number } {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return { position: this.camera.position.clone(), yaw: Math.atan2(dir.x, -dir.z) };
  }

  /**
   * Capture a 360° equirectangular panorama from the current camera position.
   * Placement ghosts are hidden first — they are editing aids, not part of the
   * design — and the ground plane stays, since a panorama shot indoors sees the
   * floor. Post-processing (GTAO) does not apply to a cube render, so the
   * result is the plain lit scene.
   */
  capturePanorama(): HTMLCanvasElement {
    const hidden: THREE.Object3D[] = [];
    for (const o of [this.ghost, this.openingGhost]) {
      if (o && o.visible) { o.visible = false; hidden.push(o); }
    }
    try {
      return capturePanorama(this.renderer, this.scene, this.camera.position);
    } finally {
      for (const o of hidden) o.visible = true;
    }
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    // A different canvas size is a different workload, so what was too slow before
    // says nothing now — but do not clear it when resize() is the adapter's own
    // doing, or the ceiling it just learned would be erased immediately.
    if (w !== this.lastSize.w || h !== this.lastSize.h) {
      this.lastSize = { w, h };
      this.res = onWorkloadChange(this.res);
    }
    if (this.res.ratio > this.maxPixelRatio) this.res = { ...this.res, ratio: this.maxPixelRatio, goodWindows: 0 };
    this.renderer.setPixelRatio(this.pixelRatio);
    this.composer.setPixelRatio(this.pixelRatio);   // it keeps its own copy, set at construction
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);   // resizes the render/AO passes too
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Adaptive render resolution — the decision lives in ./resolution, this just
  // measures frames and applies the answer.
  //
  // Read live rather than captured once: dragging the window from a Retina screen
  // to an ordinary one halves devicePixelRatio, and a ratio fixed at construction
  // would keep paying for four times the pixels the display can show.
  private get maxPixelRatio() { return Math.min(2, window.devicePixelRatio || 1); }
  private res: ResolutionState = initialState(Math.min(2, window.devicePixelRatio || 1));
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  private lastSize = { w: 0, h: 0 };

  private static readonly SAMPLE = 45;   // ~0.75 s at 60 fps: long enough to be steady, short enough to react

  private get pixelRatio() { return this.res.ratio; }

  /**
   * Only ever fed frames the view was actually trying to draw fast.
   *
   * It decides the pixel ratio from the wall-clock gap between frames, so a
   * deliberately throttled preview at 12 fps reads as 83 ms — four times
   * TOO_SLOW_MS. It would give back a step of resolution every sample window
   * down to the floor, and because a ratio measured as too slow becomes a
   * ceiling that is never retried, the view would stay pinned there after
   * switching back to 3D as the main view. Nothing would look broken; it would
   * just be permanently soft.
   */
  private adaptResolution(now: number) {
    if (this.budget !== 'full') return;
    if (this.lastFrameAt) this.frameTimes.push(now - this.lastFrameAt);
    this.lastFrameAt = now;
    if (this.frameTimes.length < View3D.SAMPLE) return;

    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameTimes.length = 0;

    const before = this.res.ratio;
    this.res = nextResolution(this.res, median, this.maxPixelRatio);
    if (this.res.ratio !== before) this.resize();
  }

  /**
   * How much of a frame the view is worth right now.
   *
   * The 3D view stays alive in both modes so switching to it is instant and the
   * plan is always current. But as the sidebar preview it is a thumbnail a few
   * hundred pixels wide, and it was still running the full composer — ambient
   * occlusion and all — at whatever rate the display asked for, on the same
   * main thread as the 2D canvas the user is actually dragging on. Two things
   * competing for one thread is exactly what "卡頓" is.
   *
   */
  private budget: Budget = 'full';
  private lastDraw = 0;
  setBudget(b: Budget) {
    if (this.budget === b) return;
    this.budget = b;
    this.lastDraw = 0;         // draw the next frame, do not wait out the interval
    // Throw away the timing either side of the switch: the gap that spans it
    // measures the mode change, not the machine.
    this.frameTimes.length = 0;
    this.lastFrameAt = 0;
  }

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    const now = performance.now();
    if (this.budget === 'shared' && now - this.lastDraw < SHARED_FRAME_MS) return;
    this.lastDraw = now;

    const t0 = mark();
    const dt = this.clock.getDelta();
    if (this.fly) { this.applyFly(dt); this.applyPan(dt); }
    this.controls.update();
    this.updateCeilingVisibility();
    this.composer.render();
    this.adaptResolution(now);
    done('render3d', t0);
  };
  start() { if (this.running) return; this.running = true; this.resize(); this.loop(); }
  stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); }
}
