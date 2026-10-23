import * as THREE from 'three';
import { applyScan } from './textures3d';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BUILDERS, rbox, mat } from './furnitureBuilders';
import { archetypeFor, footprintScale, modelKey } from './furnitureFit';

// The catalogue's furniture in 3D: a scanned model when one has been downloaded,
// otherwise the piece built from primitives in ./furnitureBuilders. Cached per
// (item, size); callers clone.

function buildFurniture(item: string, w: number, h: number): THREE.Object3D {
  // Start the load here rather than leaving it to the idle-time warmer. The
  // warmer runs on requestIdleCallback, and a 3D view rendering every frame
  // starves it: with 35 pieces on one plan only 8 of the 17 models had arrived
  // by the time anyone looked. This is the moment the model is actually wanted,
  // so it is the honest place to ask for it. Idempotent, and it still returns
  // the built stand-in on this call.
  if (!models.has(item)) void loadFurnitureModel(item);
  const proto = models.get(item);
  if (proto) {
    // Fill the declared footprint exactly, per axis.
    //
    // This used to take `min` of the two so the model kept its proportions, on
    // the reasoning that a squashed sofa is worse than one that leaves a gap.
    // That holds while the catalogue size *is* the model size — true for the
    // photogrammetry, where the scale comes out 1 — and is wrong for the rest:
    // Kenney's kit is authored on a fixed grid, so its sizes have nothing to do
    // with the real ones the catalogue carries. Measured, 19 of 94 pieces came
    // out more than 10 cm short of what they said they were, the worst being a
    // 180 cm kitchen run rendering 54 cm wide.
    //
    // In a drawing tool the object's w/h is the truth: a 180 cm cabinet has to
    // be 180 cm, and dragging its handles has to stretch it. Proportions are
    // what gives way.
    //
    // Height takes the *smaller* of the two footprint scales, so stretching one
    // axis never makes a piece taller: a longer run of kitchen units is still
    // worktop height, which is what a longer run of kitchen units is. Where that
    // still lands wrong — Kenney authored a base unit as a 43x48x45 cube — the
    // catalogue says so outright with `height`, and `o.height` overrides this.
    const k = footprintScale(proto.userData.natural as THREE.Vector3, w, h);
    const g = proto.clone(true);
    g.scale.set(k.x, k.y, k.z);
    return g;
  }
  const b = BUILDERS[item];
  if (b) return b(w, h);
  const g = new THREE.Group();
  g.add(rbox(w, 75, h, 3, mat(0xb0895e), 0, 37.5, 0));
  return g;
}

// ---- CC0 models -----------------------------------------------------------
//
// Seventeen of the catalogue's pieces have a real scanned model under
// client/public/models, fetched by scripts/fetch_models.py. Where one exists it
// replaces the procedural builder; where it does not — the fridge, the sanitary
// ware, the wardrobe, everything that gets traced off a drawing at a specific
// size — the builder still runs.
//
// The same rule as the surface textures, for the same reason: loading is
// asynchronous and `getFurnitureModel` is not, so a caller always gets
// something now. The scan if it has landed, the built box if it has not, and
// `onModelsReady` to rebuild once it arrives. A plan must never wait on a file.

interface ModelEntry { asset: string; name: string; file: string; w: number; d: number; h: number; source?: string; }

function dressFlat(root: THREE.Object3D) {
  root.traverse((o) => {
    const mm = (o as THREE.Mesh).material;
    for (const m of (Array.isArray(mm) ? mm : [mm]) as THREE.MeshStandardMaterial[]) {
      if (!m) continue;
      // **自己帶貼圖的就不要動。** Sweet Home 3D 那批多半有烘焙好的貼圖（那正是
      // 它們看起來像真家具的原因），套上平鋪的掃描圖等於把它蓋掉。這裡只補真的
      // 空白的那些——Kenney 與 Quaternius 是整批空白，所以行為不變。
      if (m.map || m.normalMap || m.roughnessMap) continue;
      // **名字可能不在材質上。** Kenney 的 glTF 帶著材質名，但 Quaternius 走的是
      // OBJ → trimesh → GLB，而那條路上材質名掉了，語意留在 *node* 上（`Wood`、
      // `DarkWood`、`Comforter`）。只看 m.name 的話這一整個來源一件都對不上，
      // 而且看起來完全正常——沒有錯誤，只是全部維持純色。
      if (!m.name && o.name) m.name = o.name;
      const a = archetypeFor(m.name);
      if (!a) continue;
      if (a.scan) applyScan(m, a.scan, 0, 0, { colour: a.colour === true, repeat: a.repeat });
      m.roughness = a.rough;      // after applyScan — it forces roughness to 1
      m.metalness = a.metal;
      m.needsUpdate = true;
    }
  });
}

const MODEL_BASE = new URL('models/', document.baseURI).href;
const models = new Map<string, THREE.Object3D>();      // item → normalised prototype
const modelPending = new Map<string, Promise<boolean>>();
let modelManifest: Record<string, ModelEntry> | null | undefined;
let modelsReady: (() => void) | undefined;

/** Called when a model lands after something already drew the built stand-in. */
export function onModelsReady(fn: () => void) { modelsReady = fn; }

/**
 * The model catalogue, or null when nobody downloaded it.
 *
 * `client/public/models/` is 41MB of CC0 scans and is deliberately **not** in
 * the repo — `npm run assets` fetches it. Everything below has to keep working
 * without it, and it does: no manifest means `loadFurnitureModel` returns false
 * for every item and each one falls back to the geometry this file builds.
 *
 * The fallback is **not** an equivalent, and the note below says so. Only the
 * first ~55 items have hand-written geometry (sofa, wardrobe, the appliances);
 * the rest were added as models and fall back to a plain box. Rendering the
 * whole catalogue with models/ deleted is two thirds featureless blocks — it
 * runs, it just does not look designed. Silence here would read as "this is
 * what the app looks like" rather than "one command is missing".
 */
async function manifest(): Promise<Record<string, ModelEntry> | null> {
  if (modelManifest !== undefined) return modelManifest ?? null;
  try {
    const r = await fetch(`${MODEL_BASE}manifest.json`);
    modelManifest = r.ok ? (await r.json()).models : null;
  } catch { modelManifest = null; }
  if (!modelManifest) {
    console.info('[家具] 沒有 client/public/models/ —— 只有早期那批家具有手寫幾何，'
      + '其餘一律退回方塊，面板也只剩畫出來的圖例。要 CC0 實掃模型跑 `npm run assets`（約 41MB）。');
  }
  return modelManifest ?? null;
}

/**
 * Load one model and normalise it to this file's convention: centred on x/z,
 * sitting on y = 0, one unit = one centimetre.
 *
 * glTF is metres and the scene's origin is wherever the artist left it. Skipping
 * either half puts a sofa underground or 40 cm off its own footprint, and
 * nothing complains — it just looks placed by somebody careless.
 */
export function loadFurnitureModel(item: string): Promise<boolean> {
  if (models.has(item)) return Promise.resolve(true);
  const inflight = modelPending.get(item);
  if (inflight) return inflight;
  const job = (async () => {
    const m = await manifest();
    const entry = m?.[item];
    if (!entry) return false;
    try {
      const gltf = await new GLTFLoader().loadAsync(`${MODEL_BASE}${item}/${entry.file}`);
      const root = gltf.scene;
      // glTF textures arrive at anisotropy 1 while everything this project
      // builds itself uses 8. Left alone, a sideboard's wood grain and a
      // shelf's metal frame shimmer at grazing angles — which is where most of
      // a room is seen from — while the floor right next to them does not.
      if (entry.source !== 'polyhaven') dressFlat(root);   // 實掃那批本來就完整
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of (Array.isArray(m) ? m : [m]) as THREE.MeshStandardMaterial[]) {
          if (!mat) continue;
          for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap]) {
            if (t) { t.anisotropy = 8; t.needsUpdate = true; }
          }
        }
      });
      root.scale.setScalar(100);                       // metres → centimetres
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3());
      const g = new THREE.Group();
      root.position.set(-c.x, -box.min.y, -c.z);
      g.add(root);
      g.userData.natural = box.getSize(new THREE.Vector3());
      models.set(item, g);
      for (const k of [..._cache.keys()]) if (k.startsWith(`${item}|`)) _cache.delete(k);
      for (const k of [..._height.keys()]) if (k.startsWith(`${item}|`)) _height.delete(k);
      modelsReady?.();
      return true;
    } catch { return false; }
  })();
  modelPending.set(item, job);
  return job;
}

// Cache one model per (item, size); callers .clone() it (shares geometry/materials).
const _cache = new Map<string, THREE.Object3D>();
const _height = new Map<string, number>();
export function getFurnitureModel(item: string, w: number, h: number): THREE.Object3D {
  const key = modelKey(item, w, h);
  let m = _cache.get(key);
  if (!m) {
    m = buildFurniture(item, w, h);
    m.traverse(o => { const me = o as THREE.Mesh; if (me.isMesh) { me.castShadow = true; me.receiveShadow = true; } });
    _cache.set(key, m);
  }
  return m;
}

// natural 3D height (cm) of a furniture model — used as the default for the height field
export function getModelHeight(item: string, w: number, h: number): number {
  const key = modelKey(item, w, h);
  let hgt = _height.get(key);
  if (hgt === undefined) {
    const box = new THREE.Box3().setFromObject(getFurnitureModel(item, w, h));
    hgt = Math.max(1, Math.round(box.max.y - box.min.y));
    _height.set(key, hgt);
  }
  return hgt;
}
