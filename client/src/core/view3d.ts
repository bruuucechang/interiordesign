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
import { curvedWallBands } from './wallGeometry';
import { buildDoor3D, buildWindow3D } from './openings3d';
import { getFurnitureModel, getModelHeight } from './furniture3d';
import { lightParts, LightPart } from './lights3d';
import { Lamps3D } from './lamps3d';
import { stairFlight } from './furnitureBuilders';
import { WalkMode } from './walk3d';
import { isTextField } from './keys3d';
/** Share of the night sky fill kept while the lamps are on (B18): enough to see the corners, not enough to drown the lamps. */
const NIGHT_FILL_WITH_LAMPS = 0.3;
import { emitters, sightLines } from './lightEmit';
import { FEEL_BASE, FEEL_DEFAULTS, FeelSettings, MAX_STEP_S, orbitFeel } from './controlFeel';
import { material as materialDef } from './materials';
import { TimeKey, LIGHTING, sunPose, wallJoins, straightWallBoxes, sweptBand, occluder, cullFrame, cutsAway, objectExtent, sceneFrame, flyAxes, panAxes, lightMeshSpec } from './view3dMath';
import { attachFlyKeys } from './keys3d';
import { mat, floorMaterial, wallMaterial, recolour } from './surfaces3d';
import { PlacementGhosts, OpeningGhostSpec } from './ghosts3d';
import { capturePanorama } from './panorama';
import { nextResolution, onWorkloadChange, initialState, ResolutionState } from './resolution';
import { mark, done } from './perf';
import { DEFAULTS } from '../model/locale-defaults';

/** 台灣住宅的預設牆高——見 model/locale-defaults.ts。 */
const WALL_H = DEFAULTS.wallHeight;

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
  private lightGroup = new THREE.Group();     // light fittings — shared unit geometry/materials, cleared without disposing
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
  private fly = false;   // WASD/QE camera movement
  /** The fittings as real light sources (B18) — see ./lamps3d. */
  lamps!: Lamps3D;
  /** First-person walking (B19) — see ./walk3d. */
  walk!: WalkMode;
  /** null = follow the time of day (on at dusk and night); true/false = the toolbar's override. */
  private lampsOverride: boolean | null = null;
  private lampsOff = new Set<number>();
  onLampsChange: ((on: boolean) => void) | null = null;
  private moveSpeed: number = FEEL_BASE.fly; // cm/s — fixed, not scaled to the scene (see ./controlFeel)
  onFloorClick: ((floor: { x: number; y: number }, sceneHit: { x: number; y: number } | null) => void) | null = null;   // click → floor-plane point + nearest-mesh hit (walls)
  onRotate90: ((deg: number) => void) | null = null;                        // Q/E in 3D → rotate the selected object ±90°
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);      // y = 0
  private downXY: { x: number; y: number } | null = null;
  private ghosts: PlacementGhosts;
  onHover: ((floor: { x: number; y: number } | null, sceneHit: { x: number; y: number } | null) => void) | null = null;  // per-move probe (openings)

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
      this.releaseRetired();   // nothing will be drawn to release them until the context is back
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
    this.ghosts = new PlacementGhosts(this.scene);
    this.lamps = new Lamps3D(this.scene, this.renderer);
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
    this.walk = new WalkMode(this.camera, this.controls, this.renderer.domElement);
    // F walks in and out while the 3D pane has the keyboard; Esc out once the mouse is free
    // (the first Esc only releases pointer lock — the browser keeps that one).
    window.addEventListener('keydown', e => {
      if (!this.fly || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTextField(document.activeElement as HTMLInputElement | null)) return;
      if (e.code === 'KeyF') { e.preventDefault(); this.setWalking(!this.walk.active); }
      else if (e.code === 'Escape' && this.walk.active && !document.pointerLockElement) this.setWalking(false);
    });
    this.setFeel(FEEL_DEFAULTS);

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
    this.scene.add(this.dir, this.dir.target, fill, this.staticGroup, this.furnGroup, this.lightGroup, this.ceilingGroup);

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

    // WASD/QE fly, arrow-key pan and the key HUD — see ./keys3d
    attachFlyKeys(container, this.pressed, () => this.fly, (deg) => this.onRotate90?.(deg));

    // A click (not an orbit drag) on the floor reports the plan coords, so the
    // app can place an object there; while a placement is armed, a translucent
    // ghost of the item follows the cursor on the floor.
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', e => { this.downXY = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', e => {
      const d = this.downXY; this.downXY = null;
      // Walking: a click locks the mouse for looking. With the pointer locked
      // clientX never moves, so every click would read as a still click on the floor.
      if (this.walk.active) return;
      if (!this.onFloorClick || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;   // moved → it was orbiting
      const p = this.floorPoint(e);
      if (p) this.onFloorClick(p, this.sceneHit(e));
    });
    dom.addEventListener('pointermove', e => {
      if (this.walk.active) { this.ghosts.hide(); return; }
      if (this.ghosts.placing) {                     // furniture ghost follows the floor
        const p = this.floorPoint(e);
        if (p) this.ghosts.moveFurniture(p);
      }
      if (this.onHover) this.onHover(this.floorPoint(e), this.sceneHit(e));   // openings: app computes wall snap
    });
    dom.addEventListener('pointerleave', () => {
      this.ghosts.hide();
    });

    this.setTimeOfDay('noon');   // initialize lights + background consistently
  }

  /** Turn, wheel and movement sensitivity — the controls settings panel's multipliers. */
  setFeel(f: FeelSettings) {
    const o = orbitFeel(f);
    this.controls.rotateSpeed = o.rotateSpeed;
    this.controls.dampingFactor = o.dampingFactor;
    this.controls.zoomSpeed = o.zoomSpeed;
    this.moveSpeed = o.moveSpeed;
    if (this.walk) this.walk.look = f.look;
  }

  /** Walk mode on or off; walks in on the storey being edited. */
  setWalking(on: boolean) {
    if (!on) { this.walk.exit(); return; }
    const doc = this.lastDoc;
    if (!doc) return;
    const i = Math.max(0, doc.project.floors.findIndex(f => f.id === doc.project.activeFloorId));
    this.walk.enter(i);
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

  // Placement ghosts — see ./ghosts3d.
  setPlacementPreview(item: { id: string; w: number; h: number } | null) { this.ghosts.setPlacementPreview(item); }
  refreshGhost() { this.ghosts.refreshGhost(); }
  setOpeningGhost(spec: OpeningGhostSpec | null) { this.ghosts.setOpeningGhost(spec); }
  /** Tint the furniture ghost red: the piece would overlap another or sit outside every room (B22). */
  setGhostWarn(on: boolean) { this.ghosts.setWarn(on); }

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
    this.lampsOverride = null;   // a new time of day decides again
    this.applyLamps();
  }

  /** Lamps on at dusk and night unless the toolbar said otherwise. */
  get lampsOn() { return this.lampsOverride ?? (this.time === 'dusk' || this.time === 'night'); }
  setLampsOn(on: boolean) { this.lampsOverride = on; this.applyLamps(); }
  /** Switch groups turned off in the lighting panel; the 3D lamps follow them. */
  setLampCircuitsOff(off: ReadonlySet<number>) { this.lampsOff = new Set(off); this.lastDoc && this.collectLamps(this.lastDoc); }
  private applyLamps() {
    if (!this.lamps) return;
    this.lamps.setOn(this.lampsOn);
    // At night the sky fill is what makes a room readable with no lamps; with
    // lamps on it would wash out their pools, so it drops to a bounce-light level.
    const P = LIGHTING[this.time], f = this.lampsOn && this.time === 'night' ? NIGHT_FILL_WITH_LAMPS : 1;
    this.hemi.intensity = P.hemi * f; this.amb.intensity = P.amb * f; this.scene.environmentIntensity = P.env * f;
    this.onLampsChange?.(this.lampsOn);
  }
  private lastDoc: Doc | null = null;
  private collectLamps(doc: Doc) {
    this.lamps.setStoreys(doc.project.floors.map(f => {
      const objs = f.objects.filter(o => doc.isLayerVisible(o.layer));
      return { base: f.elevation, emitters: emitters(objs, WALL_H, this.lampsOff), walls: sightLines(objs) };
    }));
  }
  private applySun() {
    const sun = sunPose(this.time, this.sunCenter, this.sunSpan);
    this.dir.position.set(...sun.position);
    this.dir.target.position.set(...sun.target);
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
    const { x, y } = panAxes(this.pressed);
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
    const { fwd, strafe, vert } = flyAxes(this.pressed);
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

  /**
   * Take the last build's meshes off the scene, but release their GPU side
   * only after the next frame has been drawn — see `releaseRetired`.
   *
   * three.js reference-counts shader programs and uploaded textures: disposing
   * the last material that uses a program deletes it, and disposing the last
   * texture on an image deletes the upload. Disposing here, before the new
   * scene is drawn, took every count to zero just before the identical new
   * materials asked for the same things — so each rebuild recompiled six
   * programs and re-uploaded fourteen wall textures. Measured on this Mac's
   * Chrome (GPU): 140 of the 150 ms that switching back to 3D cost, while
   * building the scene itself took 9 (docs/notebook.md「切 3D 的實機時間」).
   * Drawn first, the new materials take a reference to what is already
   * there, and the old ones then only bring the counts back down.
   */
  private retired: (() => void)[] = [];
  private clearStatic() {
    const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [], texs: THREE.Texture[] = [];
    this.staticGroup.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) geos.push(m.geometry);
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => {
        const s = mm as THREE.MeshStandardMaterial;
        // Both maps: these are per-surface clones. Missing the normal map here
        // leaks one 512² upload per wall per rebuild, and a rebuild happens
        // after every edit.
        if (s.map) texs.push(s.map);
        if (s.normalMap) texs.push(s.normalMap);
        // A scanned finish's ARM clone sits on both of these; one dispose covers it.
        if (s.roughnessMap) texs.push(s.roughnessMap);
        if (s.aoMap && s.aoMap !== s.roughnessMap) texs.push(s.aoMap);
        mats.push(mm);
      });
    });
    this.staticGroup.clear();
    // Ceilings share one material, so only their geometry is released.
    this.ceilingGroup.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) geos.push(m.geometry); });
    this.ceilingGroup.clear();
    this.retired.push(() => {
      for (const g of geos) g.dispose();
      for (const t of texs) t.dispose();
      for (const m of mats) m.dispose();
    });
  }
  /** Called once a frame has been drawn with whatever replaced the retired meshes. */
  private releaseRetired() {
    if (!this.retired.length) return;
    const r = this.retired; this.retired = [];
    for (const f of r) f();
  }

  build(doc: Doc, reframe = false) {
    const _t0 = mark();
    this.clearStatic();
    this.furnGroup.clear();               // clones share cached geometry/materials — do NOT dispose
    this.lightGroup.clear();              // same: every fitting is a scaled shared unit mesh

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    const grow = (x: number, z: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };

    // Below the slabs, not level with them. A room's floor is a 4 cm box sitting
    // at y = 2, so its underside was exactly coplanar with a ground plane at
    // y = 0 — two surfaces at the same depth, which flickers as the camera moves
    // and which the ambient occlusion pass then samples, so it reads as the
    // texture itself breaking up rather than as two bits of geometry arguing.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), mat(0xccd3dc, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -6;
    ground.receiveShadow = true; this.staticGroup.add(ground);
    this.ground = ground;

    // stack every floor at its elevation
    const floors = doc.project.floors;
    for (const floor of floors) {
      // A flight climbs to the next storey up, however high that is; on the top storey it climbs nowhere.
      const next = floors.filter(f => f.elevation > floor.elevation).sort((a, b) => a.elevation - b.elevation)[0];
      this.stairRise = next ? next.elevation - floor.elevation : 0;
      const openings = floor.objects.filter(o => o.kind === 'door' || o.kind === 'window') as Extract<Obj, { kind: 'door' | 'window' }>[];
      // Which wall ends meet another wall — see wallJoins.
      const joins = wallJoins(floor.objects);
      for (const o of floor.objects) {
        if (o.kind === 'image' || !doc.isLayerVisible(o.layer)) continue;   // underlay images are 2D-only
        // Everything a wall-like object adds gets stamped with where it stands,
        // so the doll's-house cull below can find the near side without having
        // to work out what each mesh was for.
        const from = this.staticGroup.children.length;
        if (o.kind === 'wall') this.buildWall(o, openings, floor.elevation, joins);
        else this.buildObject(o, floor.elevation);
        const occ = occluder(o);
        if (occ) {
          for (let i = from; i < this.staticGroup.children.length; i++) {
            this.staticGroup.children[i].userData.occludeAt = occ.at;
            this.staticGroup.children[i].userData.occludeBlocks = occ.blocks;
          }
        }
        for (const p of objectExtent(o)) grow(p.x, p.y);
      }
    }
    // shadows for static meshes (furniture clones inherit from the cache)
    this.staticGroup.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m !== ground) { m.castShadow = true; m.receiveShadow = true; } });

    const frame = sceneFrame({ minX, maxX, minZ, maxZ });
    const { cx, cz, span } = frame;

    this.sunCenter = { x: cx, z: cz }; this.sunSpan = span;
    const sc = this.dir.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = span * 4; sc.updateProjectionMatrix();
    this.applySun();                              // position the sun for the current time of day
    this.renderer.shadowMap.needsUpdate = true;   // refresh shadows once for this rebuild
    this.lastDoc = doc;
    this.collectLamps(doc);
    this.walk.setPlan(doc);

    if (reframe && !this.walk.active) {   // walking keeps the walker's eye; the walk re-places it below
      this.controls.target.set(...frame.target);
      this.camera.position.set(...frame.eye);
      this.controls.update();
    }
    done('build3d', _t0);
  }

  // A smooth band swept along a plan polyline (geometry in sweptBand), double-
  // sided because walls are seen from both rooms. Adds it to the static group.
  private sweptWall(pts: Vec[], yLo: number, yHi: number, T: number, yBase: number, mat: THREE.Material) {
    const band = sweptBand(pts, yLo, yHi, T, yBase);
    if (!band) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(band.pos, 3));
    geo.setIndex(band.idx); geo.computeVertexNormals();
    const m = (mat as THREE.Material).clone(); m.side = THREE.DoubleSide;
    this.staticGroup.add(new THREE.Mesh(geo, m));
  }

  // Build a wall, cutting real holes for its doors/windows (straight walls).
  private buildWall(
    o: Extract<Obj, { kind: 'wall' }>, openings: Extract<Obj, { kind: 'door' | 'window' }>[],
    yBase: number, joins?: Map<string, number>,
  ) {
    const wallMat = wallMaterial(o, dist(o.a, o.b), o.height ?? WALL_H);
    const wh = o.height ?? WALL_H;

    if (o.bulge) {   // curved wall: swept bands, cut where openings sit
      const pts = quadPoints(o.a, wallControl(o.a, o.b, o.bulge), o.b, 48);   // dense sampling → smooth curve
      for (const band of curvedWallBands(pts, o, openings, wh)) {
        this.sweptWall(pts.slice(band.from, band.to + 1), band.yLo, band.yHi, o.thickness, yBase, wallMat);
      }
      return;
    }

    for (const w of straightWallBoxes(o, openings, wh, yBase, joins)) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w.len, w.height, w.depth), wallMat);
      box.position.set(...w.position);
      box.rotation.y = w.rotationY;
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
    // The per-axis test and the dead zone around the centre line: cullFrame.
    const f = cullFrame(box, this.camera.position, { sx: this.cullSignX, sz: this.cullSignZ });
    this.cullSignX = f.sx; this.cullSignZ = f.sz;
    for (const m of this.staticGroup.children) {
      const at = m.userData.occludeAt as { x: number; z: number } | undefined;
      if (!at) continue;                       // floors and ground always stay
      m.visible = inside || !cutsAway({ at, blocks: m.userData.occludeBlocks }, f);
    }
  }

  /**
   * Show the ceilings only when the camera is under them and inside the plan —
   * i.e. when the view is one a person standing in the room would have.
   */
  private updateCeilingVisibility() {
    const cam = this.camera.position;
    // One bounding box for both decisions — it was being rebuilt from the whole
    // static group every frame for the ceiling alone.
    const box = this.planBox.makeEmpty();
    for (const m of this.staticGroup.children) if (m.userData.occludeAt) box.expandByObject(m);
    if (box.isEmpty()) box.setFromObject(this.staticGroup);
    // Walking is always inside, with no doll's-house cut: a walker reaching the
    // edge of the plan is at a window, not looking in from outside.
    const inside = this.walk.active || (cam.x >= box.min.x && cam.x <= box.max.x
                && cam.z >= box.min.z && cam.z <= box.max.z);

    this.updateWallVisibility(box, inside);

    const g = this.ceilingGroup;
    if (!g.children.length) return;
    if (this.walk.active) {
      // Each storey's ceiling over its own walker: lowest-ceiling-only hid them all on the upper storey
      g.visible = true;
      for (const c of g.children) c.visible = c.position.y > cam.y;
      return;
    }
    let lowest = Infinity;
    for (const c of g.children) { lowest = Math.min(lowest, c.position.y); c.visible = true; }
    g.visible = inside && cam.y < lowest;
  }

  private planBox = new THREE.Box3();
  /** Height the stairs being built climb: up to the next storey (set per storey in build). */
  private stairRise = DEFAULTS.wallHeight;
  /** Built flights by size and rise. Kept like the furniture cache: furnGroup is cleared without disposing. */
  private stairs = new Map<string, THREE.Object3D>();
  private stairModel(w: number, h: number): THREE.Object3D {
    const rise = Math.max(2, this.stairRise), k = `${w}|${h}|${rise}`;
    let m = this.stairs.get(k);
    if (!m) this.stairs.set(k, m = stairFlight(w, h, rise));
    return m;
  }
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
          const fm = floorMaterial(o.floor, def.tileCm, def.tileCm);
          for (const m of [fm.map, fm.normalMap]) if (m) m.repeat.set(1 / def.tileCm, 1 / def.tileCm);
          const floor = new THREE.Mesh(geo, fm);
          floor.rotation.x = Math.PI / 2;   // shape lies in plan XY -> lay flat on world XZ
          floor.position.y = 4 + yBase;
          this.staticGroup.add(floor);
          this.addCeiling(shape, yBase);
        } else {
          const fm = floorMaterial(o.floor, o.w, o.h);
          const floor = new THREE.Mesh(new THREE.BoxGeometry(o.w, 4, o.h), fm);
          floor.position.set(o.x + o.w / 2, 2 + yBase, o.y + o.h / 2);
          this.staticGroup.add(floor);
        }
        break;
      }
      case 'beam': {
        const L = dist(o.a, o.b);
        const box = new THREE.Mesh(new THREE.BoxGeometry(L, o.height, o.width), mat(0xcfc9bf, { roughness: 0.9 }));
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
          const frameM = mat(0xf2f4f7, { roughness: 0.5, metalness: 0.1 });
          const leafM = new THREE.MeshPhysicalMaterial({ color: 0x8a5a34, roughness: 0.4, metalness: 0, clearcoat: 0.35, envMapIntensity: 1.1 });
          const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfe0f0, roughness: 0.03, metalness: 0, transmission: 0.9, thickness: 3, ior: 1.5, transparent: true, opacity: 0.5, envMapIntensity: 1.4 });
          if (isDoor) {
            this.sweptWall(plan, elev, elev + h, 8, yBase, leafM);
          } else {
            this.sweptWall(plan, elev + fw, elev + h - fw, 3, yBase, glass);      // glass
            this.sweptWall(plan, elev, elev + fw, d, yBase, frameM);              // bottom rail
            this.sweptWall(plan, elev + h - fw, elev + h, d, yBase, frameM);      // top rail
            this.sweptWall(plan, elev - 4, elev, d + 6, yBase, mat(0xe7eaee, { roughness: 0.6 }));  // sill
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
        const inst = o.item === 'stairs' ? this.stairModel(o.w, o.h).clone() : getFurnitureModel(o.item, o.w, o.h).clone();
        if (o.color) recolour(inst, o.color, this.tintCache);
        inst.position.set(o.x + o.w / 2, (o.elevation ?? 0) + yBase, o.y + o.h / 2);
        // *= not =: buildFurniture has already scaled the model to the object's
        // footprint, and getModelHeight measures it *after* that. Assigning
        // would throw that factor away. Invisible until the models stopped all
        // being their own real size — every scan scales by 1, so = and *= were
        // the same thing right up until Kenney's grid-authored kit arrived, and
        // then a 200 cm wardrobe came out 83.
        if (o.height && o.item !== 'stairs') inst.scale.y *= o.height / getModelHeight(o.item, o.w, o.h);   // stretch to the set height
        inst.rotation.y = -o.angle * Math.PI / 180;
        this.furnGroup.add(inst);
        break;
      }
      case 'electrical': {
        // Against the ceiling 3D actually draws, not the floor's stored height,
        // so a flush fitting sits on the surface you see.
        for (const p of lightParts(o, WALL_H)) this.lightGroup.add(this.lightMesh(p, yBase));
        break;
      }
    }
  }

  private lightUnits?: { box: THREE.BoxGeometry; cyl: THREE.CylinderGeometry; glow: THREE.Material; body: THREE.Material };

  /**
   * One fitting primitive as a mesh: a unit box or cylinder scaled to size, so
   * eighty fittings share two geometries and two materials. The glowing part is
   * unlit (MeshBasicMaterial) — it reads as lit in every time-of-day preset
   * without being a light source, which is the point (S1: no real lights).
   */
  private lightMesh(p: LightPart, yBase: number): THREE.Mesh {
    if (!this.lightUnits) {
      this.lightUnits = {
        box: new THREE.BoxGeometry(1, 1, 1),
        cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
        glow: new THREE.MeshBasicMaterial({ color: 0xfff3d6 }),
        body: mat(0xe9eaec, { roughness: 0.5, metalness: 0.2 }),
      };
    }
    const u = this.lightUnits;
    const t = lightMeshSpec(p, yBase);
    const m = new THREE.Mesh(t.unit === 'box' ? u.box : u.cyl, t.glow ? u.glow : u.body);
    m.scale.set(...t.scale);
    m.rotation.y = t.rotationY;
    m.position.set(...t.position);
    return m;
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
      const gltf = await exporter.parseAsync([this.staticGroup, this.furnGroup, this.lightGroup], { binary: true, onlyVisible: true }) as ArrayBuffer;
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
    for (const o of this.ghosts.objects()) {
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
    // Capped like a game's tick: a hitch (a rebuild, a texture upload) must not
    // turn one held W into a several-metre jump.
    const dt = Math.min(this.clock.getDelta(), MAX_STEP_S);
    if (this.walk.active) this.walk.frame(dt, this.pressed);
    else {
      if (this.fly) { this.applyFly(dt); this.applyPan(dt); }
      this.controls.update();   // never while walking: it would swing the camera back round the old target
    }
    this.lamps.update(this.camera.position, this.controls.target, WALL_H, now);
    this.updateCeilingVisibility();
    this.composer.render();
    this.releaseRetired();
    this.adaptResolution(now);
    done('render3d', t0);
  };
  start() { if (this.running) return; this.running = true; this.resize(); this.loop(); }
  stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); }
}
