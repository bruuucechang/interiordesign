// The 3D models for a door and a window.
//
// Moved out of view3d.ts: they are two hundred lines of box-stacking that the
// scene does not need to know about, and view3d was 834 lines. Both take plain
// numbers and a style and hand back a Group, so neither touches the scene.
//
// Local coords: X along the opening (its width), Z the wall normal, Y up.
// `elev` is the sill height off the floor of the storey.

import * as THREE from 'three';
import { applyVeneer } from './textures3d';

/** Matches view3d's own material helper, so the two look identical in a scene. */
function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, ...opts });
}

// A framed door in one of several styles (single / double / sliding / glass).
// Built in local coords: X along the opening (width), Z = wall normal, Y up.
export function buildDoor3D(width: number, h: number, elev: number, style = 'single'): THREE.Group {
  const g = new THREE.Group();
  const d = 12, fw = 7;
  // Veneer at life size: the frame is a 7 cm stile so its grain runs down the
  // jamb, while the leaf and its panels take the leaf's own face. Before this
  // every door was a flat brown — the one thing in an interior view that is
  // always at eye level and always in frame.
  const frameM = mat(0x6b4a2a, { roughness: 0.6 });
  applyVeneer(frameM, 'veneer_walnut', fw, h);
  const leafM = new THREE.MeshPhysicalMaterial({ color: 0x8a5a34, roughness: 0.4, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 1.1 });
  applyVeneer(leafM, 'veneer_walnut', width, h);
  const panelM = new THREE.MeshPhysicalMaterial({ color: 0x7a4e2c, roughness: 0.45, metalness: 0, clearcoat: 0.25, envMapIntensity: 1.0 });
  applyVeneer(panelM, 'veneer_walnut', width * 0.66, h * 0.36);
  const metalM = mat(0xc2c7cf, { roughness: 0.28, metalness: 0.92, envMapIntensity: 1.35 });
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
    // The panels are sunk *through* the leaf face rather than sitting on it.
    // A 1.2 cm panel starting exactly at ld/2 puts its back face at the same
    // depth as the leaf's front face, and two coplanar surfaces fight in the
    // depth buffer: every panel outline came out as a dashed dark line, on
    // every door, which reads as bad modelling rather than as a rendering bug.
    // Same protrusion as before — 2.4 cm centred on the face instead of 1.2 cm
    // starting at it — so nothing about the silhouette changes.
    for (const zs of [1, -1]) {
      const zz = zs * (ld / 2);
      bx(cw * 0.66, lh * 0.36, 2.4, panelM, cx, elev + lh * 0.7, zz);
      bx(cw * 0.66, lh * 0.34, 2.4, panelM, cx, elev + lh * 0.3, zz);
    }
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
    // Stiles and rails around an opening, not a slab with glass laid over it.
    // Boxes add, they do not subtract, so the previous version's glazed panel
    // — two units deeper than the leaf and centred on it — enclosed the solid
    // wood instead of replacing it. Geometry sitting inside a `transmission`
    // volume made the whole 3D view render black: one glass door and nothing
    // drew at all, while every other door style and every window (same glass
    // material) was fine.
    const sw = 8, br = 14, tr = 8;                    // stile / bottom rail / top rail
    const ow = lw - 2 * sw, oh = lh - br - tr;        // the opening the glass fills
    for (const s of [-1, 1]) bx(sw, lh, ld, leafM, s * (lw - sw) / 2, elev + lh / 2, 0);
    bx(lw, br, ld, leafM, 0, elev + br / 2, 0);
    bx(lw, tr, ld, leafM, 0, elev + lh - tr / 2, 0);
    bx(lw - 12, 5, ld, leafM, 0, elev + lh * 0.34, 0);                 // lock rail
    // Thinner than the leaf so it sits in the opening rather than around it.
    bx(ow, oh, ld * 0.4, glassM, 0, elev + br + oh / 2, 0);
    putHandle(lw / 2 - 7);
  } else {                                                              // single
    panelLeaf(0, lw); putHandle(lw / 2 - 7);
  }
  return g;
}

// A framed window in one of several styles (single grid / casement / sliding /
// picture). Same local coords as buildDoor3D.
export function buildWindow3D(width: number, h: number, elev: number, style = 'single'): THREE.Group {
  const g = new THREE.Group();
  const d = 10, fw = 6, iw = width - 2 * fw, ih = h - 2 * fw;
  const frameM = mat(0xf2f4f7, { roughness: 0.5, metalness: 0.1 });
  const sillM = mat(0xe7eaee, { roughness: 0.6 });
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

/**
 * A ceiling over one room, at wall height.
 *
 * Kept in its own group because it cannot simply always be drawn: seen from
 * the usual orbit position — outside and above — a ceiling hides the entire
 * plan underneath it. So the group's visibility follows the camera, on in an
 * interior eye-level view and off when looking down from outside. That also
 * makes the 360° panorama read as a room rather than a roofless set.
 */
