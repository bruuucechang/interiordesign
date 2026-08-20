import * as THREE from 'three';
import { applyScan } from './textures3d';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Proper 3D furniture models assembled from primitives, using rounded-box
// geometry so cushions/bodies look soft instead of blocky.
// Local coords: footprint centered at origin (X in [-w/2,w/2], Z in [-h/2,h/2]),
// Y up from the floor (0). The caller positions/rotates the returned group.

const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.04, envMapIntensity: 1.15, ...opts });

// --- physically-based material archetypes: each surface type reacts to light
// the way its real material does (sheen, glaze, brushed metal, tinted glass) ---
// oiled / lacquered wood — matte grain with a faint clearcoat sheen
// `veneer` is the face this material mostly covers, in centimetres — passing it
// swaps the flat colour for a photographed wood veneer at life size. Left off,
// the material stays the plain colour it always was, which is what the pieces
// that are not wood want.
const woodMat = (color: number, roughness = 0.6, size: [number, number] = [60, 60], grain: 'oak' | 'walnut' = 'oak') => {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.5, envMapIntensity: 1.0 });
  applyScan(m, `veneer_${grain}`, size[0], size[1]);
  return m;
};
// brushed / satin metal — appliances, faucets, handles, legs.
// Colour stays the caller's: an appliance may be steel, graphite or white, and
// the scan is only here for the brushing.
const metalMat = (color = 0x9aa3b0, roughness = 0.32, size: [number, number] = [60, 60]) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.9, envMapIntensity: 1.35 });
  applyScan(m, 'metal_brushed', size[0], size[1], { colour: false });
  return m;
};
// matte upholstery fabric — no reflections, soft. Weave only, colour kept, or
// every sofa in the catalogue would come out the same beige.
const fabricMat = (color: number, roughness = 1.0, size: [number, number] = [60, 60], kind: 'weave' | 'carpet' = 'weave') => {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, envMapIntensity: 0.45 });
  applyScan(m, kind, size[0], size[1], { colour: false });
  return m;
};
// glazed ceramic / porcelain — sanitaryware, planters.
//
// Deliberately left un-scanned. Glazed porcelain really is a smooth, featureless
// specular surface; every ceramic scan on both libraries is a *tile*, complete
// with grout and wear. Putting one on a toilet would be adding dirt that is not
// there, which is worse than the flat white being flat.
const ceramicMat = (color = 0xeef2f6) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
// polished stone — countertops. Colour comes from the stone.
const stoneMat = (color = 0x8a929e, size: [number, number] = [120, 60]) => {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.35, envMapIntensity: 1.1 });
  applyScan(m, 'granite', size[0], size[1]);
  return m;
};
// tinted glass
const glassMat = (color = 0x9fd4ff, opacity = 0.22) =>
  new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity, roughness: 0.04, metalness: 0, envMapIntensity: 1.4 });

// rounded box (smooth-shaded, extra round segments so edges catch light softly)
function rbox(w: number, h: number, d: number, r: number, m: THREE.Material, x: number, y: number, z: number, rotY = 0) {
  w = Math.max(1, w); h = Math.max(1, h); d = Math.max(1, d);
  const rr = Math.max(0.4, Math.min(r, w / 2 - 0.3, h / 2 - 0.3, d / 2 - 0.3));
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, rr), m);
  mesh.position.set(x, y, z); if (rotY) mesh.rotation.y = rotY;
  return mesh;
}
function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rotY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.5, w), Math.max(0.5, h), Math.max(0.5, d)), m);
  mesh.position.set(x, y, z); if (rotY) mesh.rotation.y = rotY;
  return mesh;
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 18) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function sphere(r: number, m: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function cone(rb: number, ht: number, m: THREE.Material, x: number, y: number, z: number, seg = 10) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(rb, ht, seg), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function arc(radius: number, tube: number, sweep: number, m: THREE.Material, x: number, y: number, z: number, rotX = 0) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 24, sweep), m);
  mesh.position.set(x, y, z); mesh.rotation.x = rotX;
  return mesh;
}
// tapered legs at corners, slight splay for a modern look
function legs4(g: THREE.Group, w: number, h: number, legH: number, m: THREE.Material, topR = 3, botR = 2, inset = 8, splay = 0.08) {
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    const leg = cyl(topR, botR, legH, m, dx * (w / 2 - inset), legH / 2, dz * (h / 2 - inset), 12);
    leg.rotation.x = -dz * splay; leg.rotation.z = dx * splay;
    g.add(leg);
  }
}
function tufts(g: THREE.Group, cols: number, rows: number, x0: number, y0: number, z: number, dx: number, dy: number, m: THREE.Material) {
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) g.add(sphere(1.1, m, x0 + i * dx, y0 + j * dy, z));
}

// ---- builders ----
function table(w: number, h: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const top = woodMat(0x9a6b3f, 0.48), wood2 = woodMat(0x835a34, 0.62), leg = woodMat(0x6b4a2a, 0.55);
  const t = 5;
  g.add(rbox(w, t, h, 2.5, top, 0, height - t / 2, 0));                       // rounded tabletop
  const apronY = height - t - 5, ah = 8, inset = 7;
  g.add(box(w - 2 * inset, ah, 4, wood2, 0, apronY, -h / 2 + inset));
  g.add(box(w - 2 * inset, ah, 4, wood2, 0, apronY, h / 2 - inset));
  g.add(box(4, ah, h - 2 * inset, wood2, -w / 2 + inset, apronY, 0));
  g.add(box(4, ah, h - 2 * inset, wood2, w / 2 - inset, apronY, 0));
  legs4(g, w, h, height - t - ah, leg, 4, 2.5, inset, 0.05);
  return g;
}
function coffee(w: number, h: number): THREE.Group {
  const g = table(w, h, 42);
  g.add(rbox(w - 16, 3, h - 16, 1.5, woodMat(0x835a34, 0.6), 0, 14, 0));       // lower shelf
  g.add(rbox(w * 0.28, 5, h * 0.4, 1, mat(0xc9b48a), -w * 0.12, 44, 0));       // books
  g.add(rbox(w * 0.24, 4, h * 0.34, 1, mat(0x7f9bb0), -w * 0.12, 48.5, 4));
  return g;
}

function chair(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const wood = woodMat(0x7a5636, 0.55), fabric = fabricMat(0x9a8468);
  const seatY = 45;
  g.add(rbox(w - 2, 5, h - 2, 2, wood, 0, seatY, 0));
  g.add(rbox(w - 8, 6, h - 8, 3, fabric, 0, seatY + 5, 0));                    // plump seat cushion
  g.add(rbox(w - 6, 42, 6, 3, fabric, 0, seatY + 26, -h / 2 + 5));            // padded back
  legs4(g, w, h, seatY - 3, wood, 2.6, 1.8, 5, 0.06);
  return g;
}

function sofa(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const fabric = fabricMat(0x6b7690), cushion = fabricMat(0x808eab);
  const seam = fabricMat(0x54607a), legM = metalMat(0x4a3a2c, 0.4);
  const throw1 = fabricMat(0xd98c6a), throw2 = fabricMat(0x88b0a0);
  const legH = 10, arm = Math.min(24, w * 0.15), baseH = 20;
  legs4(g, w, h, legH, legM, 3, 2, 10, 0.12);
  g.add(rbox(w, baseH, h, 5, fabric, 0, legH + baseH / 2, 0));                 // base
  g.add(rbox(w - 2 * arm + 6, 12, h - 8, 5, cushion, 0, legH + baseH + 1, 2)); // seat platform
  // padded track arms: a soft upholstered block with a rounded bolster on top
  for (const s of [-1, 1]) {
    const ax = s * (w / 2 - arm / 2), armH = 40;
    g.add(rbox(arm, armH, h, arm * 0.42, fabric, ax, legH + baseH / 2 + armH / 2 - 2, 0));       // arm block
    g.add(rbox(arm + 1, 13, h - 4, 6, cushion, ax, legH + baseH / 2 + armH + 4, 0));             // cushioned top pad
    g.add(rbox(arm - 3, armH * 0.7, 9, 4, cushion, ax, legH + baseH / 2 + armH * 0.4, h / 2 - 6)); // front scroll panel
  }
  // seat + back cushions (plump, rounded)
  const innerW = w - 2 * arm - 6;
  const n = Math.max(1, Math.min(3, Math.round(w / 85)));
  const cw = (innerW - (n - 1) * 5) / n;
  for (let i = 0; i < n; i++) {
    const x = -innerW / 2 + cw / 2 + i * (cw + 5);
    g.add(rbox(cw, 18, h * 0.55, 7, cushion, x, legH + baseH + 12, h * 0.08));  // seat cushion
    const back = rbox(cw, 44, 18, 8, cushion, x, legH + baseH + 26, -h / 2 + 12);
    back.rotation.x = -0.08; g.add(back);                                        // reclined back cushion
    tufts(g, 2, 2, x - cw * 0.2, legH + baseH + 18, -h / 2 + 3.5, cw * 0.4, 16, seam);
  }
  // throw pillows
  g.add(rbox(30, 30, 12, 6, throw1, -innerW / 4, legH + baseH + 28, -h / 2 + 22, 0.5));
  g.add(rbox(28, 28, 12, 6, throw2, innerW / 4, legH + baseH + 26, -h / 2 + 22, -0.4));
  return g;
}

function armchair(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const fabric = fabricMat(0x7d6f8f), cushion = fabricMat(0x9184a6), legM = metalMat(0x4a3a2c, 0.4);
  const legH = 10, arm = w * 0.18, baseH = 20;
  legs4(g, w, h, legH, legM, 3, 2, 8, 0.12);
  g.add(rbox(w, baseH, h, 5, fabric, 0, legH + baseH / 2, 0));
  for (const s of [-1, 1]) {
    const ax = s * (w / 2 - arm / 2), armH = 40;
    g.add(rbox(arm, armH, h, arm * 0.42, fabric, ax, legH + baseH / 2 + armH / 2 - 2, 0));       // padded arm block
    g.add(rbox(arm + 1, 12, h - 4, 6, cushion, ax, legH + baseH / 2 + armH + 3, 0));             // cushioned top pad
  }
  const back = rbox(w - 2 * arm, 50, 18, 8, cushion, 0, legH + baseH + 26, -h / 2 + 12); back.rotation.x = -0.08; g.add(back);
  g.add(rbox(w - 2 * arm - 4, 18, h * 0.58, 7, cushion, 0, legH + baseH + 12, h * 0.06));
  g.add(rbox(24, 24, 11, 5, fabricMat(0xd98c6a), 0, legH + baseH + 28, -h / 2 + 20, 0.4));
  return g;
}

function bed(w: number, h: number, dbl: boolean): THREE.Group {
  const g = new THREE.Group();
  const frame = woodMat(0x6b4a2a, 0.58), legM = woodMat(0x4a3320, 0.55), mattress = fabricMat(0xe8e2d2, 0.95);
  const duvet = fabricMat(0xc7d0dc), runner = fabricMat(0x7c93b0);
  const pillow = fabricMat(0xf3f1ea, 0.95), deco = fabricMat(0xcf8f6b, 0.95), head = fabricMat(0x8492a8);
  const legH = 10;
  legs4(g, w, h, legH, legM, 4, 3, 6, 0);
  g.add(rbox(w, 20, h, 3, frame, 0, legH + 10, 0));
  const mattTop = legH + 20 + 17;
  g.add(rbox(w - 8, 17, h - 8, 6, mattress, 0, legH + 20 + 8.5, 0));           // rounded mattress
  // upholstered headboard with tufting
  g.add(rbox(w, 62, 8, 4, head, 0, legH + 31, -h / 2 + 4));
  tufts(g, Math.max(3, Math.round(w / 40)), 3, -w / 2 + 18, legH + 22, -h / 2 + 8.5, 36, 14, fabricMat(0x6f7d92));
  // duvet draped over lower ~60% with a folded top edge
  g.add(rbox(w - 4, 9, h * 0.58, 4, duvet, 0, mattTop + 1, h * 0.2));
  g.add(rbox(w - 4, 12, 13, 5, duvet, 0, mattTop + 3, -h * 0.1));
  g.add(rbox(w - 4, 6, h * 0.16, 3, runner, 0, mattTop + 6, h * 0.42));        // bed runner
  const pz = -h / 2 + 32, py = mattTop + 8;
  if (dbl) {
    g.add(rbox(w * 0.4, 14, 30, 7, pillow, -w * 0.23, py, pz)); g.add(rbox(w * 0.4, 14, 30, 7, pillow, w * 0.23, py, pz));
    g.add(rbox(w * 0.3, 13, 22, 6, deco, 0, py + 6, pz + 22));
  } else { g.add(rbox(w * 0.64, 14, 30, 7, pillow, 0, py, pz)); g.add(rbox(w * 0.4, 12, 20, 6, deco, 0, py + 5, pz + 20)); }
  return g;
}

function wardrobe(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const height = 200, front = h / 2;
  const bodyM = woodMat(0x7a5636, 0.55, [w, height]), doorM = woodMat(0x86603a, 0.5, [w / 2, height]);
  const frameM = woodMat(0x6b4a2a, 0.55, [w, 20]);
  const handle = metalMat(0x9aa3b0, 0.3), mirror = metalMat(0xc2d4e2, 0.04);
  g.add(rbox(w, 8, h, 2, woodMat(0x4a3320, 0.6, [w, 8]), 0, 4, 0));            // plinth
  g.add(rbox(w, height - 8, h, 2, bodyM, 0, 6 + (height - 8) / 2, 0));
  g.add(rbox(w + 4, 6, h + 4, 2, frameM, 0, height + 1, 0));                   // cornice
  for (const s of [-1, 1]) {
    const dx = s * w / 4;
    g.add(rbox(w / 2 - 3, height - 20, 3, 2, doorM, dx, height / 2, front));
    g.add(box(w / 2 - 16, height - 40, 2.5, frameM, dx, height / 2, front + 1.5));
    if (s > 0) g.add(box(w / 2 - 28, height - 64, 2, mirror, dx, height / 2 + 6, front + 2.5));
    else g.add(box(w / 2 - 24, height - 56, 3, doorM, dx, height / 2, front + 2));
    g.add(cyl(2.6, 2.6, 6, handle, s > 0 ? dx - w / 4 + 6 : dx + w / 4 - 6, height / 2, front + 3, 12));
  }
  return g;
}

function fridge(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const height = 180, front = h / 2, legH = 4;
  const bodyM = metalMat(0xdfe4ea, 0.28);
  const handle = metalMat(0x8b93a2, 0.3);
  g.add(rbox(w, height - legH, h, 5, bodyM, 0, legH + (height - legH) / 2, 0));
  g.add(box(w, 2, 1, metalMat(0x9aa3b0, 0.3), 0, legH + (height - legH) * 0.36, front + 1));
  g.add(rbox(3, 46, 3, 1.2, handle, -w / 2 + 8, height * 0.66, front + 1.5));
  g.add(rbox(3, 30, 3, 1.2, handle, -w / 2 + 8, height * 0.2, front + 1.5));
  g.add(box(w * 0.34, 22, 2, mat(0x2a2f38, { metalness: 0.3, roughness: 0.3 }), w * 0.12, height * 0.72, front + 1));
  g.add(box(w * 0.34, 5, 1.5, mat(0x7bd0ff, { emissive: 0x112233, metalness: 0.2 }), w * 0.12, height * 0.8, front + 1.6));
  return g;
}

function stove(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const height = 90, front = h / 2;
  const bodyM = metalMat(0x8a929e, 0.32), dark = mat(0x14171e, { roughness: 0.5 });
  g.add(rbox(w, height, h, 3, bodyM, 0, height / 2, 0));
  g.add(box(w, 22, 3, metalMat(0x6b7280, 0.35), 0, height + 11, -h / 2 + 1));
  g.add(rbox(w - 4, 4, h - 4, 1.5, mat(0x24282f, { roughness: 0.1, metalness: 0.1, envMapIntensity: 1.4 }), 0, height + 2, 0));  // glossy cooktop glass
  const knob = mat(0x2a2f38);
  for (let i = 0; i < 4; i++) g.add(cyl(2.5, 2.5, 3, knob, -w / 2 + 8 + i * ((w - 16) / 3), height + 11, -h / 2 + 3, 10));
  g.add(rbox(w - 10, height - 26, 2, 2, mat(0x3a4048, { metalness: 0.3 }), 0, (height - 26) / 2, front + 0.5));
  g.add(box(w - 24, height - 44, 1.5, mat(0x10131a, { metalness: 0.2, roughness: 0.2 }), 0, (height - 26) / 2, front + 1.5));
  g.add(rbox(w - 14, 4, 4, 1.5, mat(0x9aa3b0, { metalness: 0.6 }), 0, height - 30, front + 2));
  for (const [bx, bz] of [[-w * 0.22, -h * 0.22], [w * 0.22, -h * 0.22], [-w * 0.22, h * 0.22], [w * 0.22, h * 0.22]]) {
    g.add(cyl(9, 9, 2, dark, bx, height + 3, bz, 20));
    g.add(box(20, 1.5, 3, mat(0x2a2f38), bx, height + 4.5, bz)); g.add(box(3, 1.5, 20, mat(0x2a2f38), bx, height + 4.5, bz));
  }
  return g;
}

function sink(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const height = 85;
  const counter = stoneMat(0x8a929e);
  const basin = metalMat(0x5f6b7a, 0.25);
  const f = metalMat(0x9aa3b0, 0.18);
  g.add(rbox(w, height, h, 2, counter, 0, height / 2, 0));
  for (const s of [-1, 1]) { g.add(rbox(w * 0.28, 14, h * 0.6, 4, basin, s * w * 0.17, height - 7, 0)); g.add(cyl(1.6, 1.6, 1, mat(0x3a4048), s * w * 0.17, height - 1, 0, 10)); }
  g.add(box(3, 14, h * 0.6, counter, 0, height - 7, 0));
  g.add(cyl(2, 2, 16, f, 0, height + 8, -h / 2 + 9));
  g.add(arc(6, 1.8, Math.PI, f, 0, height + 16, -h / 2 + 9, 0));
  g.add(cyl(1.4, 1.4, 6, f, 6, height + 13, -h / 2 + 9));
  for (const s of [-1, 1]) g.add(cyl(1.5, 1.5, 5, f, s * 9, height + 3, -h / 2 + 9, 8));
  return g;
}

function toilet(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const white = ceramicMat(0xeef2f6), metal = metalMat(0x9aa3b0, 0.25);
  g.add(rbox(w - 6, 44, 14, 4, white, 0, 46, -h / 2 + 8));                     // tank
  g.add(cyl(3, 3, 2, metal, 0, 68, -h / 2 + 8, 12));
  g.add(cyl(w / 2 - 3, w / 2 - 7, 30, white, 0, 16, h * 0.08, 24));            // bowl
  g.add(cyl(w / 2, w / 2 - 3, 4, white, 0, 33, h * 0.08, 24));                 // seat
  g.add(rbox(w - 8, 3, 12, 1.5, white, 0, 35, h * 0.28));
  return g;
}

function bathtub(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const height = 55;
  const outer = ceramicMat(0xeef2f6), inner = ceramicMat(0xc6d0da);
  const f = metalMat(0x9aa3b0, 0.2);
  g.add(rbox(w, height, h, 10, outer, 0, height / 2, 0));
  g.add(rbox(w - 16, height - 12, h - 16, 8, inner, 0, height / 2 + 6, 0));
  g.add(cyl(1.8, 1.8, 16, f, -w / 2 + 12, height + 4, -h / 2 + 10));
  g.add(arc(4, 1.4, Math.PI, f, -w / 2 + 12, height + 12, -h / 2 + 10, 0));
  g.add(cyl(2, 2, 1.5, f, 0, height + 3.5, h / 2 - 12, 10));
  return g;
}

function shower(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const height = 200;
  const tray = ceramicMat(0xeef2f6);
  const glass = glassMat(0x9fd4ff, 0.2);
  const metal = metalMat(0x9aa3b0, 0.3);
  g.add(rbox(w, 8, h, 2, tray, 0, 4, 0));
  g.add(box(w, height - 8, 3, glass, 0, height / 2, h / 2));
  g.add(box(3, height - 8, h, glass, w / 2, height / 2, 0));
  g.add(box(w, 4, 4, metal, 0, height, h / 2)); g.add(box(4, 4, h, metal, w / 2, height, 0));
  g.add(box(4, height - 8, 4, metal, w / 2, height / 2, h / 2));
  g.add(box(6, 4, 26, metal, -w / 2 + 12, height - 14, -h / 2 + 6));
  g.add(cyl(7, 7, 3, metal, -w / 2 + 12, height - 16, -h / 2 + 18, 16));
  return g;
}

function tvStand(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const wood = woodMat(0x3a4150, 0.5), handle = metalMat(0x9aa3b0, 0.3);
  g.add(rbox(w, 34, h, 3, wood, 0, 4 + 17, 0));
  legs4(g, w, h, 4, metalMat(0x2a2a2a, 0.4), 2.5, 2, 6, 0);
  for (let i = 0; i < 2; i++) {
    const x = (i === 0 ? -1 : 1) * w / 4;
    g.add(box(w / 2 - 6, 24, 1.5, mat(0x2f353f), x, 4 + 17, h / 2));
    g.add(rbox(w * 0.14, 2.5, 2, 1, handle, x, 4 + 17, h / 2 + 1.5));
  }
  g.add(box(w * 0.18, 6, 8, mat(0x14171e), 0, 41, 0));
  g.add(rbox(w * 0.86, 54, 4, 2, mat(0x0a0c10, { roughness: 0.4 }), 0, 41 + 30, -h / 2 + 5));
  g.add(box(w * 0.82, 48, 1.5, mat(0x1b2740, { metalness: 0.1, roughness: 0.08, envMapIntensity: 1.5 }), 0, 41 + 30, -h / 2 + 6.6));  // glossy screen
  g.add(rbox(w * 0.5, 6, 8, 2, mat(0x2a2f38), 0, 6 + 17, h / 2 - 4));
  return g;
}

function rug(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  // The carpet scan, not the upholstery weave — a rug's pile is coarser than a
  // sofa's cloth and at floor scale the difference is the whole point.
  g.add(rbox(w, 2, h, 3, fabricMat(0x4a5570, 1.0, [w, h], 'carpet'), 0, 1, 0));
  g.add(box(w - 12, 1.5, h - 12, fabricMat(0x5f6d92, 1.0, [w, h], 'carpet'), 0, 2, 0));
  g.add(box(w - 40, 1, h - 40, fabricMat(0x3f4a66, 1.0, [w, h], 'carpet'), 0, 2.5, 0));
  return g;
}

function plant(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const r = Math.min(w, h) / 2;
  // tapered glazed pot with a rim + soil
  g.add(cyl(r * 0.5, r * 0.62, 30, ceramicMat(0xc7a079), 0, 15, 0, 26));       // pot (wider at top)
  g.add(cyl(r * 0.66, r * 0.62, 4, ceramicMat(0xd8b48c), 0, 30, 0, 26));        // rim
  g.add(cyl(r * 0.58, r * 0.58, 2, mat(0x2a1d12, { roughness: 0.98 }), 0, 30.5, 0, 22));  // soil
  const greens = [fabricMat(0x3f9a52, 0.82), fabricMat(0x2f7d42, 0.82), fabricMat(0x54b56a, 0.82), fabricMat(0x357a46, 0.82), fabricMat(0x6bbf7c, 0.82)];
  const crownY = 32, up = new THREE.Vector3(0, 1, 0);
  // broad leaves fanning up and out from the crown (golden-angle spread → natural, full)
  const N = 22;
  for (let i = 0; i < N; i++) {
    const a = i * 2.399963;
    const tilt = 0.3 + (i % 5) * 0.16;                                          // lean from vertical
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a)).normalize();
    const L = (24 + (i % 5) * 7) * (0.7 + r / 40);                              // leaf length scales with pot size
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), greens[i % greens.length]);
    leaf.scale.set(1.5, L / 2, Math.min(7, L * 0.22));                          // thin, long, broad blade
    leaf.quaternion.setFromUnitVectors(up, dir);
    leaf.position.set(dir.x * (L / 2 - 3), crownY + dir.y * (L / 2 - 3), dir.z * (L / 2 - 3));
    g.add(leaf);
  }
  // a couple of upright central shoots for fullness
  for (const [dx, dz, L] of [[0, 0, 30], [r * 0.12, -r * 0.1, 24]] as const)
    g.add(cyl(1.4, 2.2, L * (0.7 + r / 40), greens[1], dx, crownY + L * (0.7 + r / 40) / 2, dz, 6));
  return g;
}

// A cabinet built from real-world parts. Options pick the base (splayed legs /
// recessed toe-kick / turned feet / plinth), whether it carries a stone counter
// (with optional backsplash and a sink basin), and a row of drawers over the
// doors — so a credenza, a sideboard, a kitchen base unit and a vanity all read
// as different pieces of furniture rather than the same box.
//
// **Wardrobes are why this got parametric.** No CC0 scan library has a second
// one — Poly Haven carries 26 cabinet-ish models and none is a wardrobe (the
// catalogue's is a `vintage_cabinet_01` standing in), because photogrammetry
// gives you one of whatever somebody happened to scan, never a range. A box
// with doors is also the one shape worth building rather than downloading: the
// variety a real wardrobe wall has — two doors or three, hinged or sliding,
// open, mirrored, a box on top — is all in the *front*, and the front is flat.
// Faces get the same photographed veneer as everything else, so these sit in
// the same room as the scans without looking like a different app.
interface CabOpts {
  doors?: number; rows?: number; topDrawers?: number;
  base?: 'plinth' | 'toekick' | 'legs' | 'feet';
  counter?: boolean; backsplash?: boolean; basin?: boolean;
  handle?: 'bar' | 'knob' | 'none';
  /** Sliding doors: leaves overlap on two tracks instead of butting together. */
  slide?: boolean;
  /** No doors — carcass, back panel, shelves and a hanging rail on view. */
  open?: boolean;
  /** Which door indexes are mirrored instead of veneered. */
  mirror?: number[];
  /** A shallow box of extra storage above the main carcass. */
  topBox?: number;
  /** Body/door finish. White and grey are painted board, not veneer. */
  finish?: 'oak' | 'walnut' | 'white' | 'grey';
}
function cabPull(g: THREE.Group, m: THREE.Material, style: 'bar' | 'knob', x: number, y: number, z: number, span: number) {
  if (style === 'knob') g.add(cyl(1.5, 1.5, 3, m, x, y, z + 2, 12));
  else g.add(rbox(Math.min(span * 0.5, 14), 2.2, 3, 1, m, x, y, z + 2));
}
function cabinetModel(w: number, h: number, height: number, opts: CabOpts = {}): THREE.Group {
  const { doors = 2, rows = 1, topDrawers = 0, base = 'plinth', counter = false, backsplash = false, basin = false, handle = 'knob' } = opts;
  const g = new THREE.Group(); const front = h / 2;
  const bodyM = woodMat(0x7a5636, 0.55, [w, height]), doorM = woodMat(0x86603a, 0.48, [w / Math.max(1, doors), height]);
  const panelM = woodMat(0x6f4d2b, 0.5, [w, height]), frameM = woodMat(0x6b4a2a, 0.55, [w, 20]);
  const hwM = metalMat(0x9aa3b0, 0.3);
  const counterM = stoneMat(0x9aa0a8);
  // --- base / feet ---
  let bottom = 0;
  if (base === 'legs') { const lh = 15; legs4(g, w - 6, h - 6, lh, woodMat(0x4a3320, 0.5), 3, 2, 9, 0.14); bottom = lh; }
  else if (base === 'feet') { const lh = 9; for (const dx of [-1, 1]) for (const dz of [-1, 1]) g.add(cyl(3, 2.4, lh, frameM, dx * (w / 2 - 8), lh / 2, dz * (h / 2 - 8), 10)); bottom = lh; }
  else if (base === 'toekick') { const k = 8; g.add(box(w - 10, k, h - 8, plinthMat(), 0, k / 2, 1)); bottom = k; }
  else { const p = 6; g.add(rbox(w, p, h, 2, woodMat(0x4a3320, 0.6), 0, p / 2, 0)); bottom = p; }
  // --- carcass (leave headroom for a counter) ---
  const carTop = counter ? height - 4 : height;
  const carH = carTop - bottom;
  g.add(rbox(w, carH, h, 2, bodyM, 0, bottom + carH / 2, 0));
  if (!counter) g.add(rbox(w + 3, 4, h + 3, 2, frameM, 0, height, 0));    // finished top when no counter
  // --- drawer band over the doors ---
  const bandH = topDrawers ? Math.min(carH * 0.26, 20) : 0;
  const doorTop = carTop - bandH - (topDrawers ? 2 : 0);
  for (let i = 0; i < topDrawers; i++) {
    const dwn = w / topDrawers, dx = -w / 2 + dwn * (i + 0.5), dy = doorTop + bandH / 2 + 1;
    g.add(rbox(dwn - 4, bandH - 3, 3, 1.5, doorM, dx, dy, front));
    cabPull(g, hwM, 'bar', dx, dy, front, dwn);
  }
  // --- doors, optionally split into `rows`, each with a recessed shaker panel ---
  const doorAreaBot = bottom + 2, doorAreaTop = doorTop - 2, dh = (doorAreaTop - doorAreaBot) / rows;
  const dw = w / doors;
  for (let r = 0; r < rows; r++) for (let i = 0; i < doors; i++) {
    const dx = -w / 2 + dw * (i + 0.5), dyc = doorAreaBot + dh * (r + 0.5);
    g.add(rbox(dw - 3, dh - 2, 3, 2, doorM, dx, dyc, front));                       // door leaf
    g.add(box((dw - 3) * 0.62, (dh - 2) * 0.78, 1.2, panelM, dx, dyc, front + 1.6)); // recessed panel
    const hx = dx + (i % 2 ? -dw / 2 + 6 : dw / 2 - 6);
    if (handle !== 'none') cabPull(g, hwM, handle, hx, dyc, front, 6);
  }
  // --- counter / backsplash / basin ---
  if (counter) {
    g.add(rbox(w + 6, 4, h + 5, 1.5, counterM, 0, height - 2, 1));                  // overhanging top
    if (backsplash) g.add(rbox(w + 6, 14, 3, 1, counterM, 0, height + 5, -h / 2 + 1.5));
    if (basin) {
      g.add(cyl(h * 0.26, h * 0.3, 7, ceramicMat(0xeef2f6), 0, height + 1.5, 2, 24));  // sink bowl
      g.add(cyl(1.6, 1.6, 12, hwM, 0, height + 8, -h / 2 + 9)); g.add(arc(5, 1.4, Math.PI, hwM, 0, height + 14, -h / 2 + 9, 0));  // faucet
    }
  }
  return g;
}

// Chest of drawers: carcass with `n` stacked drawer fronts, each with a bar handle.
function drawerModel(w: number, h: number, height: number, n: number): THREE.Group {
  const g = new THREE.Group(); const front = h / 2;
  const bodyM = woodMat(0x7a5636, 0.55), drawerM = woodMat(0x86603a, 0.5), handle = metalMat(0x9aa3b0, 0.3);
  const carH = height - 6, cy = 3 + carH / 2;
  g.add(rbox(w, 6, h, 2, woodMat(0x4a3320, 0.6), 0, 3, 0));                // plinth
  g.add(rbox(w, carH, h, 2, bodyM, 0, cy, 0));                            // carcass
  g.add(rbox(w + 3, 4, h + 3, 2, woodMat(0x6b4a2a, 0.55), 0, height, 0)); // top
  const gap = 2, dh = (carH - (n + 1) * gap) / n;
  for (let i = 0; i < n; i++) {
    const dy = 3 + gap + dh / 2 + i * (dh + gap);
    g.add(rbox(w - 6, dh, 3, 1.5, drawerM, 0, dy, front));
    g.add(rbox(w * 0.4, 2.4, 3, 1, handle, 0, dy, front + 2));            // bar pull
  }
  return g;
}

// Open shelving: side/top/bottom panels, a back, `n` shelves, no doors — plus a few books.
function shelfModel(w: number, h: number, height: number, n: number): THREE.Group {
  const g = new THREE.Group(); const t = 3;
  const woodM = woodMat(0x8a6238, 0.55), backM = woodMat(0x6b4a2a, 0.62);
  g.add(rbox(t, height, h, 1, woodM, -w / 2 + t / 2, height / 2, 0));      // sides
  g.add(rbox(t, height, h, 1, woodM, w / 2 - t / 2, height / 2, 0));
  g.add(rbox(w, t, h, 1, woodM, 0, height - t / 2, 0));                    // top
  g.add(rbox(w, t, h, 1, woodM, 0, t / 2, 0));                            // bottom
  g.add(box(w - 2 * t, height - 2 * t, 1, backM, 0, height / 2, -h / 2 + 1));  // back panel
  // 書背也是布或紙，不是塑膠。顏色留給每一本各自不同，只取表面。
  const bookM = [0xb4553f, 0x3f6ab4, 0x4f9a5a, 0xc9a13a, 0x8a4fb0].map((c) => {
    const m = mat(c, { roughness: 0.9 });
    m.name = 'book';
    applyScan(m, 'linen', 12, 20, { colour: false });
    return m;
  });
  for (let i = 1; i < n; i++) {
    const y = t + (height - 2 * t) * i / n;
    g.add(rbox(w - 2 * t, t, h - 2, 1, woodM, 0, y, 0));
    if (i % 2) for (let b = 0; b < Math.min(6, Math.floor(w / 14)); b++)     // books on alternate shelves
      g.add(box(9, (height / n) * 0.6, h * 0.55, bookM[(i + b) % bookM.length], -w / 2 + 10 + b * 11, y + (height / n) * 0.3 + t, 0));
  }
  return g;
}

// Glass display cabinet: framed carcass, visible shelves, tinted glass doors.
function glassCabModel(w: number, h: number, height: number, doors: number): THREE.Group {
  const g = new THREE.Group(); const front = h / 2;
  const frameM = woodMat(0x5a4028, 0.5), handle = metalMat(0x9aa3b0, 0.3), glass = glassMat(0xcfe6f0, 0.18);
  const carH = height - 6, cy = 3 + carH / 2;
  g.add(rbox(w, 6, h, 2, woodMat(0x4a3320, 0.6), 0, 3, 0));               // plinth
  g.add(rbox(4, carH, h, 1, frameM, -w / 2 + 2, cy, 0));                  // frame sides
  g.add(rbox(4, carH, h, 1, frameM, w / 2 - 2, cy, 0));
  g.add(rbox(w, 4, h, 1, frameM, 0, 3 + 2, 0));                          // bottom rail
  g.add(rbox(w, 5, h, 1, frameM, 0, height - 2, 0));                     // top
  g.add(box(w - 8, carH - 8, 1, frameM, 0, cy, -h / 2 + 1));             // back
  for (let i = 1; i <= 2; i++) g.add(box(w - 10, 2, h - 6, frameM, 0, 3 + carH * i / 3, 0));  // shelves
  const dw = (w - 4) / doors;
  for (let i = 0; i < doors; i++) {
    const dx = -w / 2 + 2 + dw * (i + 0.5);
    g.add(box(dw - 2, carH - 8, 2, glass, dx, cy, front - 1));           // glass door
    g.add(rbox(2, 22, 3, 1, handle, dx + (i === 0 ? dw / 2 - 4 : -dw / 2 + 4), cy, front + 1));
  }
  return g;
}

// Painted board — a white or grey wardrobe is sprayed MDF, not veneer, and it
// really is that even. Scanning wood grain onto it would be inventing a
// material the piece does not have.
const paintedMat = (color: number, size: [number, number] = [60, 60]) => {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 1.0 });
  m.name = 'paint';
  // 取表面、不取顏色。噴漆 MDF 不是平的——近看有極細的橘皮與刷痕，那正是
  // `beige_wall_001`（標籤就是 painted smooth）掃到的東西。顏色必須留給呼叫端，
  // 不然白衣櫃跟灰衣櫃會一起變成米色。
  applyScan(m, 'beige', size[0], size[1], { colour: false });
  return m;
};

// 踢腳凹槽。深色、霧面，但**不是純色**——它是烤漆板，離地 8cm 是最容易被看到
// 邊緣的地方。這是 verify-textures 最後抓到的一件：整個衣櫃 17 個材質都貼好了，
// 只剩這一條 8 公分高的板子。
const plinthMat = () => {
  const m = new THREE.MeshStandardMaterial({ color: 0x241d15, roughness: 0.85, metalness: 0.02 });
  m.name = 'plinth';
  applyScan(m, 'beige', 60, 20, { colour: false });
  return m;
};

// A wardrobe, built from the choices a real one is specified by.
function wardrobeModel(w: number, h: number, height: number, opts: CabOpts = {}): THREE.Group {
  const { doors = 2, slide = false, open = false, mirror = [], topBox = 0,
          base = 'plinth', handle = 'bar', finish = 'oak' } = opts;
  const g = new THREE.Group(); const front = h / 2;
  const painted = finish === 'white' || finish === 'grey';
  const tone = finish === 'white' ? 0xe9e6df : 0x8d8f92;
  const grain = finish === 'walnut' ? 'walnut' : 'oak';
  const bodyM = painted ? paintedMat(tone, [w, height]) : woodMat(0x7a5636, 0.55, [w, height], grain);
  const doorM = painted ? paintedMat(tone, [w / Math.max(1, doors), height]) : woodMat(0x86603a, 0.46, [w / Math.max(1, doors), height], grain);
  const insideM = painted ? paintedMat(0xdedad2, [w, height]) : woodMat(0x9a7448, 0.62, [w, height], 'oak');
  const hwM = metalMat(0x9aa3b0, 0.28);
  // A mirror in a room with no reflection probe is a dark hole. What reads as a
  // mirror at this size is a very smooth, very light metal — high metalness,
  // near-zero roughness — which takes the environment map the scene already has.
  const mirrorM = new THREE.MeshStandardMaterial({ color: 0xdfe6ec, roughness: 0.04, metalness: 1, envMapIntensity: 2.2 });
  mirrorM.name = 'mirror';        // 命名是為了讓 verify-textures 分得出「刻意沒貼圖」

  const carTop = height - topBox;
  let bottom = 0;
  if (base === 'toekick') { const k = 8; g.add(box(w - 8, k, h - 6, plinthMat(), 0, k / 2, 1)); bottom = k; }
  else if (base === 'feet') { const lh = 9; for (const dx of [-1, 1]) for (const dz of [-1, 1]) g.add(cyl(3, 2.4, lh, bodyM, dx * (w / 2 - 8), lh / 2, dz * (h / 2 - 8), 10)); bottom = lh; }
  else { const p = 6; g.add(rbox(w, p, h, 2, bodyM, 0, p / 2, 0)); bottom = p; }

  const carH = carTop - bottom;
  if (open) {
    // Carcass only: sides, top, bottom, back — then what a wardrobe actually
    // holds. Without the rail and the folded stack it reads as a bookcase.
    const t = 3;
    for (const s of [-1, 1]) g.add(rbox(t, carH, h, 1, bodyM, s * (w / 2 - t / 2), bottom + carH / 2, 0));
    g.add(rbox(w, t, h, 1, bodyM, 0, carTop - t / 2, 0));
    g.add(rbox(w, t, h, 1, bodyM, 0, bottom + t / 2, 0));
    g.add(box(w - 2 * t, carH - 2 * t, 1, insideM, 0, bottom + carH / 2, -h / 2 + 1));
    const railY = bottom + carH * 0.72;
    const rail = cyl(1.5, 1.5, w - 2 * t - 2, hwM, 0, railY, 0, 12);
    rail.rotation.z = Math.PI / 2;                                   // cylinders stand up; a rail runs across
    g.add(rail);
    const shelfY = bottom + carH * 0.86;
    g.add(rbox(w - 2 * t, 2, h - 4, 1, insideM, 0, shelfY, 0));
    const stackM = fabricMat(0xd8d2c6, 1, [30, 20]);
    for (let i = 0; i < 3; i++) g.add(rbox((w - 2 * t) * 0.36, 7, h * 0.6, 1.5, stackM, -w * 0.22, shelfY + 5 + i * 8, 0));
    for (let i = 0; i < 4; i++) {                                     // hanging clothes, blocked in
      const cw = (w - 2 * t) / 5;
      g.add(rbox(cw * 0.8, carH * 0.42, h * 0.5, 3, fabricMat([0x6d7f96, 0x8f6f5c, 0xa8a49b, 0x5f6b5e][i], 1, [30, 40]),
        -w / 2 + t + cw * (i + 0.7), railY - carH * 0.23, 2));
    }
    return g;
  }

  g.add(rbox(w, carH, h - 3, 2, bodyM, 0, bottom + carH / 2, -1.5));   // carcass
  const dh = carH - 3;
  if (slide) {
    // Two tracks: leaves are wider than their share so they overlap, and they
    // sit at two depths. Doors flush in a row would be a hinged wardrobe.
    const lw = (w / doors) * 1.06;
    for (let i = 0; i < doors; i++) {
      const dx = -w / 2 + lw / 2 + i * ((w - lw) / Math.max(1, doors - 1));
      const z = front + (i % 2 ? 1.5 : 4.5);
      g.add(rbox(lw, dh, 2.4, 1, mirror.includes(i) ? mirrorM : doorM, dx, bottom + dh / 2 + 1.5, z));
      if (handle !== 'none') g.add(rbox(2, dh * 0.5, 2, 1, hwM, dx + (i % 2 ? -lw / 2 + 4 : lw / 2 - 4), bottom + dh * 0.55, z + 1.6));
    }
    g.add(rbox(w + 2, 3, h + 2, 1, bodyM, 0, carTop + 1.5, 0));        // head track
  } else {
    const dw = w / doors;
    for (let i = 0; i < doors; i++) {
      const dx = -w / 2 + dw * (i + 0.5);
      const isMirror = mirror.includes(i);
      g.add(rbox(dw - 2, dh, 3, 2, isMirror ? doorM : doorM, dx, bottom + dh / 2 + 1.5, front));
      if (isMirror) g.add(box((dw - 2) * 0.82, dh * 0.9, 1, mirrorM, dx, bottom + dh / 2 + 1.5, front + 1.7));
      else g.add(box((dw - 2) * 0.72, dh * 0.86, 1.2, painted ? paintedMat(tone, [dw, dh]) : woodMat(0x6f4d2b, 0.5, [dw, dh], grain), dx, bottom + dh / 2 + 1.5, front + 1.6));
      if (handle !== 'none') {
        const hx = dx + (i % 2 ? -dw / 2 + 5 : dw / 2 - 5);
        if (handle === 'knob') g.add(cyl(1.5, 1.5, 3, hwM, hx, bottom + dh * 0.5, front + 3, 12));
        else g.add(rbox(2, dh * 0.34, 2.6, 1, hwM, hx, bottom + dh * 0.5, front + 3));
      }
    }
  }
  if (topBox) {
    g.add(rbox(w, topBox, h - 3, 2, bodyM, 0, carTop + topBox / 2, -1.5));
    const bw = w / Math.max(2, doors);
    for (let i = 0; i < Math.max(2, doors); i++) {
      const dx = -w / 2 + bw * (i + 0.5);
      g.add(rbox(bw - 2, topBox - 4, 3, 1.5, doorM, dx, carTop + topBox / 2, front));
      if (handle !== 'none') g.add(rbox(bw * 0.35, 2, 2.4, 1, hwM, dx, carTop + 6, front + 2.5));
    }
  } else {
    g.add(rbox(w + 3, 4, h, 2, bodyM, 0, height, -1.5));               // cornice
  }
  return g;
}

// ---- 日式與北歐：新增的兩個風格分類，靠的是新抓的三張掃描圖 ----
//
// 一個風格分類要有意義，裡面得有東西。實掃圖庫沒有和室家具（沒有人去掃榻榻米
// 地台或障子），但這兩個風格的辨識度**幾乎全在材料**——榻榻米的藺草編、障子的
// 紙與細木格、藤編櫃門——而材料正好是可以掃的。所以這幾件是程式蓋、貼實掃圖。
const tatamiMat = (w: number, h: number) => {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  m.name = 'tatami';
  applyScan(m, 'tatami', w, h);           // 取顏色：藺草的黃綠就是它的樣子
  return m;
};
const rattanMat = (w: number, h: number) => {
  const m = new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 0.78, metalness: 0 });
  m.name = 'rattan';
  applyScan(m, 'rattan', w, h, { colour: false });
  return m;
};
// 障子的紙：半透、有纖維。用亞麻的織紋當纖維，透光靠 transmission。
const shojiPaperMat = () => {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xf6f1e4, roughness: 0.95, metalness: 0,
    transmission: 0.55, thickness: 0.4, ior: 1.1, envMapIntensity: 0.8,
  });
  m.name = 'shoji-paper';
  applyScan(m, 'linen', 30, 30, { colour: false });
  return m;
};

/** 榻榻米地台：邊框是木、面是藺草蓆，離地 12–20cm。 */
function tatamiPlatform(w: number, h: number, height = 16): THREE.Group {
  const g = new THREE.Group();
  const edge = woodMat(0x8a6238, 0.6, [w, height]);
  g.add(rbox(w, height, h, 1.5, edge, 0, height / 2, 0));
  g.add(box(w - 6, 1.5, h - 6, tatamiMat(w, h), 0, height + 0.6, 0));
  // 蓆面的接縫：一疊榻榻米是 90×180，照這個比例分格才像
  const cols = Math.max(1, Math.round(w / 90));
  for (let i = 1; i < cols; i++)
    g.add(box(1.2, 1.8, h - 6, edge, -w / 2 + (w / cols) * i, height + 0.7, 0));
  return g;
}

/** 障子／屏風：細木格 ＋ 半透紙。 */
function shojiScreen(w: number, h: number, height = 175): THREE.Group {
  const g = new THREE.Group();
  const f = woodMat(0x9a7a4e, 0.62, [w, height]);
  const t = 3;
  g.add(rbox(w, t, h, 1, f, 0, height - t / 2, 0));                 // 上下框
  g.add(rbox(w, t, h, 1, f, 0, t / 2, 0));
  for (const s of [-1, 1]) g.add(rbox(t, height, h, 1, f, s * (w / 2 - t / 2), height / 2, 0));
  g.add(box(w - 2 * t, height - 2 * t, 0.8, shojiPaperMat(), 0, height / 2, 0));
  const rows = 6, cols = Math.max(2, Math.round(w / 30));
  for (let i = 1; i < rows; i++) g.add(box(w - 2 * t, 1.2, 1.6, f, 0, t + (height - 2 * t) * i / rows, 0));
  for (let i = 1; i < cols; i++) g.add(box(1.2, height - 2 * t, 1.6, f, -w / 2 + (w / cols) * i, height / 2, 0));
  return g;
}

/** 藤編門片的矮櫃——北歐與日式共用的那種細腳收納。 */
function rattanCabinet(w: number, h: number, height: number, doors = 2, legH = 14): THREE.Group {
  const g = new THREE.Group();
  const woodM = woodMat(0x9c7846, 0.55, [w, height]);
  legs4(g, w - 6, h - 6, legH, woodMat(0x6f5330, 0.5), 3, 2, 7, 0.12);
  const carH = height - legH;
  g.add(rbox(w, carH, h, 2, woodM, 0, legH + carH / 2, 0));
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const dx = -w / 2 + dw * (i + 0.5);
    g.add(box(dw - 4, carH - 8, 1.2, rattanMat(dw, carH), dx, legH + carH / 2, h / 2 + 0.8));
    g.add(cyl(1.2, 1.2, 2.4, metalMat(0xb8a06a, 0.35), dx, legH + carH / 2, h / 2 + 2, 10));
  }
  return g;
}

const BUILDERS: Record<string, (w: number, h: number) => THREE.Object3D> = {
  dining: (w, h) => table(w, h, 75), desk: (w, h) => table(w, h, 75), coffee,
  chair, sofa, armchair,
  bed_double: (w, h) => bed(w, h, true), bed_single: (w, h) => bed(w, h, false),
  wardrobe, fridge, stove, sink, toilet, bathtub, shower, tv: tvStand, rug, plant,
  cabinet_storage: (w, h) => cabinetModel(w, h, 82, { doors: 2, base: 'legs', handle: 'knob' }),          // mid-century credenza on splayed legs
  cabinet_side: (w, h) => cabinetModel(w, h, 88, { doors: 2, topDrawers: 2, base: 'feet', handle: 'bar' }), // sideboard: drawers over doors
  dresser: (w, h) => drawerModel(w, h, 110, 4),
  nightstand: (w, h) => drawerModel(w, h, 50, 2),
  shoe_cabinet: (w, h) => cabinetModel(w, h, 100, { doors: 3, base: 'toekick', handle: 'bar' }),           // shallow shoe cabinet
  cabinet_kitchen: (w, h) => cabinetModel(w, h, 88, { doors: 4, base: 'toekick', counter: true, backsplash: true, handle: 'bar' }), // base unit + worktop
  vanity: (w, h) => cabinetModel(w, h, 80, { doors: 2, base: 'toekick', counter: true, basin: true, handle: 'bar' }),               // vanity with sink
  bookshelf: (w, h) => shelfModel(w, h, 180, 4),
  open_shelf: (w, h) => shelfModel(w, h, 180, 3),
  display_cabinet: (w, h) => glassCabModel(w, h, 180, 2),
  tall_cabinet: (w, h) => cabinetModel(w, h, 200, { doors: 2, rows: 2, base: 'toekick', handle: 'knob' }), // tall pantry: stacked doors
  // 衣櫃家族——參數化而不是下載，理由寫在 CabOpts 上面
  wardrobe_2door: (w, h) => wardrobeModel(w, h, 200, { doors: 2, handle: 'bar' }),
  wardrobe_3door: (w, h) => wardrobeModel(w, h, 200, { doors: 3, handle: 'bar' }),
  wardrobe_4door: (w, h) => wardrobeModel(w, h, 220, { doors: 4, handle: 'knob', finish: 'walnut' }),
  wardrobe_slide: (w, h) => wardrobeModel(w, h, 200, { doors: 2, slide: true }),
  wardrobe_slide3: (w, h) => wardrobeModel(w, h, 220, { doors: 3, slide: true, finish: 'grey' }),
  wardrobe_mirror: (w, h) => wardrobeModel(w, h, 200, { doors: 3, mirror: [1], handle: 'bar' }),
  wardrobe_mirror_slide: (w, h) => wardrobeModel(w, h, 220, { doors: 2, slide: true, mirror: [0], finish: 'white' }),
  wardrobe_open: (w, h) => wardrobeModel(w, h, 200, { open: true }),
  wardrobe_open_oak: (w, h) => wardrobeModel(w, h, 180, { open: true, base: 'feet', finish: 'walnut' }),
  wardrobe_top: (w, h) => wardrobeModel(w, h, 240, { doors: 3, topBox: 45, base: 'toekick', handle: 'bar' }),
  wardrobe_white: (w, h) => wardrobeModel(w, h, 200, { doors: 2, finish: 'white', handle: 'knob' }),
  wardrobe_grey: (w, h) => wardrobeModel(w, h, 210, { doors: 3, finish: 'grey', handle: 'bar' }),
  wardrobe_walnut: (w, h) => wardrobeModel(w, h, 200, { doors: 2, finish: 'walnut', base: 'feet', handle: 'knob' }),
  wardrobe_kids: (w, h) => wardrobeModel(w, h, 150, { doors: 2, finish: 'white', topBox: 30, handle: 'knob' }),
  // 日式
  jp_tatami:     (w, h) => tatamiPlatform(w, h, 16),
  jp_tatami_high: (w, h) => tatamiPlatform(w, h, 32),
  jp_shoji:      (w, h) => shojiScreen(w, h, 175),
  jp_shoji_low:  (w, h) => shojiScreen(w, h, 120),
  jp_low_table:  (w, h) => table(w, h, 33),
  jp_low_cabinet: (w, h) => cabinetModel(w, h, 45, { doors: 3, base: 'plinth', handle: 'none' }),
  jp_futon:      (w, h) => tatamiPlatform(w, h, 24),
  // 北歐
  nd_sideboard:  (w, h) => rattanCabinet(w, h, 78, 3),
  nd_nightstand: (w, h) => rattanCabinet(w, h, 52, 1, 16),
  nd_cabinet:    (w, h) => rattanCabinet(w, h, 120, 2, 16),
  nd_wardrobe:   (w, h) => wardrobeModel(w, h, 190, { doors: 2, base: 'feet', handle: 'knob' }),
  nd_shelf:      (w, h) => shelfModel(w, h, 150, 4),
  nd_bench:      (w, h) => table(w, h, 45),
};

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
    const n = proto.userData.natural as THREE.Vector3;
    const kx = w / (n.x || 1);
    const kz = h / (n.z || 1);
    const g = proto.clone(true);
    g.scale.set(kx, Math.min(kx, kz), kz);
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

/**
 * Kenney's models ship with no textures at all: a flat base colour per material,
 * `roughnessFactor: 1`, `metallicFactor: 0`, no normal map. That is why half the
 * palette looked untextured next to the photogrammetry — it *was*.
 *
 * What they do ship is **semantic material names** — `wood`, `woodDark`, `metal`,
 * `metalLight`, `metalDark`, `carpet`, `glass`, `lamp` — so each one can be
 * matched to the same archetype the procedural furniture uses. Their UVs are
 * real (tens of units across a cabinet, so `repeat` is given directly rather
 * than derived from centimetres), which is what makes a tiling scan work here
 * at all.
 *
 * **Wood takes the scan's colour; nothing else does.** The first version took no
 * colour anywhere, on the reasoning that Kenney's palette is the design. For a
 * white fridge or a pink duvet that is right — repainting them beige would throw
 * the model away. For the cabinets it was plainly wrong: a normal map on a flat
 * tan face is a faint ripple and nothing more, so the wardrobe, the TV cabinet
 * and the storage cabinet still read as untextured, which is what they were
 * reported as. Wood is the one case where the colour *is* the material.
 *
 * Roughness and metalness are set **after** the scan, not before: `applyScan`
 * forces `roughness = 1` when it attaches a roughness map, because with a map
 * the value is a multiplier. Setting them first meant a fridge stayed at
 * roughness 1 — matte plastic — no matter what was attached to it.
 */
// Quaternius is the same situation and the same fix, with two differences worth
// keeping in mind. Its names are not prefixes — `DarkWood`, `Wood1`, `Wood2`
// only match anchored patterns by accident — so these are substring tests.
// And it names upholstery by the *object* rather than the material
// (`Comforter`, `PillowCover`, `Mattress`), which all want the same weave.
const FLAT_ARCHETYPES: { re: RegExp; scan?: string; colour?: boolean; rough: number; metal: number; repeat: number }[] = [
  { re: /wood/i,                        scan: 'veneer_oak',    colour: true,  rough: 0.62, metal: 0,    repeat: 0.03 },
  { re: /metal|steel|chrome/i,          scan: 'metal_brushed', colour: false, rough: 0.33, metal: 0.85, repeat: 0.06 },
  { re: /carpet|rug/i,                  scan: 'weave',         colour: false, rough: 0.95, metal: 0,    repeat: 0.10 },
  { re: /comforter|pillow|mattress|cushion|fabric|cloth|sofa|couch/i,
                                        scan: 'weave',         colour: false, rough: 1,    metal: 0,    repeat: 0.08 },
  { re: /leather/i,                                                           rough: 0.45, metal: 0,    repeat: 1 },
  { re: /glass|mirror/i,                                                      rough: 0.05, metal: 0,    repeat: 1 },
  // `^light$` 是燈罩不是燈泡。Quaternius 把整個罩體叫 `Light`（立燈 60 面、
  // 水晶吊燈 240 面），拿它當發光體就會有五盞燈整片純色。真正不該貼圖的是
  // bulb/emissive 那條。順序也有意義：`LightMetal` 不會被 `^light$` 吃掉，
  // 會往下落到金屬。
  { re: /lamp|shade|^light$/i,          scan: 'linen',         colour: false, rough: 0.9,  metal: 0,    repeat: 0.05 },
  // `\b` 不是裝飾。Quaternius 用顏色命名材質，於是 `LightOrange` 撞上 /light/
  // 被當成燈具——燈具那條刻意不貼圖，所以那張地毯就永遠是純色的。
  { re: /bulb|emissive|glow/i,                                                rough: 0.35, metal: 0.15, repeat: 1 },
  { re: /plant|leaf|foliage/i,          scan: 'rattan',        colour: false, rough: 0.55, metal: 0,    repeat: 0.02 },
  { re: /plastic/i,                     scan: 'beige',         colour: false, rough: 0.4,  metal: 0,    repeat: 0.02 },
  // 保底。Kenney 的模型有幾個 mesh 根本沒有具名材質（glTF 給的是 `_defaultMat`），
  // 沒有這一條它們就永遠留白——實測是水槽、馬桶、洗衣機、抽油煙機、圓形淋浴間、
  // 抽屜邊几六件。噴漆表面是最不會說謊的預設：它只加極細的起伏，不加木紋也不加
  // 織紋，而那六件在現實裡確實都是烤漆或塑料面板。
  { re: /./,                            scan: 'beige',         colour: false, rough: 0.5,  metal: 0,    repeat: 0.02 },
];

function dressFlat(root: THREE.Object3D) {
  root.traverse((o) => {
    const mm = (o as THREE.Mesh).material;
    for (const m of (Array.isArray(mm) ? mm : [mm]) as THREE.MeshStandardMaterial[]) {
      if (!m) continue;
      // **名字可能不在材質上。** Kenney 的 glTF 帶著材質名，但 Quaternius 走的是
      // OBJ → trimesh → GLB，而那條路上材質名掉了，語意留在 *node* 上（`Wood`、
      // `DarkWood`、`Comforter`）。只看 m.name 的話這一整個來源一件都對不上，
      // 而且看起來完全正常——沒有錯誤，只是全部維持純色。
      if (!m.name && o.name) m.name = o.name;
      const a = FLAT_ARCHETYPES.find((k) => k.re.test(m.name ?? ''));
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
      if (entry.source === 'kenney' || entry.source === 'quaternius') dressFlat(root);
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
  const key = `${item}|${Math.round(w)}|${Math.round(h)}`;
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
  const key = `${item}|${Math.round(w)}|${Math.round(h)}`;
  let hgt = _height.get(key);
  if (hgt === undefined) {
    const box = new THREE.Box3().setFromObject(getFurnitureModel(item, w, h));
    hgt = Math.max(1, Math.round(box.max.y - box.min.y));
    _height.set(key, hgt);
  }
  return hgt;
}
