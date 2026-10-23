// Materials the 3D view makes for itself: plain fills, the floor and wall
// finishes, per-instance recolouring and the translucent placement ghost.
// Textured surfaces come from ./textures3d; this file only picks between them.
import * as THREE from 'three';
import { surfaceMaterial } from './textures3d';

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
export function recolour(root: THREE.Object3D, hex: string, tintCache: Map<string, THREE.Material>) {
  const tint = new THREE.Color(hex);
  const swap = (m: THREE.Material): THREE.Material => {
    const key = `${m.uuid}|${hex}`;
    let c = tintCache.get(key);
    if (!c) {
      c = m.clone();
      const col = (c as THREE.MeshStandardMaterial).color;
      if (col) col.copy(tint);
      tintCache.set(key, c);
    }
    return c;
  };
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
}

// turn a model into a translucent, non-shadowing ghost (clones its materials)
export function ghostify(g: THREE.Object3D) {
  const gm = (m: THREE.Material) => { const c = m.clone(); (c as any).transparent = true; (c as any).opacity = 0.42; (c as any).depthWrite = false; return c; };
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false; m.receiveShadow = false;
    m.material = Array.isArray(m.material) ? m.material.map(gm) : gm(m.material);
  });
  g.renderOrder = 999;
}

export function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04, envMapIntensity: 1.1, ...opts });
}

/**
 * The floor finish for a room: a material id, or a hex colour for a plain
 * fill. Sized in centimetres so the material tiles at its real scale rather
 * than a fixed number of repeats — a 2 m bathroom and an 8 m living room get
 * the same size of tile, which is the whole point of a scale.
 */
export function floorMaterial(floor: string | undefined, wCm: number, hCm: number): THREE.MeshStandardMaterial {
  if (floor && floor.startsWith('#')) {
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(floor).getHex(), roughness: 0.8, metalness: 0.02, envMapIntensity: 1.1 });
  }
  return surfaceMaterial(floor, 'floor', wCm, hCm, { envMapIntensity: 1.2 });
}

/** The wall finish: a material id, or a hex colour for plain paint. */
export function wallMaterial(o: { color?: string; finish?: string }, wCm: number, hCm: number): THREE.MeshStandardMaterial {
  if (o.color) {
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color).getHex(), roughness: 0.92, envMapIntensity: 1 });
  }
  return surfaceMaterial(o.finish, 'wall', wCm, hCm, { envMapIntensity: 1 });
}
