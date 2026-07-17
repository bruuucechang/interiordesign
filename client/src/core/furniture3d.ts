import * as THREE from 'three';
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
const woodMat = (color: number, roughness = 0.6) =>
  new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.5, envMapIntensity: 1.0 });
// brushed / satin metal — appliances, faucets, handles, legs
const metalMat = (color = 0x9aa3b0, roughness = 0.32) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.9, envMapIntensity: 1.35 });
// matte upholstery fabric — no reflections, soft
const fabricMat = (color: number, roughness = 1.0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, envMapIntensity: 0.45 });
// glazed ceramic / porcelain — sanitaryware, planters
const ceramicMat = (color = 0xeef2f6) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
// polished stone — countertops
const stoneMat = (color = 0x8a929e) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.35, envMapIntensity: 1.1 });
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
  const bodyM = woodMat(0x7a5636, 0.55), doorM = woodMat(0x86603a, 0.5), frameM = woodMat(0x6b4a2a, 0.55);
  const handle = metalMat(0x9aa3b0, 0.3), mirror = metalMat(0xc2d4e2, 0.04);
  g.add(rbox(w, 8, h, 2, woodMat(0x4a3320, 0.6), 0, 4, 0));                    // plinth
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
  g.add(rbox(w, 2, h, 3, fabricMat(0x4a5570), 0, 1, 0));
  g.add(box(w - 12, 1.5, h - 12, fabricMat(0x5f6d92), 0, 2, 0));
  g.add(box(w - 40, 1, h - 40, fabricMat(0x3f4a66), 0, 2.5, 0));
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
interface CabOpts { doors?: number; rows?: number; topDrawers?: number; base?: 'plinth' | 'toekick' | 'legs' | 'feet'; counter?: boolean; backsplash?: boolean; basin?: boolean; handle?: 'bar' | 'knob'; }
function cabPull(g: THREE.Group, m: THREE.Material, style: 'bar' | 'knob', x: number, y: number, z: number, span: number) {
  if (style === 'knob') g.add(cyl(1.5, 1.5, 3, m, x, y, z + 2, 12));
  else g.add(rbox(Math.min(span * 0.5, 14), 2.2, 3, 1, m, x, y, z + 2));
}
function cabinetModel(w: number, h: number, height: number, opts: CabOpts = {}): THREE.Group {
  const { doors = 2, rows = 1, topDrawers = 0, base = 'plinth', counter = false, backsplash = false, basin = false, handle = 'knob' } = opts;
  const g = new THREE.Group(); const front = h / 2;
  const bodyM = woodMat(0x7a5636, 0.55), doorM = woodMat(0x86603a, 0.48);
  const panelM = woodMat(0x6f4d2b, 0.5), frameM = woodMat(0x6b4a2a, 0.55), hwM = metalMat(0x9aa3b0, 0.3);
  const counterM = stoneMat(0x9aa0a8);
  // --- base / feet ---
  let bottom = 0;
  if (base === 'legs') { const lh = 15; legs4(g, w - 6, h - 6, lh, woodMat(0x4a3320, 0.5), 3, 2, 9, 0.14); bottom = lh; }
  else if (base === 'feet') { const lh = 9; for (const dx of [-1, 1]) for (const dz of [-1, 1]) g.add(cyl(3, 2.4, lh, frameM, dx * (w / 2 - 8), lh / 2, dz * (h / 2 - 8), 10)); bottom = lh; }
  else if (base === 'toekick') { const k = 8; g.add(box(w - 10, k, h - 8, mat(0x241d15, { roughness: 0.85 }), 0, k / 2, 1)); bottom = k; }
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
    cabPull(g, hwM, handle, hx, dyc, front, 6);
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
  const bookM = [mat(0xb4553f), mat(0x3f6ab4), mat(0x4f9a5a), mat(0xc9a13a), mat(0x8a4fb0)];
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
};

export function buildFurniture(item: string, w: number, h: number): THREE.Object3D {
  const b = BUILDERS[item];
  if (b) return b(w, h);
  const g = new THREE.Group();
  g.add(rbox(w, 75, h, 3, mat(0xb0895e), 0, 37.5, 0));
  return g;
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
