import { Doc, genId } from '../model/doc';
import { Obj, Vec } from '../model/schema';
import { layerForKind } from '../model/catalogue';
import { polygonCentroid, pointInPolygon, pointInRect } from '../core/geometry';
import { detectRooms } from '../net/api';

// Keeps auto-detected rooms in step with the walls. Debounced, because the
// detection is a backend round trip and walls change on every drag.

type WallObj = Extract<Obj, { kind: 'wall' }>;
type RoomObj = Extract<Obj, { kind: 'room' }>;

const bboxOf = (poly: Vec[]) => {
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const roomContains = (r: RoomObj, c: Vec) =>
  (r.poly && r.poly.length >= 3) ? pointInPolygon(c, r.poly) : pointInRect(c, r.x, r.y, r.w, r.h);

let reconcileTimer: number | undefined;
let reconciling = false;
let lastWallSig = '';

function wallSig(doc: Doc): string {
  return (doc.objects.filter(o => o.kind === 'wall') as WallObj[])
    .map(w => `${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join(';');
}

/** Debounced: whenever the walls change, re-derive the auto rooms. */
export function scheduleReconcile(doc: Doc) {
  if (reconciling) return;
  clearTimeout(reconcileTimer);
  reconcileTimer = window.setTimeout(() => {
    const sig = wallSig(doc);
    if (sig === lastWallSig) return;          // walls unchanged — nothing to do
    lastWallSig = sig;
    reconciling = true;
    reconcileAutoRooms(doc).finally(() => { reconciling = false; });
  }, 150);
}

/**
 * Match detected wall-enclosed regions to existing auto rooms: update ones that
 * still hold, drop ones whose enclosure is gone, and add rooms for new closures.
 * Manual rooms — drawn, renamed, or moved — are left untouched.
 */
async function reconcileAutoRooms(doc: Doc) {
  const walls = doc.objects.filter(o => o.kind === 'wall') as WallObj[];
  const detected = await detectRooms(walls);
  // A null result means the backend is unreachable, which is not the same as
  // "no rooms". Reconciling against an empty list would delete every auto room
  // the moment the connection drops, so leave them exactly as they are.
  if (detected === null) { lastWallSig = ''; return; }
  const cents = detected.map(polygonCentroid);
  const rooms = () => doc.objects.filter(o => o.kind === 'room') as RoomObj[];
  const manual = rooms().filter(r => !r.auto);
  const consumed = new Set<number>();

  for (const ar of rooms().filter(r => r.auto)) {
    const arC = ar.poly && ar.poly.length >= 3 ? polygonCentroid(ar.poly) : { x: ar.x + ar.w / 2, y: ar.y + ar.h / 2 };
    let idx = -1;
    for (let i = 0; i < detected.length; i++) {
      if (consumed.has(i)) continue;
      if ((ar.poly && ar.poly.length >= 3 && pointInPolygon(cents[i], ar.poly)) || pointInPolygon(arC, detected[i])) { idx = i; break; }
    }
    if (idx < 0) { doc.remove(ar.id); continue; }                       // enclosure gone
    consumed.add(idx);
    const poly = detected[idx];
    if (JSON.stringify(ar.poly) !== JSON.stringify(poly)) doc.update(ar.id, { poly, ...bboxOf(poly) } as any);
  }

  for (let i = 0; i < detected.length; i++) {
    if (consumed.has(i)) continue;
    if (manual.some(r => roomContains(r, cents[i]))) continue;          // already a manual room here
    const poly = detected[i];
    doc.add({ id: genId('room'), kind: 'room', layer: layerForKind('room'), name: '房間', poly, auto: true, ...bboxOf(poly) } as any);
  }
}
