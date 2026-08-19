import * as THREE from 'three';
import { MaterialDef, material, heightToNormal, rng, hash, repeatFor, Category } from './materials';

// Turning a MaterialDef into three.js objects. The drawing and the arithmetic
// live in materials.ts; this file only knows about textures and materials.
//
// Two caches, and the split matters. The *source* canvases are expensive to
// draw and identical for every surface using that material, so they are built
// once per material and shared. The `repeat` however is per surface — a 6 m
// floor and a 2 m one need the same image tiled differently — and repeat lives
// on the texture, not on the material. So each surface gets a cheap clone that
// shares the underlying image.
//
// Getting that backwards is a memory leak with no symptom: cloning the source
// per surface uploads a fresh 512² image to the GPU for every room on the plan,
// and nothing reports it except the number going up.

const SIZE = 512;

interface Maps {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  /**
   * AO in R, roughness in G, metalness in B — the layout Poly Haven ships and
   * the one three.js samples, so the same texture feeds `aoMap` and
   * `roughnessMap` without a second file.
   */
  armMap?: THREE.Texture;
  /** The scan's real-world width, when the source published one. */
  tileCm?: number;
}

const sources = new Map<string, Maps>();

// ---- photographed maps ----------------------------------------------------
//
// CC0 scans from ambientCG, fetched by scripts/fetch_textures.py and committed
// under client/public/textures. Where one exists it replaces the procedural
// generator for that id; where it does not — `paint`, and anything the script
// has not been pointed at — the generator still runs, so nothing depends on the
// files being present.
//
// Loading is asynchronous and `surfaceMaterial` is not, which is the whole
// difficulty here. The rule: a caller always gets a material immediately. If
// the photo has landed it gets the photo; if it has not, it gets the generated
// one, and `notifyReady` tells the 3D view to rebuild when the photo arrives.
// Never block, never hand back a material with no map.

interface PhotoEntry { asset: string; name: string; tileCm: number | null; attribution: string; }

// Resolved against the page rather than a build-time constant: the desktop
// build serves the same files from a local server on an arbitrary port, and the
// dev server and Docker image do not agree on a base path either.
const BASE = new URL('textures/', document.baseURI).href;
const photos = new Map<string, Maps>();
const pending = new Map<string, Promise<boolean>>();
let manifest: Record<string, PhotoEntry> | null | undefined;
let ready: (() => void) | undefined;

/** Called when a photographed material lands after something already drew with the generated one. */
export function onTexturesReady(fn: () => void) { ready = fn; }

async function loadManifest(): Promise<Record<string, PhotoEntry> | null> {
  if (manifest !== undefined) return manifest ?? null;
  try {
    const r = await fetch(`${BASE}manifest.json`);
    manifest = r.ok ? (await r.json()).materials : null;
  } catch { manifest = null; }         // offline, or a build without the files
  return manifest ?? null;
}

function loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new Promise((res, rej) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    }, undefined, rej);
  });
}

/**
 * Load the photographed set for one material id. Resolves to whether there is
 * one; safe and cheap to call again.
 */
export function loadPhoto(id: string): Promise<boolean> {
  if (photos.has(id)) return Promise.resolve(true);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const job = (async () => {
    const m = await loadManifest();
    const entry = m?.[id];
    if (!entry) return false;
    try {
      const [map, normalMap, armMap] = await Promise.all([
        loadTexture(`${BASE}${id}/color.jpg`, true),
        loadTexture(`${BASE}${id}/normal.jpg`, false),
        loadTexture(`${BASE}${id}/arm.jpg`, false),
      ]);
      photos.set(id, { map, normalMap, armMap, tileCm: entry.tileCm ?? undefined });
      // Anything already built from the generator for this id is now stale.
      sources.delete(id);
      ready?.();
      return true;
    } catch { return false; }          // a missing file is not worth a broken view
  })();
  pending.set(id, job);
  return job;
}

function draw(size: number, fn: (c: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  // willReadFrequently, because these get read straight back: the speckle and
  // pile passes are getImageData/putImageData, and the height field is read out
  // whole to build the normal map. Without it the browser keeps the surface on
  // the GPU and every readback is a stall — Chrome says so in the console, which
  // is where this came from.
  fn(cv.getContext('2d', { willReadFrequently: true })!, size);
  return cv;
}

function build(def: MaterialDef): Maps {
  // One generator per map, both seeded from the id, so the height field lines
  // up with the colour it belongs to — a separate stream would put the grout
  // shading and the grout groove in different places.
  const albedo = draw(SIZE, (c, s) => def.albedo(c, s, rng(hash(def.id))));
  const map = new THREE.CanvasTexture(albedo);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  let normalMap: THREE.Texture | undefined;
  if (def.height) {
    const h = draw(SIZE, (c, s) => def.height!(c, s, rng(hash(def.id))));
    const px = h.getContext('2d')!.getImageData(0, 0, SIZE, SIZE);
    const n = heightToNormal(px.data, SIZE, def.bump ?? 1);
    // Copy into a plain Uint8Array: DataTexture wants an ArrayBuffer-backed
    // view, and Uint8ClampedArray is declared over ArrayBufferLike.
    const nt = new THREE.DataTexture(new Uint8Array(n), SIZE, SIZE, THREE.RGBAFormat);
    nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
    nt.anisotropy = 8;
    nt.needsUpdate = true;
    normalMap = nt;
  }
  return { map, normalMap };
}

function source(def: MaterialDef): Maps {
  const p = photos.get(def.id);
  if (p) return p;
  let m = sources.get(def.id);
  if (!m) { m = build(def); sources.set(def.id, m); }
  return m;
}

/**
 * A standard material for one surface of the given size.
 *
 * The caller disposes the returned material and its textures; the shared source
 * images behind them stay cached and must not be disposed.
 */
export function surfaceMaterial(
  id: string | undefined, category: Category, wCm: number, hCm: number,
  over: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const def = material(id, category);
  const src = source(def);
  // A scan carries its own real-world size, and it is the honest one — the
  // generator's tileCm was chosen to make a drawn pattern look right, not
  // measured off anything. Where the source published a dimension, it wins.
  const [u, v] = repeatFor(src.tileCm ? { ...def, tileCm: src.tileCm } : def, wCm, hCm);

  const map = src.map.clone(); map.needsUpdate = true; map.repeat.set(u, v);
  const mat = new THREE.MeshStandardMaterial({
    map, roughness: def.roughness, metalness: def.metalness, ...over,
  });
  if (src.normalMap) {
    const nm = src.normalMap.clone(); nm.needsUpdate = true; nm.repeat.set(u, v);
    mat.normalMap = nm;
    mat.normalScale = new THREE.Vector2(1, 1);
  }
  if (src.armMap) {
    const am = src.armMap.clone(); am.needsUpdate = true; am.repeat.set(u, v);
    mat.roughnessMap = am;
    mat.aoMap = am;
    // `aoMap` reads the *second* UV set by default, and these surfaces only have
    // one. Left alone it silently contributes nothing — no warning, no error,
    // just a flatter render than the file paid for.
    am.channel = 0;
    // With a map, `roughness` is a multiplier rather than the value. The
    // per-material constants were tuned as absolutes, so leaving them in would
    // darken every scan by however matte its finish was declared to be.
    mat.roughness = 1;
    // metalness stays the material's own: the B channel is correct for the
    // scans that ship ARM, but nothing here is metal and a stray value there
    // would turn a floor into a mirror.
  }
  return mat;
}

/**
 * Build the textures for these materials now, so the first 3D frame does not.
 *
 * Generating one material is a 512² albedo, a 512² height field, and a Sobel
 * pass over the second to make a normal map. That is 8–40 ms each, and it is
 * paid lazily — on the first frame that shows a surface using it. Measured as a
 * single 530 ms build the first time a plan with every finish on it reached the
 * 3D view: one stall, at exactly the moment the user pressed the button and was
 * watching.
 *
 * Only the ids passed in, because warming all thirteen would spend that time on
 * materials the plan does not use. Idle work, so it must not be a long
 * uninterruptible block either — the caller feeds it one id at a time.
 */
export function warmMaterial(id: string | undefined, category: Category): void {
  if (id && id.startsWith('#')) return;   // a plain colour needs no texture
  const def = material(id, category);
  // Ask for the scan first and only generate if there is not one. Doing both
  // would pay the 8–40 ms twice over for every material that has a photo, which
  // is eleven of the thirteen.
  void loadPhoto(def.id).then((got) => { if (!got) source(def); });
}

/**
 * Give an already-built material a photographed surface.
 *
 * For the pieces that are *built* rather than scanned — the doors and every
 * procedural piece of furniture — where a flat colour was standing in. They cannot
 * go through `surfaceMaterial`: that one owns its material, and these builders
 * have already made theirs with their own clearcoat and roughness, which is
 * what makes a lacquered door read as lacquered.
 *
 * `wCm`/`hCm` are the face this material mostly covers, so the grain comes out
 * life-sized. Box faces are UV 0..1 each, so without a repeat one veneer tile
 * stretches across a 244 cm sideboard and across a 40 cm drawer identically,
 * and the furniture looks like a photograph of furniture rather than furniture.
 *
 * When the colour map is taken, the material's colour is forced white because
 * with a map it multiplies: leaving the stand-in brown on would darken a brown
 * veneer to near black — the same trap as `roughness` becoming a multiplier
 * once `roughnessMap` is set.
 *
 * Applies at once if the scan has landed, and registers to be applied later if
 * it has not. Materials are shared by every clone, so a late apply needs no
 * rebuild — assigning the map and setting `needsUpdate` is enough.
 */
interface ScanOpts {
  /**
   * Take the scan's colour too, or only its normal and roughness.
   *
   * True for the materials whose colour *is* the scan — wood, stone. False for
   * the ones the builder colours on purpose: a navy sofa, a green planter, a
   * steel appliance. Those want the weave and the brushing, not somebody else's
   * beige; taking the colour map would repaint every one of them the same.
   */
  colour?: boolean;
  /**
   * Tiles per UV unit, instead of working it out from `wCm`/`hCm`.
   *
   * For geometry whose UVs are not in centimetres. Kenney's models carry UVs
   * spanning tens of units across a 60 cm cabinet, so a cm-derived repeat comes
   * out hundreds of tiles wide.
   */
  repeat?: number;
}

const scanWaiting: { m: THREE.MeshStandardMaterial; id: string; w: number; h: number; o: ScanOpts }[] = [];

function paintScan(m: THREE.MeshStandardMaterial, src: Maps, w: number, h: number, o: ScanOpts) {
  const tile = src.tileCm || 100;
  const [u, v] = o.repeat != null
    ? [o.repeat, o.repeat]
    : [Math.max(0.25, w / tile), Math.max(0.25, h / tile)];
  const put = (t: THREE.Texture) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(u, v); return c; };
  if (o.colour !== false) { m.map = put(src.map); m.color.setHex(0xffffff); }
  if (src.normalMap) m.normalMap = put(src.normalMap);
  if (src.armMap) { const a = put(src.armMap); m.roughnessMap = a; m.aoMap = a; a.channel = 0; m.roughness = 1; }
  m.needsUpdate = true;
}

export function applyScan(m: THREE.MeshStandardMaterial, id: string, wCm: number, hCm: number, o: ScanOpts = {}): void {
  const src = photos.get(id);
  if (src) { paintScan(m, src, wCm, hCm, o); return; }
  scanWaiting.push({ m, id, w: wCm, h: hCm, o });
  void loadPhoto(id).then((got) => {
    if (!got) return;
    const now = photos.get(id);
    if (!now) return;
    for (let i = scanWaiting.length - 1; i >= 0; i--) {
      const e = scanWaiting[i];
      if (e.id !== id) continue;
      paintScan(e.m, now, e.w, e.h, e.o);
      scanWaiting.splice(i, 1);
    }
  });
}

/** The swatch colour, for anything that needs a flat stand-in. */
export { material } from './materials';
