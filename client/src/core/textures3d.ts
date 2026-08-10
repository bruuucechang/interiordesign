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
}

const sources = new Map<string, Maps>();

function draw(size: number, fn: (c: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  fn(cv.getContext('2d')!, size);
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
  const [u, v] = repeatFor(def, wCm, hCm);

  const map = src.map.clone(); map.needsUpdate = true; map.repeat.set(u, v);
  const mat = new THREE.MeshStandardMaterial({
    map, roughness: def.roughness, metalness: def.metalness, ...over,
  });
  if (src.normalMap) {
    const nm = src.normalMap.clone(); nm.needsUpdate = true; nm.repeat.set(u, v);
    mat.normalMap = nm;
    mat.normalScale = new THREE.Vector2(1, 1);
  }
  return mat;
}

/** The swatch colour, for anything that needs a flat stand-in. */
export { material } from './materials';
