import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Doc } from '../model/doc';
import { Obj } from '../model/types';
import { dist, angleDeg } from './geometry';
import { getFurnitureModel } from './furniture3d';
import { woodClone } from './textures3d';

const WALL_H = 270; // cm

// plan coords (x, y) map to 3D (X = x, Z = y, Y = up)
export class View3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private gtao: GTAOPass;
  private staticGroup = new THREE.Group();   // walls/floors/openings — rebuilt+disposed each time
  private furnGroup = new THREE.Group();      // cloned cached furniture — cleared without disposing
  private dir: THREE.DirectionalLight;
  private running = false;
  private raf = 0;
  private clock = new THREE.Clock();
  private pressed = new Set<string>();
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

    this.camera = new THREE.PerspectiveCamera(52, 1, 1, 200000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

    // Contrast-forward lighting: a strong key sun for crisp cast shadows, a weak
    // opposite fill so shadowed faces stay legible, minimal ambient. Depth/contact
    // cues come from the GTAO pass below.
    this.scene.add(new THREE.HemisphereLight(0xeaf1ff, 0x555a63, 0.75));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));   // tiny lift so nothing is pitch black
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
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.9;
    // screen-space radius keeps the AO scale sane regardless of the cm-based scene size
    this.gtao.updateGtaoMaterial({ screenSpaceRadius: true, radius: 0.5, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());   // applies tone mapping + sRGB after the AO blend

    const editable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    // Only grab keys while flying and not typing; clear on blur so a key held during
    // an alt-tab doesn't stick and drift the camera forever.
    window.addEventListener('keydown', e => { if (this.fly && !editable(e.target)) this.pressed.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', e => this.pressed.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.pressed.clear());
  }

  setFly(on: boolean) { this.fly = on; if (!on) this.pressed.clear(); }

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
      if (!doc.isLayerVisible(o.layer)) continue;
      this.buildObject(o); this.growObject(o, grow);
    }
    // shadows for static meshes (furniture clones inherit from the cache)
    this.staticGroup.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m !== ground) { m.castShadow = true; m.receiveShadow = true; } });

    if (!isFinite(minX)) { minX = -200; maxX = 200; minZ = -200; maxZ = 200; }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ, 300) + 200;
    this.moveSpeed = Math.max(300, span * 0.7);   // perceptible regardless of scene scale

    this.dir.position.set(cx + span * 0.4, span * 1.1, cz + span * 0.5);
    this.dir.target.position.set(cx, 0, cz);
    const sc = this.dir.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = span * 4; sc.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;   // refresh shadows once for this rebuild

    if (reframe) {
      this.controls.target.set(cx, 40, cz);
      this.camera.position.set(cx + span * 0.7, span * 0.8, cz + span * 0.9);
      this.controls.update();
    }
  }

  private growObject(o: Obj, grow: (x: number, z: number) => void) {
    if (o.kind === 'wall' || o.kind === 'dimension') { grow(o.a.x, o.a.y); grow(o.b.x, o.b.y); }
    else if (o.kind === 'room' || o.kind === 'furniture') { grow(o.x, o.y); grow(o.x + o.w, o.y + o.h); }
    else grow(o.x, o.y);
  }

  private buildObject(o: Obj) {
    switch (o.kind) {
      case 'room': {
        const map = woodClone(Math.max(1, Math.round(o.w / 120)), Math.max(1, Math.round(o.h / 120)));
        const floor = new THREE.Mesh(new THREE.BoxGeometry(o.w, 4, o.h), new THREE.MeshStandardMaterial({ map, roughness: 0.72, metalness: 0.02 }));
        floor.position.set(o.x + o.w / 2, 2, o.y + o.h / 2);
        this.staticGroup.add(floor);
        break;
      }
      case 'wall': {
        const L = dist(o.a, o.b);
        const box = new THREE.Mesh(new THREE.BoxGeometry(L, WALL_H, o.thickness), this.mat(0xeceff4, { roughness: 0.92 }));
        box.position.set((o.a.x + o.b.x) / 2, WALL_H / 2, (o.a.y + o.b.y) / 2);
        box.rotation.y = -angleDeg(o.a, o.b) * Math.PI / 180;
        this.staticGroup.add(box);
        break;
      }
      case 'door': case 'window': {
        const isDoor = o.kind === 'door';
        const h = isDoor ? 210 : 100, yc = isDoor ? 105 : 140;
        const m = isDoor ? this.mat(0x8a5a34, { roughness: 0.6 }) : this.mat(0x9fd4ff, { transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.1 });
        const panel = new THREE.Mesh(new THREE.BoxGeometry(o.width, h, 20), m);
        panel.position.set(o.x, yc, o.y);
        panel.rotation.y = -o.angle * Math.PI / 180;
        this.staticGroup.add(panel);
        break;
      }
      case 'furniture': {
        const inst = getFurnitureModel(o.item, o.w, o.h).clone();
        inst.position.set(o.x + o.w / 2, 0, o.y + o.h / 2);
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
