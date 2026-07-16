import { Obj, Vec } from '../model/types';
import { Doc } from '../model/doc';
import { dist, distToSegment, distToQuad, wallControl, pointInRect, pointInPolygon, rotate } from './geometry';

export interface Bounds { x: number; y: number; w: number; h: number; }

export function furnitureCenter(o: Extract<Obj, { kind: 'furniture' }>): Vec {
  return { x: o.x + o.w / 2, y: o.y + o.h / 2 };
}

// four corners of a (possibly rotated) furniture rect, world cm
export function furnitureCorners(o: Extract<Obj, { kind: 'furniture' }>): Vec[] {
  const c = furnitureCenter(o);
  const pts = [
    { x: o.x, y: o.y }, { x: o.x + o.w, y: o.y },
    { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h },
  ];
  return pts.map(p => rotate(p, c, o.angle));
}

export function bounds(o: Obj): Bounds {
  switch (o.kind) {
    case 'room': {
      if (o.poly && o.poly.length) {
        const xs = o.poly.map(p => p.x), ys = o.poly.map(p => p.y);
        const x = Math.min(...xs), y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      }
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
    case 'furniture': {
      const cs = furnitureCorners(o);
      const xs = cs.map(p => p.x), ys = cs.map(p => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'wall': case 'dimension':
      return { x: Math.min(o.a.x, o.b.x), y: Math.min(o.a.y, o.b.y), w: Math.abs(o.a.x - o.b.x), h: Math.abs(o.a.y - o.b.y) };
    case 'door': case 'window':
      return { x: o.x - o.width / 2, y: o.y - o.width / 2, w: o.width, h: o.width };
  }
}

// hit test at world point; tolerance in world cm. Returns topmost hit object.
export function hitTest(doc: Doc, p: Vec, tol: number): Obj | undefined {
  const objs = doc.objects;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (!doc.isLayerVisible(o.layer) || doc.isLayerLocked(o.layer)) continue;
    if (hitObject(o, p, tol)) return o;
  }
  return undefined;
}

function hitObject(o: Obj, p: Vec, tol: number): boolean {
  switch (o.kind) {
    case 'wall': {
      const d = o.bulge ? distToQuad(p, o.a, wallControl(o.a, o.b, o.bulge), o.b) : distToSegment(p, o.a, o.b);
      return d <= o.thickness / 2 + tol;
    }
    case 'dimension': return distToSegment(p, o.a, o.b) <= tol * 1.5;
    case 'room': {
      // hit anywhere inside (so it can be selected/moved)
      if (o.poly && o.poly.length >= 3) return pointInPolygon(p, o.poly);
      return pointInRect(p, o.x, o.y, o.w, o.h);
    }
    case 'door': case 'window': return dist(p, { x: o.x, y: o.y }) <= o.width / 2 + tol;
    case 'furniture': {
      const c = furnitureCenter(o);
      const local = rotate(p, c, -o.angle);
      return pointInRect(local, o.x, o.y, o.w, o.h);
    }
  }
}
