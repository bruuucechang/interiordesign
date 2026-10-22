// What the plan needs from the lighting maths: every room on a floor, lit by
// the fittings whose switch group is on, as a grid plus the numbers the panel
// shows. Plus the two things that turn a grid into a picture — the colour
// ramp and the iso-lux lines — kept here because they are pure and the bench
// checks them.
//
// `lighting.ts` is the prototype's maths line for line and stays that way;
// anything the screen needs is built on top of it, here.
//
// Pure: objects in, numbers out. No DOM, no canvas, no doc.

import type { Furniture, Obj, Room } from '../model/schema';
import { polygonArea } from './geometry';
import { FURNITURE_BY_ID } from '../data/furniture';
import type { Box } from './clearance';
import { LightRoom, Luminaire, LuxGrid, grid, lightRoom, luminaires, roomLuminaires } from './lighting';

/**
 * A cabinet counts as built to the ceiling — and so as floor nobody stands on —
 * when its top is within this many cm of the ceiling. A 220 cm wardrobe under a
 * 270 cm ceiling leaves a shelf of air above it and the floor in front of it is
 * still lit; a 260 cm built-in does not.
 */
export const FULL_HEIGHT_GAP = 15;

/** The furniture that fills the room to the ceiling. */
export function fullHeightFurniture(objs: readonly Obj[], ceiling: number): Furniture[] {
  return objs.filter((o): o is Furniture => {
    if (o.kind !== 'furniture') return false;
    const f = o as Furniture;
    return (f.elevation ?? 0) + (f.height ?? FURNITURE_BY_ID[f.item]?.height ?? 0) >= ceiling - FULL_HEIGHT_GAP;
  });
}

export const furnitureBox = (f: Furniture): Box => ({ cx: f.x + f.w / 2, cy: f.y + f.h / 2, w: f.w, h: f.h, angle: f.angle });

/** The footprints of the furniture that fills the room to the ceiling. */
export function fullHeightBoxes(objs: readonly Obj[], ceiling: number): Box[] {
  return fullHeightFurniture(objs, ceiling).map(furnitureBox);
}

/** Switch groups on this floor and how many lights each has, in order. */
export function circuitsOf(objs: readonly Obj[], ceiling: number): { circuit: number; count: number }[] {
  const n = new Map<number, number>();
  for (const L of luminaires(objs, ceiling)) n.set(L.circuit, (n.get(L.circuit) ?? 0) + 1);
  return [...n].sort((a, b) => a[0] - b[0]).map(([circuit, count]) => ({ circuit, count }));
}

export interface LitRoom {
  room: Room;
  lr: LightRoom;
  /** The luminaires that are on and light this room. */
  lums: Luminaire[];
  grid: LuxGrid;
  /** Floor area, m². */
  area: number;
  lumens: number;
  watts: number;
}

export interface LightView {
  /** Work-plane height, cm. */
  height: number;
  rho: number;
  /** Switch groups that are on; null = all. */
  on: ReadonlySet<number> | null;
  step: number;
}

/** The inputs that decide one room's grid, as a string — equal keys, equal grids. */
export function roomKey(r: LightRoom, lums: readonly Luminaire[], v: LightView): string {
  return JSON.stringify([r.poly, r.ceiling, r.blocked, lums, v.height, v.rho, v.step]);
}

interface Prepared { room: Room; lr: LightRoom; lums: Luminaire[]; key: string }

function prepare(objs: readonly Obj[], ceiling: number, v: LightView): Prepared[] {
  const all = luminaires(objs, ceiling, v.on ?? undefined);
  const blocked = fullHeightBoxes(objs, ceiling);
  const out: Prepared[] = [];
  for (const o of objs) {
    if (o.kind !== 'room') continue;
    const lr = lightRoom(o, ceiling, blocked);
    const lums = roomLuminaires(lr, all);
    out.push({ room: o, lr, lums, key: o.id + roomKey(lr, lums, v) });
  }
  return out;
}

/**
 * Everything on this floor the lighting depends on, as one string. Cheap
 * (no grids), so it can run on every document change to tell a change that
 * moves the light from one that does not — selecting something, renaming a
 * floor, moving a sofa.
 */
export function floorSignature(objs: readonly Obj[], ceiling: number, v: LightView): string {
  return prepare(objs, ceiling, v).map(p => p.key).join('\n');
}

/**
 * Light every room on a floor. `cache` is keyed by `roomKey` so a drag that
 * moves one light recomputes only the room it is in; pass the same map back
 * each time and it is pruned to the rooms still present.
 */
export function lightFloor(objs: readonly Obj[], ceiling: number, v: LightView,
                           cache?: Map<string, LuxGrid>): LitRoom[] {
  const out: LitRoom[] = [];
  const seen = new Set<string>();
  for (const { room, lr, lums, key } of prepare(objs, ceiling, v)) {
    seen.add(key);
    let g = cache?.get(key);
    if (!g) {
      g = grid(lr, lums, { height: v.height, rho: v.rho, step: v.step });
      cache?.set(key, g);
    }
    out.push({
      room, lr, lums, grid: g, area: polygonArea(lr.poly) / 1e4,
      lumens: lums.reduce((a, L) => a + L.lumens, 0),
      watts: lums.reduce((a, L) => a + L.watts, 0),
    });
  }
  if (cache) for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
  return out;
}

/** Lux at (x, y) read off a grid, bilinear between samples; NaN outside it. */
export function sample(g: LuxGrid, x: number, y: number): number {
  const fx = (x - g.x0) / g.step, fy = (y - g.y0) / g.step;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return NaN;
  const at = (a: number, b: number) => (a < g.nx && b < g.ny ? g.v[b * g.nx + a] : NaN);
  const tx = fx - i, ty = fy - j;
  const q = [[at(i, j), (1 - tx) * (1 - ty)], [at(i + 1, j), tx * (1 - ty)], [at(i, j + 1), (1 - tx) * ty], [at(i + 1, j + 1), tx * ty]];
  // A missing neighbour (the room's edge, a cabinet) drops out rather than
  // turning the whole reading into NaN.
  let s = 0, w = 0;
  for (const [v, k] of q) if (!Number.isNaN(v) && k > 0) { s += v * k; w += k; }
  return w ? s / w : at(i, j);
}

// ------------------------------------------------------------------ picture

/** The prototype's ramp: night to warm white, lux → colour. */
export const LUX_STOPS: readonly [number, string][] = [
  [0, '#0e1218'], [40, '#2a2236'], [80, '#552d3a'], [130, '#94472b'],
  [200, '#d8822b'], [300, '#f5c45c'], [450, '#fff0c2'], [700, '#ffffff'],
];
export const LUX_MAX = 700;
const STOP_RGB = LUX_STOPS.map(([l, h]) => [l, [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))] as const);

export function luxColor(l: number): [number, number, number] {
  const last = STOP_RGB[STOP_RGB.length - 1][1];
  if (l >= LUX_MAX) return [last[0], last[1], last[2]];
  for (let i = 1; i < STOP_RGB.length; i++) if (l <= STOP_RGB[i][0]) {
    const [l0, c0] = STOP_RGB[i - 1], [l1, c1] = STOP_RGB[i], t = (l - l0) / (l1 - l0);
    return [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [number, number, number];
  }
  return [last[0], last[1], last[2]];
}

/** The grid as RGBA pixels, one per sample; NaN samples are transparent. */
export function heatPixels(g: LuxGrid): Uint8ClampedArray {
  const px = new Uint8ClampedArray(g.nx * g.ny * 4);
  for (let k = 0; k < g.v.length; k++) {
    const e = g.v[k];
    if (Number.isNaN(e)) continue;
    const [r, gg, b] = luxColor(e);
    px[k * 4] = r; px[k * 4 + 1] = gg; px[k * 4 + 2] = b; px[k * 4 + 3] = 255;
  }
  return px;
}

/** Switch-group colours: the prototype's three, then three more. */
export const CIRCUIT_COLORS = ['#ffb547', '#6cc4ff', '#ff8fb8', '#9be38a', '#c9a8ff', '#ffe36e'];
export const circuitColor = (c: number) => CIRCUIT_COLORS[(Math.max(1, Math.round(c)) - 1) % CIRCUIT_COLORS.length];

/** The iso-lux lines drawn over the heat map. */
export const CONTOURS = [100, 200, 300] as const;

/**
 * Marching squares, the prototype's: segments where the grid crosses `level`,
 * as a flat [x1, y1, x2, y2, …] in world cm. Cells touching a NaN are skipped.
 */
export function contour(g: LuxGrid, level: number): number[] {
  const { nx, ny, v, step, x0, y0 } = g;
  const out: number[] = [];
  const pts: number[] = [];
  const edge = (p: number, q: number, x1: number, y1: number, x2: number, y2: number) => {
    if ((p < level) !== (q < level)) { const t = (level - p) / (q - p); pts.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); }
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = v[j * nx + i], b = v[j * nx + i + 1], c = v[(j + 1) * nx + i + 1], e = v[(j + 1) * nx + i];
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(e)) continue;
    const x = x0 + i * step, y = y0 + j * step;
    pts.length = 0;
    edge(a, b, x, y, x + step, y); edge(b, c, x + step, y, x + step, y + step);
    edge(e, c, x, y + step, x + step, y + step); edge(a, e, x, y, x, y + step);
    for (let k = 0; k + 3 < pts.length; k += 4) out.push(pts[k], pts[k + 1], pts[k + 2], pts[k + 3]);
  }
  return out;
}
