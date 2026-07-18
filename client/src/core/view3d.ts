import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Doc } from '../model/doc';
import { Obj, Vec } from '../model/types';
import { dist, angleDeg, quadPoints, wallControl, closestOnSegment } from './geometry';
import { getFurnitureModel, getModelHeight } from './furniture3d';
import { woodClone, tileClone } from './textures3d';

const WALL_H = 270; // cm

// Time-of-day lighting presets: sun colour/intensity/angle, sky fills, exposure.
type TimeKey = 'morning' | 'noon' | 'dusk' | 'night';
const LIGHTING: Record<TimeKey, { sun: number; intensity: number; hemi: number; amb: number; env: number; bg: number; exposure: number; elev: number; azim: number }> = {
  morning: { sun: 0xffe6c2, intensity: 2.0, hemi: 0.55, amb: 0.16, env: 0.50, bg: 0xdfe8f0, exposure: 1.00, elev: 20, azim: 100 },
  noon:    { sun: 0xfff4e2, intensity: 2.0, hemi: 0.48, amb: 0.12, env: 0.40, bg: 0xdbe2ea, exposure: 0.85, elev: 68, azim: 40 },
  dusk:    { sun: 0xff9e5e, intensity: 1.9, hemi: 0.40, amb: 0.14, env: 0.38, bg: 0xe9c9a8, exposure: 1.05, elev: 12, azim: -60 },
  night:   { sun: 0x9fb6ff, intensity: 0.5, hemi: 0.12, amb: 0.10, env: 0.10, bg: 0x161c28, exposure: 1.15, elev: 42, azim: 20 },
};

// plan coords (x, y) map to 3D (X = x, Z = y, Y = up)
export class View3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private renderPass!: RenderPass;
  private sky!: THREE.Mesh;
  private gtao: GTAOPass;
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
  private keyChips: Record<string, HTMLElement> = {};
  private fly = false;   // WASD/QE camera movement
  private moveSpeed = 500; // cm/s, scaled to the scene in build()
  onFloorClick: ((plan: { x: number; y: number }) => void) | null = null;   // click (not drag) on the floor → plan coords
  onRotate90: ((deg: number) => void) | null = null;                        // Q/E in 3D → rotate the selected object ±90°
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);      // y = 0
  private downXY: { x: number; y: number } | null = null;
  private previewItem: { id: string; w: number; h: number } | null = null;  // furniture to ghost while placing
  private ghost: THREE.Object3D | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
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

    this.camera = new THREE.PerspectiveCamera(52, 1, 1, 200000);
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
    this.scene.add(this.dir, this.dir.target, fill, this.staticGroup, this.furnGroup);

    // Post-processing: ground-truth ambient occlusion for object-to-floor and
    // object-to-object contact darkening — the main recognizability boost.
    this.composer = new EffectComposer(this.renderer);
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
      const mv = MOVE[e.code], up = isShift(e.code), down = e.code === 'Space';
      if (!mv && !up && !down) return;
      if (el && el !== document.body) el.blur();    // drop focus off a number field so it stops eating keys
      e.preventDefault();
      if (up) { this.pressed.add('up'); this.flashChip('shift', true); }         // Shift → rise
      else if (down) { this.pressed.add('down'); this.flashChip('space', true); } // Space → descend
      else { this.pressed.add(mv); this.flashChip(mv, true); }
    }, { capture: true });
    window.addEventListener('keyup', e => {
      const mv = MOVE[e.code];
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
      if (p) this.onFloorClick(p);
    });
    dom.addEventListener('pointermove', e => {
      if (!this.previewItem) return;
      const p = this.floorPoint(e);
      const g = p ? (this.ghost ?? this.buildGhost()) : null;
      if (g && p) { g.visible = true; g.position.set(p.x, 0, p.y); }
    });
    dom.addEventListener('pointerleave', () => { if (this.ghost) this.ghost.visible = false; });

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

  // Arm/disarm the placement ghost. Pass the furniture item (id + size) to show
  // a translucent preview that follows the cursor, or null to remove it.
  setPlacementPreview(item: { id: string; w: number; h: number } | null) {
    const same = item && this.previewItem && item.id === this.previewItem.id && item.w === this.previewItem.w && item.h === this.previewItem.h;
    this.previewItem = item;
    if (!item || !same) this.clearGhost();   // rebuilt for the new item on the next hover
  }

  private buildGhost(): THREE.Object3D | null {
    if (!this.previewItem) return null;
    const g = getFurnitureModel(this.previewItem.id, this.previewItem.w, this.previewItem.h).clone(true);
    const ghostMat = (m: THREE.Material) => { const c = m.clone(); (c as any).transparent = true; (c as any).opacity = 0.42; (c as any).depthWrite = false; return c; };
    g.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false; m.receiveShadow = false;
      m.material = Array.isArray(m.material) ? m.material.map(ghostMat) : ghostMat(m.material);
    });
    g.renderOrder = 999;
    this.scene.add(g);
    this.ghost = g;
    return g;
  }

  private clearGhost() {
    if (!this.ghost) return;
    this.ghost.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => mm.dispose()); });
    this.scene.remove(this.ghost);
    this.ghost = null;
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

  // floor finish: hex color, 'tile', or wood (default)
  private floorMaterial(floor: string | undefined, u: number, v: number): THREE.MeshStandardMaterial {
    if (floor && floor.startsWith('#')) return new THREE.MeshStandardMaterial({ color: new THREE.Color(floor).getHex(), roughness: 0.8, metalness: 0.02, envMapIntensity: 1.1 });
    const map = floor === 'tile' ? tileClone(u, v) : woodClone(u, v);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.02, envMapIntensity: 1.2 });   // slightly polished floor
  }

  private clearStatic() {
    this.staticGroup.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => { const s = mm as THREE.MeshStandardMaterial; if (s.map) s.map.dispose(); mm.dispose(); });
    });
    this.staticGroup.clear();
  }

  build(doc: Doc, reframe = false) {
    this.clearStatic();
    this.furnGroup.clear();               // clones share cached geometry/materials — do NOT dispose

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    const grow = (x: number, z: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), this.mat(0xccd3dc, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.staticGroup.add(ground);
    this.ground = ground;

    // stack every floor at its elevation
    for (const floor of doc.project.floors) {
      const openings = floor.objects.filter(o => o.kind === 'door' || o.kind === 'window') as Extract<Obj, { kind: 'door' | 'window' }>[];
      for (const o of floor.objects) {
        if (o.kind === 'image' || !doc.isLayerVisible(o.layer)) continue;   // underlay images are 2D-only
        if (o.kind === 'wall') this.buildWall(o, openings, floor.elevation);
        else this.buildObject(o, floor.elevation);
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
  }

  private growObject(o: Obj, grow: (x: number, z: number) => void) {
    if (o.kind === 'wall' || o.kind === 'beam' || o.kind === 'dimension') { grow(o.a.x, o.a.y); grow(o.b.x, o.b.y); }
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
  private buildWall(o: Extract<Obj, { kind: 'wall' }>, openings: Extract<Obj, { kind: 'door' | 'window' }>[], yBase: number) {
    const wallMat = this.mat(o.color ? new THREE.Color(o.color).getHex() : 0xeceff4, { roughness: 0.92 });
    const wh = o.height ?? WALL_H;
    if (o.bulge) {   // curved wall: one smooth swept band, with sill/header where openings sit
      const pts = quadPoints(o.a, wallControl(o.a, o.b, o.bulge), o.b, 48);   // dense sampling → smooth curve
      const N = pts.length;
      const nearestIdx = (p: Vec) => { let bi = 0, bd = Infinity; for (let i = 0; i < N; i++) { const d = dist(p, pts[i]); if (d < bd) { bd = d; bi = i; } } return { bi, bd }; };
      // map each opening on this wall to an arc-index span (its endpoints lie on the arc)
      type Hole = { lo: number; hi: number; elev: number; oh: number };
      const holes: Hole[] = openings.map(op => {
        const half = op.width / 2, ca = Math.cos(op.angle * Math.PI / 180), sa = Math.sin(op.angle * Math.PI / 180);
        const r0 = nearestIdx({ x: op.x - half * ca, y: op.y - half * sa }), r1 = nearestIdx({ x: op.x + half * ca, y: op.y + half * sa });
        return { lo: Math.min(r0.bi, r1.bi), hi: Math.max(r0.bi, r1.bi), d: Math.max(r0.bd, r1.bd), elev: op.elevation ?? (op.kind === 'door' ? 0 : 90), oh: op.height ?? (op.kind === 'door' ? 210 : 100) };
      }).filter(h => h.d <= o.thickness / 2 + 15 && h.hi > h.lo);
      const holeAt = (i: number) => holes.find(hl => i - 1 < hl.hi && i > hl.lo);   // opening spanning segment i (pts[i-1]->pts[i])
      // group consecutive segments with the same state (same hole / solid) into ranges
      let from = 0, cur = holeAt(1);
      const flush = (to: number, hole?: Hole) => {
        const band = pts.slice(from, to + 1);
        if (!hole) this.sweptWall(band, 0, wh, o.thickness, yBase, wallMat);
        else { this.sweptWall(band, 0, hole.elev, o.thickness, yBase, wallMat); this.sweptWall(band, hole.elev + hole.oh, wh, o.thickness, yBase, wallMat); }
      };
      for (let i = 2; i < N; i++) { const h = holeAt(i); if (h !== cur) { flush(i - 1, cur); from = i - 1; cur = h; } }
      flush(N - 1, cur);
      return;
    }
    const a = o.a, b = o.b, L = dist(a, b);
    if (L < 1) return;
    const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, ang = -angleDeg(a, b) * Math.PI / 180;
    // a solid wall block from distance s0..s1 along the wall, spanning height yLo..yHi
    const piece = (s0: number, s1: number, yLo: number, yHi: number) => {
      if (s1 - s0 <= 0.5 || yHi - yLo <= 0.5) return;
      const mid = (s0 + s1) / 2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(s1 - s0, yHi - yLo, o.thickness), wallMat);
      box.position.set(a.x + dir.x * mid, yBase + (yLo + yHi) / 2, a.y + dir.y * mid);
      box.rotation.y = ang;
      this.staticGroup.add(box);
    };
    const holes = openings
      .map(op => { const cs = closestOnSegment({ x: op.x, y: op.y }, a, b); return { op, cs, d: dist({ x: op.x, y: op.y }, cs.point) }; })
      .filter(h => h.d <= o.thickness / 2 + 10 && h.cs.t >= -0.001 && h.cs.t <= 1.001)
      .map(h => { const dc = h.cs.t * L; return { op: h.op, s: Math.max(0, dc - h.op.width / 2), e: Math.min(L, dc + h.op.width / 2) }; })
      .sort((x, y) => x.s - y.s);
    let cursor = 0;
    for (const h of holes) {
      piece(cursor, h.s, 0, wh);                                    // solid wall before the opening
      const oh = h.op.height ?? (h.op.kind === 'door' ? 210 : 100);
      const elev = h.op.elevation ?? (h.op.kind === 'door' ? 0 : 90);
      piece(h.s, h.e, 0, elev);                                     // sill under the opening (0 for doors)
      piece(h.s, h.e, elev + oh, wh);                               // header above the opening
      cursor = Math.max(cursor, h.e);
    }
    piece(cursor, L, 0, wh);                                        // remaining solid wall
  }

  // A framed door in one of several styles (single / double / sliding / glass).
  // Built in local coords: X along the opening (width), Z = wall normal, Y up.
  private buildDoor3D(width: number, h: number, elev: number, style = 'single'): THREE.Group {
    const g = new THREE.Group();
    const d = 12, fw = 7;
    const frameM = this.mat(0x6b4a2a, { roughness: 0.6 });
    const leafM = new THREE.MeshPhysicalMaterial({ color: 0x8a5a34, roughness: 0.4, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 1.1 });
    const panelM = new THREE.MeshPhysicalMaterial({ color: 0x7a4e2c, roughness: 0.45, metalness: 0, clearcoat: 0.25, envMapIntensity: 1.0 });
    const metalM = this.mat(0xc2c7cf, { roughness: 0.28, metalness: 0.92, envMapIntensity: 1.35 });
    const glassM = new THREE.MeshPhysicalMaterial({ color: 0xbfe0f0, roughness: 0.03, metalness: 0, transmission: 0.9, thickness: 3, ior: 1.5, transparent: true, opacity: 0.5, envMapIntensity: 1.4 });
    const bx = (bw: number, bh: number, bd: number, m: THREE.Material, x: number, y: number, z: number) => {
      const me = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.5, bw), Math.max(0.5, bh), Math.max(0.5, bd)), m); me.position.set(x, y, z); g.add(me); return me;
    };
    bx(fw, h, d, frameM, -width / 2 + fw / 2, elev + h / 2, 0);           // jambs + header
    bx(fw, h, d, frameM, width / 2 - fw / 2, elev + h / 2, 0);
    bx(width, fw, d, frameM, 0, elev + h - fw / 2, 0);
    const lw = width - 2 * fw, lh = h - fw, ld = d * 0.55;
    const putHandle = (hx: number) => {                                   // rose + lever, both faces, pointing inward
      const hy = elev + h * 0.45, inward = hx >= 0 ? -1 : 1;
      for (const zs of [1, -1]) {
        bx(3, 3, 5, metalM, hx, hy, zs * (ld / 2 + 1));
        const lever = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 11, 10), metalM);
        lever.rotation.z = Math.PI / 2; lever.position.set(hx + inward * 6, hy, zs * (ld / 2 + 3)); g.add(lever);
      }
    };
    const panelLeaf = (cx: number, cw: number) => {                       // wood leaf with two recessed panels
      bx(cw, lh, ld, leafM, cx, elev + lh / 2, 0);
      for (const zs of [1, -1]) { const zz = zs * (ld / 2 + 0.6); bx(cw * 0.66, lh * 0.36, 1.2, panelM, cx, elev + lh * 0.7, zz); bx(cw * 0.66, lh * 0.34, 1.2, panelM, cx, elev + lh * 0.3, zz); }
    };
    if (style === 'double') {
      const cw = lw / 2 - 0.5;
      for (const s of [-1, 1]) { const cx = s * (lw / 4 + 0.25); panelLeaf(cx, cw); putHandle(cx - s * (cw / 2 - 5)); }  // handles at the meeting stile
    } else if (style === 'sliding') {
      for (const s of [-1, 1]) {                                          // two panels in a track, offset in depth
        const cx = s * (lw / 4 - 1), pw = lw / 2 + 3, pz = s * ld * 0.32;
        bx(pw, lh, ld * 0.6, leafM, cx, elev + lh / 2, pz);
        bx(2.6, lh * 0.42, 3, metalM, cx - s * (pw / 2 - 6), elev + lh * 0.5, pz + s * 2);   // flush pull
      }
    } else if (style === 'glass') {
      bx(lw, lh, ld, leafM, 0, elev + lh / 2, 0);                         // wood stile-and-rail
      bx(lw - 12, lh - 16, ld + 2, glassM, 0, elev + lh / 2 + 3, 0);      // glazed panel
      bx(lw - 12, 5, ld + 2.2, leafM, 0, elev + lh * 0.34, 0);           // lock rail
      putHandle(lw / 2 - 7);
    } else {                                                              // single
      panelLeaf(0, lw); putHandle(lw / 2 - 7);
    }
    return g;
  }

  // A framed window in one of several styles (single grid / casement / sliding /
  // picture). Same local coords as buildDoor3D.
  private buildWindow3D(width: number, h: number, elev: number, style = 'single'): THREE.Group {
    const g = new THREE.Group();
    const d = 10, fw = 6, iw = width - 2 * fw, ih = h - 2 * fw;
    const frameM = this.mat(0xf2f4f7, { roughness: 0.5, metalness: 0.1 });
    const sillM = this.mat(0xe7eaee, { roughness: 0.6 });
    const glass = () => new THREE.MeshPhysicalMaterial({ color: 0xbfe0f0, roughness: 0.03, metalness: 0, transmission: 0.9, thickness: 3, ior: 1.5, transparent: true, opacity: 0.5, envMapIntensity: 1.4 });
    const bx = (bw: number, bh: number, bd: number, m: THREE.Material, x: number, y: number, z: number) => {
      const me = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.5, bw), Math.max(0.5, bh), Math.max(0.5, bd)), m); me.position.set(x, y, z); g.add(me); return me;
    };
    bx(fw, h, d, frameM, -width / 2 + fw / 2, elev + h / 2, 0);           // outer sash
    bx(fw, h, d, frameM, width / 2 - fw / 2, elev + h / 2, 0);
    bx(width, fw, d, frameM, 0, elev + h - fw / 2, 0);
    bx(width, fw, d, frameM, 0, elev + fw / 2, 0);
    bx(width + 6, 4, d + 7, sillM, 0, elev - 1, 2);                       // sill
    if (style === 'sliding') {                                           // two sashes offset in depth + meeting stile
      bx(iw / 2 + 3, ih, 2, glass(), -iw / 4, elev + h / 2, 2.5);
      bx(iw / 2 + 3, ih, 2, glass(), iw / 4, elev + h / 2, -2.5);
      bx(4, ih, d * 0.7, frameM, 0, elev + h / 2, 0);
    } else {
      bx(iw, ih, 2, glass(), 0, elev + h / 2, 0);                        // single pane
      if (style === 'single') { bx(3, ih, d * 0.7, frameM, 0, elev + h / 2, 0); bx(iw, 3, d * 0.7, frameM, 0, elev + h / 2, 0); }  // grid cross
      else if (style === 'casement') bx(3, ih, d * 0.7, frameM, 0, elev + h / 2, 0);   // centre mullion
      // picture: no mullion
    }
    return g;
  }

  private buildObject(o: Obj, yBase = 0) {
    switch (o.kind) {
      case 'room': {
        if (o.poly && o.poly.length >= 3) {
          const shape = new THREE.Shape();
          shape.moveTo(o.poly[0].x, o.poly[0].y);
          for (let i = 1; i < o.poly.length; i++) shape.lineTo(o.poly[i].x, o.poly[i].y);
          shape.closePath();
          const geo = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false });
          const fm = this.floorMaterial(o.floor, 1, 1);
          if (fm.map) fm.map.repeat.set(1 / 240, 1 / 240);   // ExtrudeGeometry UVs are world cm
          const floor = new THREE.Mesh(geo, fm);
          floor.rotation.x = Math.PI / 2;   // shape lies in plan XY -> lay flat on world XZ
          floor.position.y = 4 + yBase;
          this.staticGroup.add(floor);
        } else {
          const fm = this.floorMaterial(o.floor, Math.max(1, Math.round(o.w / 120)), Math.max(1, Math.round(o.h / 120)));
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
          const grp = isDoor ? this.buildDoor3D(o.width, h, elev, o.style) : this.buildWindow3D(o.width, h, elev, o.style);
          grp.position.set(o.x, yBase, o.y);
          grp.rotation.y = -o.angle * Math.PI / 180;
          this.staticGroup.add(grp);
        }
        break;
      }
      case 'furniture': {
        const inst = getFurnitureModel(o.item, o.w, o.h).clone();
        inst.position.set(o.x + o.w / 2, (o.elevation ?? 0) + yBase, o.y + o.h / 2);
        if (o.height) inst.scale.y = o.height / getModelHeight(o.item, o.w, o.h);   // stretch to the set height
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

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);   // resizes the render/AO passes too
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (!this.running) return;
    const dt = this.clock.getDelta();
    if (this.fly) this.applyFly(dt);
    this.controls.update();
    this.composer.render();
    this.raf = requestAnimationFrame(this.loop);
  };
  start() { if (this.running) return; this.running = true; this.resize(); this.loop(); }
  stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); }
}
