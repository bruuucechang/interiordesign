import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Proper 3D furniture models assembled from primitives, using rounded-box
// geometry so cushions/bodies look soft instead of blocky.
// Local coords: footprint centered at origin (X in [-w/2,w/2], Z in [-h/2,h/2]),
// Y up from the floor (0). The caller positions/rotates the returned group.

const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.04, ...opts });

// rounded box
function rbox(w: number, h: number, d: number, r: number, m: THREE.Material, x: number, y: number, z: number, rotY = 0) {
  w = Math.max(1, w); h = Math.max(1, h); d = Math.max(1, d);
  const rr = Math.max(0.4, Math.min(r, w / 2 - 0.3, h / 2 - 0.3, d / 2 - 0.3));
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rr), m);
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
  const top = mat(0x9a6b3f, { roughness: 0.55 }), wood2 = mat(0x835a34), leg = mat(0x6b4a2a);
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
  g.add(rbox(w - 16, 3, h - 16, 1.5, mat(0x835a34), 0, 14, 0));               // lower shelf
  g.add(rbox(w * 0.28, 5, h * 0.4, 1, mat(0xc9b48a), -w * 0.12, 44, 0));       // books
  g.add(rbox(w * 0.24, 4, h * 0.34, 1, mat(0x7f9bb0), -w * 0.12, 48.5, 4));
  return g;
}

function chair(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(0x7a5636), fabric = mat(0x9a8468, { roughness: 0.95 });
  const seatY = 45;
  g.add(rbox(w - 2, 5, h - 2, 2, wood, 0, seatY, 0));
  g.add(rbox(w - 8, 6, h - 8, 3, fabric, 0, seatY + 5, 0));                    // plump seat cushion
  g.add(rbox(w - 6, 42, 6, 3, fabric, 0, seatY + 26, -h / 2 + 5));            // padded back
  legs4(g, w, h, seatY - 3, wood, 2.6, 1.8, 5, 0.06);
  return g;
}

function sofa(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const fabric = mat(0x6b7690, { roughness: 0.98 }), cushion = mat(0x808eab, { roughness: 0.98 });
  const seam = mat(0x54607a), legM = mat(0x3a2a1c);
  const throw1 = mat(0xd98c6a, { roughness: 0.98 }), throw2 = mat(0x88b0a0, { roughness: 0.98 });
  const legH = 10, arm = Math.min(24, w * 0.15), baseH = 20;
  legs4(g, w, h, legH, legM, 3, 2, 10, 0.12);
  g.add(rbox(w, baseH, h, 5, fabric, 0, legH + baseH / 2, 0));                 // base
  g.add(rbox(w - 2 * arm + 6, 12, h - 8, 5, cushion, 0, legH + baseH + 1, 2)); // seat platform
  // rolled arms
  for (const s of [-1, 1]) {
    const ax = s * (w / 2 - arm / 2);
    g.add(rbox(arm, 46, h, arm * 0.4, fabric, ax, legH + baseH / 2 + 13, 0));
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(arm / 2, arm / 2, h, 18), fabric);
    roll.rotation.x = Math.PI / 2; roll.position.set(ax, legH + baseH + 36, 0); g.add(roll);
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
  const fabric = mat(0x7d6f8f, { roughness: 0.98 }), cushion = mat(0x9184a6, { roughness: 0.98 }), legM = mat(0x3a2a1c);
  const legH = 10, arm = w * 0.18, baseH = 20;
  legs4(g, w, h, legH, legM, 3, 2, 8, 0.12);
  g.add(rbox(w, baseH, h, 5, fabric, 0, legH + baseH / 2, 0));
  for (const s of [-1, 1]) {
    const ax = s * (w / 2 - arm / 2);
    g.add(rbox(arm, 44, h, arm * 0.45, fabric, ax, legH + baseH / 2 + 12, 0));
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(arm / 2, arm / 2, h, 16), fabric);
    roll.rotation.x = Math.PI / 2; roll.position.set(ax, legH + baseH + 34, 0); g.add(roll);
  }
  const back = rbox(w - 2 * arm, 50, 18, 8, cushion, 0, legH + baseH + 26, -h / 2 + 12); back.rotation.x = -0.08; g.add(back);
  g.add(rbox(w - 2 * arm - 4, 18, h * 0.58, 7, cushion, 0, legH + baseH + 12, h * 0.06));
  g.add(rbox(24, 24, 11, 5, mat(0xd98c6a, { roughness: 0.98 }), 0, legH + baseH + 28, -h / 2 + 20, 0.4));
  return g;
}

function bed(w: number, h: number, dbl: boolean): THREE.Group {
  const g = new THREE.Group();
  const frame = mat(0x6b4a2a), legM = mat(0x4a3320), mattress = mat(0xe8e2d2, { roughness: 0.96 });
  const duvet = mat(0xc7d0dc, { roughness: 0.98 }), runner = mat(0x7c93b0, { roughness: 0.98 });
  const pillow = mat(0xf3f1ea, { roughness: 0.96 }), deco = mat(0xcf8f6b, { roughness: 0.96 }), head = mat(0x8492a8, { roughness: 0.97 });
  const legH = 10;
  legs4(g, w, h, legH, legM, 4, 3, 6, 0);
  g.add(rbox(w, 20, h, 3, frame, 0, legH + 10, 0));
  const mattTop = legH + 20 + 17;
  g.add(rbox(w - 8, 17, h - 8, 6, mattress, 0, legH + 20 + 8.5, 0));           // rounded mattress
  // upholstered headboard with tufting
  g.add(rbox(w, 62, 8, 4, head, 0, legH + 31, -h / 2 + 4));
  tufts(g, Math.max(3, Math.round(w / 40)), 3, -w / 2 + 18, legH + 22, -h / 2 + 8.5, 36, 14, mat(0x6f7d92));
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
  const bodyM = mat(0x7a5636), doorM = mat(0x86603a), frameM = mat(0x6b4a2a);
  const handle = mat(0x9aa3b0, { metalness: 0.6, roughness: 0.4 }), mirror = mat(0xaecbe0, { metalness: 0.9, roughness: 0.06 });
  g.add(rbox(w, 8, h, 2, mat(0x4a3320), 0, 4, 0));                             // plinth
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
  const bodyM = mat(0xdfe4ea, { metalness: 0.35, roughness: 0.35 });
  const handle = mat(0x8b93a2, { metalness: 0.6, roughness: 0.35 });
  g.add(rbox(w, height - legH, h, 5, bodyM, 0, legH + (height - legH) / 2, 0));
  g.add(box(w, 2, 1, mat(0x9aa3b0), 0, legH + (height - legH) * 0.36, front + 1));
  g.add(rbox(3, 46, 3, 1.2, handle, -w / 2 + 8, height * 0.66, front + 1.5));
  g.add(rbox(3, 30, 3, 1.2, handle, -w / 2 + 8, height * 0.2, front + 1.5));
  g.add(box(w * 0.34, 22, 2, mat(0x2a2f38, { metalness: 0.3, roughness: 0.3 }), w * 0.12, height * 0.72, front + 1));
  g.add(box(w * 0.34, 5, 1.5, mat(0x7bd0ff, { emissive: 0x112233, metalness: 0.2 }), w * 0.12, height * 0.8, front + 1.6));
  return g;
}

function stove(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const height = 90, front = h / 2;
  const bodyM = mat(0x8a929e, { metalness: 0.45, roughness: 0.45 }), dark = mat(0x14171e);
  g.add(rbox(w, height, h, 3, bodyM, 0, height / 2, 0));
  g.add(box(w, 22, 3, mat(0x6b7280, { metalness: 0.4 }), 0, height + 11, -h / 2 + 1));
  g.add(rbox(w - 4, 4, h - 4, 1.5, mat(0x24282f), 0, height + 2, 0));          // cooktop glass
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
  const counter = mat(0x8a929e, { metalness: 0.2, roughness: 0.5 });
  const basin = mat(0x5f6b7a, { metalness: 0.5, roughness: 0.3 });
  const f = mat(0x9aa3b0, { metalness: 0.7, roughness: 0.2 });
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
  const g = new THREE.Group(); const white = mat(0xe8edf3, { roughness: 0.35 }), metal = mat(0x9aa3b0, { metalness: 0.5 });
  g.add(rbox(w - 6, 44, 14, 4, white, 0, 46, -h / 2 + 8));                     // tank
  g.add(cyl(3, 3, 2, metal, 0, 68, -h / 2 + 8, 12));
  g.add(cyl(w / 2 - 3, w / 2 - 7, 30, white, 0, 16, h * 0.08, 24));            // bowl
  g.add(cyl(w / 2, w / 2 - 3, 4, white, 0, 33, h * 0.08, 24));                 // seat
  g.add(rbox(w - 8, 3, 12, 1.5, white, 0, 35, h * 0.28));
  return g;
}

function bathtub(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const height = 55;
  const outer = mat(0xe8edf3, { roughness: 0.3 }), inner = mat(0xbcc7d4, { roughness: 0.25 });
  const f = mat(0x9aa3b0, { metalness: 0.65, roughness: 0.25 });
  g.add(rbox(w, height, h, 10, outer, 0, height / 2, 0));
  g.add(rbox(w - 16, height - 12, h - 16, 8, inner, 0, height / 2 + 6, 0));
  g.add(cyl(1.8, 1.8, 16, f, -w / 2 + 12, height + 4, -h / 2 + 10));
  g.add(arc(4, 1.4, Math.PI, f, -w / 2 + 12, height + 12, -h / 2 + 10, 0));
  g.add(cyl(2, 2, 1.5, f, 0, height + 3.5, h / 2 - 12, 10));
  return g;
}

function shower(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const height = 200;
  const tray = mat(0xe8edf3, { roughness: 0.35 });
  const glass = mat(0x9fd4ff, { transparent: true, opacity: 0.22, roughness: 0.05 });
  const metal = mat(0x9aa3b0, { metalness: 0.6, roughness: 0.35 });
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
  const wood = mat(0x3a4150), handle = mat(0x9aa3b0, { metalness: 0.6, roughness: 0.4 });
  g.add(rbox(w, 34, h, 3, wood, 0, 4 + 17, 0));
  legs4(g, w, h, 4, mat(0x222), 2.5, 2, 6, 0);
  for (let i = 0; i < 2; i++) {
    const x = (i === 0 ? -1 : 1) * w / 4;
    g.add(box(w / 2 - 6, 24, 1.5, mat(0x2f353f), x, 4 + 17, h / 2));
    g.add(rbox(w * 0.14, 2.5, 2, 1, handle, x, 4 + 17, h / 2 + 1.5));
  }
  g.add(box(w * 0.18, 6, 8, mat(0x14171e), 0, 41, 0));
  g.add(rbox(w * 0.86, 54, 4, 2, mat(0x0a0c10), 0, 41 + 30, -h / 2 + 5));
  g.add(box(w * 0.82, 48, 1.5, mat(0x1b2740, { metalness: 0.3, roughness: 0.25 }), 0, 41 + 30, -h / 2 + 6.6));
  g.add(rbox(w * 0.5, 6, 8, 2, mat(0x2a2f38), 0, 6 + 17, h / 2 - 4));
  return g;
}

function rug(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(w, 2, h, 3, mat(0x4a5570, { roughness: 0.98 }), 0, 1, 0));
  g.add(box(w - 12, 1.5, h - 12, mat(0x5f6d92, { roughness: 0.98 }), 0, 2, 0));
  g.add(box(w - 40, 1, h - 40, mat(0x3f4a66, { roughness: 0.98 }), 0, 2.5, 0));
  return g;
}

function plant(w: number, h: number): THREE.Group {
  const g = new THREE.Group(); const r = Math.min(w, h) / 2;
  g.add(cyl(r * 0.72, r * 0.62, 3, mat(0x3a3f48), 0, 1.5, 0, 20));
  g.add(cyl(r * 0.6, r * 0.42, 28, mat(0x8a5a3a, { roughness: 0.9 }), 0, 15, 0));
  g.add(cyl(r * 0.62, r * 0.6, 3, mat(0x9a6a48), 0, 28, 0, 20));
  g.add(cyl(r * 0.55, r * 0.55, 3, mat(0x3a2a1c), 0, 28.5, 0, 18));
  const g1 = mat(0x3fae6a, { roughness: 0.9 }), g2 = mat(0x2f7d4f, { roughness: 0.9 }), g3 = mat(0x57c47f, { roughness: 0.9 });
  g.add(sphere(r * 0.8, g1, 0, 30 + r * 0.75, 0));
  g.add(sphere(r * 0.5, g2, r * 0.45, 30 + r * 1.05, r * 0.1));
  g.add(sphere(r * 0.46, g3, -r * 0.42, 30 + r * 0.9, r * 0.3));
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(cone(r * 0.18, r * 1.4, i % 2 ? g2 : g3, Math.cos(a) * r * 0.4, 30 + r * 1.2, Math.sin(a) * r * 0.4, 6)); }
  return g;
}

const BUILDERS: Record<string, (w: number, h: number) => THREE.Object3D> = {
  dining: (w, h) => table(w, h, 75), desk: (w, h) => table(w, h, 75), coffee,
  chair, sofa, armchair,
  bed_double: (w, h) => bed(w, h, true), bed_single: (w, h) => bed(w, h, false),
  wardrobe, fridge, stove, sink, toilet, bathtub, shower, tv: tvStand, rug, plant,
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
