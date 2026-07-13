import { Vec } from '../model/types';

export const v = (x: number, y: number): Vec => ({ x, y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const angleDeg = (a: Vec, b: Vec): number => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;

export function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}
export function snapPoint(p: Vec, grid: number): Vec {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

// rotate point p around center c by angle (degrees)
export function rotate(p: Vec, c: Vec, deg: number): Vec {
  const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function pointInRect(p: Vec, x: number, y: number, w: number, h: number): boolean {
  return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
}

// is point p within `tol` of segment a-b? returns distance
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * abx, y: a.y + t * aby });
}

// nearest point on segment a-b to p
export function closestOnSegment(p: Vec, a: Vec, b: Vec): { point: Vec; t: number } {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return { point: { x: a.x + t * abx, y: a.y + t * aby }, t };
}

// format cm as human string (meters when large)
export function fmtLen(cm: number): string {
  const a = Math.abs(cm);
  if (a >= 100) return (cm / 100).toFixed(2) + ' m';
  return Math.round(cm) + ' cm';
}
