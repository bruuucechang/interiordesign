import { Vec, Obj } from '../model/types';
import { polygonSignedArea } from './geometry';

type Wall = Extract<Obj, { kind: 'wall' }>;

const MERGE_EPS = 2;         // cm — endpoints closer than this are the same node
const MIN_AREA = 2500;       // cm² (0.25 m²) — ignore slivers between walls

// Find every region enclosed by the wall network and return it as a polygon of
// wall-centerline points. Treats the walls as a planar graph and traces its
// bounded faces via a half-edge walk; the single unbounded face of each
// connected component is dropped. Polygons are returned wound counter-clockwise.
export function detectRoomPolygons(walls: Wall[]): Vec[][] {
  // 1. merge endpoints into shared nodes
  const nodes: Vec[] = [];
  const nodeIndex = (p: Vec): number => {
    for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y) <= MERGE_EPS) return i;
    nodes.push({ x: p.x, y: p.y });
    return nodes.length - 1;
  };

  // 2. unique undirected edges
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const w of walls) {
    const a = nodeIndex(w.a), b = nodeIndex(w.b);
    if (a === b) continue;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  if (!edges.length) return [];

  // 3. outgoing half-edges per node, sorted counter-clockwise by direction
  const out = new Map<number, { to: number; ang: number }[]>();
  const push = (from: number, to: number) => {
    const ang = Math.atan2(nodes[to].y - nodes[from].y, nodes[to].x - nodes[from].x);
    (out.get(from) ?? out.set(from, []).get(from)!).push({ to, ang });
  };
  for (const [a, b] of edges) { push(a, b); push(b, a); }
  for (const arr of out.values()) arr.sort((p, q) => p.ang - q.ang);
  const idxOf = (from: number, to: number) => out.get(from)!.findIndex(e => e.to === to);

  // 4. trace faces: for half-edge (u→v), the next edge is the one just clockwise
  //    of the reverse (v→u) around v. Bounded faces come out clockwise (negative
  //    signed area); the unbounded outer face comes out the other way.
  const visited = new Set<string>();
  const hkey = (f: number, t: number) => `${f}>${t}`;
  const result: Vec[][] = [];
  for (const [a, b] of edges) {
    for (const [s0, e0] of [[a, b], [b, a]] as [number, number][]) {
      if (visited.has(hkey(s0, e0))) continue;
      const face: number[] = [];
      let cf = s0, ct = e0, guard = 0;
      while (guard++ < 100000) {
        visited.add(hkey(cf, ct));
        face.push(cf);
        const arr = out.get(ct)!;
        const ri = idxOf(ct, cf);                       // reverse edge index at ct
        const next = arr[(ri - 1 + arr.length) % arr.length].to;
        cf = ct; ct = next;
        if (cf === s0 && ct === e0) break;
      }
      if (face.length < 3) continue;
      const pts = face.map(i => nodes[i]);
      const area = polygonSignedArea(pts);
      // bounded interior faces are positive here; the unbounded outer face is
      // negative. (A lone loop's inner/outer share a shape, which hid this before
      // — but a divider wall produces two interior faces that must both be kept.)
      if (area > MIN_AREA) result.push([...pts].reverse());   // reversed to keep the prior CW winding downstream
    }
  }
  return result;
}
