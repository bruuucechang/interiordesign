import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Doc } from '../model/doc';
import { Obj } from '../model/types';
import { dist, angleDeg, quadPoints, wallControl } from './geometry';
import { getFurnitureModel, getModelHeight } from './furniture3d';
import { woodClone, tileClone } from './textures3d';

const WALL_H = 270; // cm

// Time-of-day lighting presets: sun colour/intensity/angle, sky fills, exposure.
type TimeKey = 'morning' | 'noon' | 'dusk' | 'night';
const LIGHTING: Record<TimeKey, { sun: number; intensity: number; hemi: number; amb: number; env: number; bg: number; exposure: number; elev: number; azim: number }> = {
  morning: { sun: 0xffe6c2, intensity: 2.0, hemi: 0.55, amb: 0.16, env: 0.50, bg: 0xdfe8f0, exposure: 1.00, elev: 20, azim: 100 },
  noon:    { sun: 0xfff4e2, intensity: 2.4, hemi: 0.75, amb: 0.15, env: 0.55, bg: 0xdbe2ea, exposure: 1.02, elev: 68, azim: 40 },
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
    for (const label of ['W', 'A', 'S', 'D', 'Q', 'E']) {
      const c = document.createElement('div');
      c.textContent = label;
      c.style.cssText = 'min-width:15px;text-align:center;padding:2px 4px;border-radius:4px;background:rgba(255,255,255,0.06);color:#8b93a3;transition:background .07s,color .07s;';
      hud.appendChild(c); this.keyChips[label.toLowerCase()] = c;
    }
    container.appendChild(hud);

    // Match on e.code (physical key position), NOT e.key: a Chinese/Japanese IME or
    // a non-US layout rewrites e.key (W becomes "Process" or a composition char) while
    // e.code stays "KeyW". Matching e.key was silently dropping WASD under an active IME.
    const MOVE: Record<string, string> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyQ: 'q', KeyE: 'e' };
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
      const mv = MOVE[e.code];
      if (!mv && !isShift(e.code)) return;
      const el = document.activeElement as HTMLElement | null;
      if (isTextField(el)) return;                 // genuinely typing — leave the keys alone
      if (el && el !== document.body) el.blur();    // drop focus off a number field so it stops eating keys
      if (mv) e.preventDefault();
      this.pressed.add(mv || 'shift');
      if (mv) this.flashChip(mv, true);
    }, { capture: true });
    window.addEventListener('keyup', e => {
      const mv = MOVE[e.code];
      if (mv) { this.pressed.delete(mv); this.flashChip(mv, false); }
      else if (isShift(e.code)) this.pressed.delete('shift');
    });
    window.addEventListener('blur', () => { this.pressed.clear(); for (const k in this.keyChips) this.flashChip(k, false); });   // don't let a held key stick across an alt-tab
    this.setTimeOfDay('noon');   // initialize lights + background consistently
  }

  setFly(on: boolean) { this.fly = on; if (!on) this.pressed.clear(); }

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
    if (P.has('e')) vert += 1;   // up
    if (P.has('q')) vert -= 1;   // down
    if (!fwd && !strafe && !vert) return;
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const speed = this.moveSpeed * dt * (P.has('shift') ? 2.6 : 1);
    const move = new THREE.Vector3().addScaledVector(dir, fwd * speed).addScaledVector(right, strafe * speed);
    move.y += vert * speed;
    this.camera.position.add(move); this.controls.target.add(move);
  }

  private mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04, ...opts });
  }

  // floor finish: hex color, 'tile', or wood (default)
  private floorMaterial(floor: string | undefined, u: number, v: number): THREE.MeshStandardMaterial {
    if (floor && floor.startsWith('#')) return new THREE.MeshStandardMaterial({ color: new THREE.Color(floor).getHex(), roughness: 0.8, metalness: 0.02 });
    const map = floor === 'tile' ? tileClone(u, v) : woodClone(u, v);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.72, metalness: 0.02 });
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
    const objs = doc.objects;

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    const grow = (x: number, z: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), this.mat(0xccd3dc, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.staticGroup.add(ground);

    for (const o of objs) {
      if (o.kind === 'image' || !doc.isLayerVisible(o.layer)) continue;   // underlay images are 2D-only
      this.buildObject(o); this.growObject(o, grow);
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
    if (o.kind === 'wall' || o.kind === 'dimension') { grow(o.a.x, o.a.y); grow(o.b.x, o.b.y); }
    else if (o.kind === 'room' && o.poly?.length) { for (const p of o.poly) grow(p.x, p.y); }
    else if (o.kind === 'room' || o.kind === 'furniture') { grow(o.x, o.y); grow(o.x + o.w, o.y + o.h); }
    else grow(o.x, o.y);
  }

  private buildObject(o: Obj) {
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
          floor.position.y = 4;
          this.staticGroup.add(floor);
        } else {
          const fm = this.floorMaterial(o.floor, Math.max(1, Math.round(o.w / 120)), Math.max(1, Math.round(o.h / 120)));
          const floor = new THREE.Mesh(new THREE.BoxGeometry(o.w, 4, o.h), fm);
          floor.position.set(o.x + o.w / 2, 2, o.y + o.h / 2);
          this.staticGroup.add(floor);
        }
        break;
      }
      case 'wall': {
        const wallMat = this.mat(o.color ? new THREE.Color(o.color).getHex() : 0xeceff4, { roughness: 0.92 });
        const wh = o.height ?? WALL_H;
        const seg = (p1: { x: number; y: number }, p2: { x: number; y: number }, extend: number) => {
          const box = new THREE.Mesh(new THREE.BoxGeometry(dist(p1, p2) + extend, wh, o.thickness), wallMat);
          box.position.set((p1.x + p2.x) / 2, wh / 2, (p1.y + p2.y) / 2);
          box.rotation.y = -angleDeg(p1, p2) * Math.PI / 180;
          this.staticGroup.add(box);
        };
        if (o.bulge) {
          const pts = quadPoints(o.a, wallControl(o.a, o.b, o.bulge), o.b, 14);
          for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], o.thickness);   // overlap hides joint gaps
        } else {
          seg(o.a, o.b, 0);
        }
        break;
      }
      case 'door': case 'window': {
        const isDoor = o.kind === 'door';
        const h = o.height ?? (isDoor ? 210 : 100);
        const yc = (o.elevation ?? (isDoor ? 0 : 90)) + h / 2;
        const m = isDoor ? this.mat(0x8a5a34, { roughness: 0.6 }) : this.mat(0x9fd4ff, { transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.1 });
        if (o.bulge) {
          const hw = o.width / 2, ca = Math.cos(o.angle * Math.PI / 180), sa = Math.sin(o.angle * Math.PI / 180);
          const toPlan = (lx: number, ly: number) => ({ x: o.x + lx * ca - ly * sa, y: o.y + lx * sa + ly * ca });
          const plan = quadPoints({ x: -hw, y: 0 }, { x: 0, y: 2 * o.bulge }, { x: hw, y: 0 }, 10).map(pt => toPlan(pt.x, pt.y));
          for (let i = 1; i < plan.length; i++) {
            const p1 = plan[i - 1], p2 = plan[i];
            const seg = new THREE.Mesh(new THREE.BoxGeometry(dist(p1, p2) + 4, h, 20), m);
            seg.position.set((p1.x + p2.x) / 2, yc, (p1.y + p2.y) / 2);
            seg.rotation.y = -angleDeg(p1, p2) * Math.PI / 180;
            this.staticGroup.add(seg);
          }
        } else {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(o.width, h, 20), m);
          panel.position.set(o.x, yc, o.y);
          panel.rotation.y = -o.angle * Math.PI / 180;
          this.staticGroup.add(panel);
        }
        break;
      }
      case 'furniture': {
        const inst = getFurnitureModel(o.item, o.w, o.h).clone();
        inst.position.set(o.x + o.w / 2, o.elevation ?? 0, o.y + o.h / 2);
        if (o.height) inst.scale.y = o.height / getModelHeight(o.item, o.w, o.h);   // stretch to the set height
        inst.rotation.y = -o.angle * Math.PI / 180;
        this.furnGroup.add(inst);
        break;
      }
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
