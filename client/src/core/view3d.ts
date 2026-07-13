import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Doc } from '../model/doc';
import { Obj } from '../model/types';
import { dist, angleDeg } from './geometry';

const WALL_H = 270; // cm

// height (cm) of each furniture kind when extruded to 3D
const FURN_H: Record<string, number> = {
  sofa: 80, armchair: 80, coffee: 40, tv: 50, rug: 1,
  bed_double: 45, bed_single: 45, wardrobe: 200, desk: 75,
  dining: 75, stove: 90, fridge: 180, sink: 85,
  toilet: 40, bathtub: 55, shower: 200, plant: 90, chair: 90,
};
const FURN_COLOR: Record<string, number> = {
  fridge: 0x9aa3b0, stove: 0x9aa3b0, sink: 0xc9d2df,
  toilet: 0xe3e9f0, bathtub: 0xe3e9f0, shower: 0xbfe0ff,
  plant: 0x4f9a40, rug: 0x4a5570, tv: 0x2a2f3a,
};

// plan coords (x, y) map to 3D (X = x, Z = y, Y = up)
export class View3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private running = false;
  private raf = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1218);
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 200000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // don't go under the floor

    this.scene.add(new THREE.HemisphereLight(0xcdd8ff, 0x30343d, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(400, 900, 300);
    this.scene.add(dir);
    this.scene.add(this.group);
  }

  private mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });
  }

  private clearGroup() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => mm.dispose());
    });
    this.group.clear();
  }

  build(doc: Doc) {
    this.clearGroup();
    const objs = doc.objects;

    // content bounds for framing the camera
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    const grow = (x: number, z: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };

    // ground
    const groundSize = 4000;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), this.mat(0x1a1e26));
    ground.rotation.x = -Math.PI / 2; this.group.add(ground);

    for (const o of objs) {
      if (!doc.isLayerVisible(o.layer)) continue;
      this.buildObject(o); this.growObject(o, grow);
    }

    if (!isFinite(minX)) { minX = -200; maxX = 200; minZ = -200; maxZ = 200; }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ, 300) + 200;
    this.controls.target.set(cx, 40, cz);
    this.camera.position.set(cx + span * 0.7, span * 0.85, cz + span * 0.9);
    this.controls.update();
  }

  private growObject(o: Obj, grow: (x: number, z: number) => void) {
    if (o.kind === 'wall' || o.kind === 'dimension') { grow(o.a.x, o.a.y); grow(o.b.x, o.b.y); }
    else if (o.kind === 'room' || o.kind === 'furniture') { grow(o.x, o.y); grow(o.x + o.w, o.y + o.h); }
    else grow(o.x, o.y);
  }

  private buildObject(o: Obj) {
    switch (o.kind) {
      case 'room': {
        const floor = new THREE.Mesh(new THREE.BoxGeometry(o.w, 4, o.h), this.mat(0x8a7a5f, { roughness: 0.95 }));
        floor.position.set(o.x + o.w / 2, 2, o.y + o.h / 2);
        this.group.add(floor);
        break;
      }
      case 'wall': {
        const L = dist(o.a, o.b);
        const box = new THREE.Mesh(new THREE.BoxGeometry(L, WALL_H, o.thickness), this.mat(0xd7dce6, { roughness: 0.9 }));
        box.position.set((o.a.x + o.b.x) / 2, WALL_H / 2, (o.a.y + o.b.y) / 2);
        box.rotation.y = -angleDeg(o.a, o.b) * Math.PI / 180;
        this.group.add(box);
        break;
      }
      case 'door': case 'window': {
        const isDoor = o.kind === 'door';
        const h = isDoor ? 210 : 100;
        const yc = isDoor ? 105 : 140;
        const m = isDoor ? this.mat(0x6b4a2a) : this.mat(0x9fd4ff, { transparent: true, opacity: 0.5, roughness: 0.2 });
        const panel = new THREE.Mesh(new THREE.BoxGeometry(o.width, h, 18), m);
        panel.position.set(o.x, yc, o.y);
        panel.rotation.y = -o.angle * Math.PI / 180;
        this.group.add(panel);
        break;
      }
      case 'furniture': {
        const h = FURN_H[o.item] ?? 75;
        const color = FURN_COLOR[o.item] ?? 0xb0895e;
        const box = new THREE.Mesh(new THREE.BoxGeometry(o.w, h, o.h), this.mat(color));
        box.position.set(o.x + o.w / 2, h / 2, o.y + o.h / 2);
        box.rotation.y = -o.angle * Math.PI / 180;
        this.group.add(box);
        break;
      }
    }
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (!this.running) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };
  start() { if (this.running) return; this.running = true; this.resize(); this.loop(); }
  stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); }
}
