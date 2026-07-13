import { Obj, Vec } from '../model/types';
import { rotate } from './geometry';
import { furnitureCenter } from './hit';

export type HandleKind = 'corner' | 'endpoint' | 'rotate';
export interface Handle { id: string; pos: Vec; kind: HandleKind; }

export function handles(o: Obj): Handle[] {
  switch (o.kind) {
    case 'furniture': {
      const c = furnitureCenter(o);
      const base: Handle[] = [
        { id: 'nw', pos: { x: o.x, y: o.y }, kind: 'corner' },
        { id: 'ne', pos: { x: o.x + o.w, y: o.y }, kind: 'corner' },
        { id: 'se', pos: { x: o.x + o.w, y: o.y + o.h }, kind: 'corner' },
        { id: 'sw', pos: { x: o.x, y: o.y + o.h }, kind: 'corner' },
      ];
      const corners: Handle[] = base.map(h => ({ ...h, pos: rotate(h.pos, c, o.angle) }));
      corners.push({ id: 'rot', pos: rotate({ x: o.x + o.w / 2, y: o.y - 40 }, c, o.angle), kind: 'rotate' });
      return corners;
    }
    case 'room':
      return [
        { id: 'nw', pos: { x: o.x, y: o.y }, kind: 'corner' },
        { id: 'ne', pos: { x: o.x + o.w, y: o.y }, kind: 'corner' },
        { id: 'se', pos: { x: o.x + o.w, y: o.y + o.h }, kind: 'corner' },
        { id: 'sw', pos: { x: o.x, y: o.y + o.h }, kind: 'corner' },
      ];
    case 'wall': case 'dimension':
      return [{ id: 'a', pos: o.a, kind: 'endpoint' }, { id: 'b', pos: o.b, kind: 'endpoint' }];
    case 'door': case 'window': {
      const c = { x: o.x, y: o.y };
      const a = rotate({ x: o.x - o.width / 2, y: o.y }, c, o.angle);
      const b = rotate({ x: o.x + o.width / 2, y: o.y }, c, o.angle);
      const rot = rotate({ x: o.x, y: o.y - 30 }, c, o.angle);
      return [
        { id: 'a', pos: a, kind: 'endpoint' }, { id: 'b', pos: b, kind: 'endpoint' },
        { id: 'rot', pos: rot, kind: 'rotate' },
      ];
    }
  }
}

export function furnitureCornerLocal(id: string, o: { x: number; y: number; w: number; h: number }): Vec {
  switch (id) {
    case 'nw': return { x: o.x, y: o.y };
    case 'ne': return { x: o.x + o.w, y: o.y };
    case 'se': return { x: o.x + o.w, y: o.y + o.h };
    default: return { x: o.x, y: o.y + o.h }; // sw
  }
}
