import { Doc, genId } from '../model/doc';
import { Obj, Vec } from '../model/schema';
import { layerForKind } from '../model/catalogue';
import { polygonCentroid, pointInPolygon, pointInRect, polygonArea } from '../core/geometry';
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

/** cm² — below this a detected loop is structure, not a room. */
const MIN_AUTO_ROOM = 2_0000;   // 2 m²

/**
 * Everything that closes a region: walls, and partition lines.
 *
 * The detector works on a planar graph of segments and does not care whether
 * a segment is built or drawn — which is exactly what makes a partition line
 * work. Leave them out and drawing one does nothing at all: no new room, no
 * error, just a dashed line that the area take-off ignores.
 */
function dividers(doc: Doc): WallObj[] {
  return doc.objects.filter(o => o.kind === 'wall' || o.kind === 'partition') as WallObj[];
}

function wallSig(doc: Doc): string {
  return dividers(doc)
    .map(w => `${w.kind[0]}${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join(';');
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
    reconcileAutoRooms(doc)
      .catch((e) => {
        // Never let a failed reconcile poison the signature: leaving it set
        // means this exact set of walls is never tried again, and auto rooms
        // just quietly stop appearing.
        lastWallSig = '';
        console.error('[rooms-sync] reconcile 失敗', e);
      })
      .finally(() => { reconciling = false; });
  }, 150);
}

/**
 * Match detected wall-enclosed regions to existing auto rooms: update ones that
 * still hold, drop ones whose enclosure is gone, and add rooms for new closures.
 * Manual rooms — drawn, renamed, or moved — are left untouched.
 */
async function reconcileAutoRooms(doc: Doc) {
  const detected = await detectRooms(dividers(doc));
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

  /** The centre of a room, however it is shaped. */
  const centre = (r: RoomObj) => (r.poly && r.poly.length >= 3
    ? polygonCentroid(r.poly)
    : { x: r.x + r.w / 2, y: r.y + r.h / 2 });

  for (let i = 0; i < detected.length; i++) {
    if (consumed.has(i)) continue;
    const poly = detected[i];
    if (manual.some(r => roomContains(r, cents[i]))) continue;          // already a manual room here

    // And: a region that swallows rooms someone has already drawn is not a new
    // room, it is a failed detection. It happens whenever the partitions do not
    // quite meet the walls — the only closed loop left is the whole floor, so
    // one giant "房間" gets laid over the entire plan.
    //
    // Nothing about that reads as an error. What it looks like is the floors
    // breaking up, because the new room's slab sits at exactly the same height
    // as every slab underneath it and the two fight for the same depth. That is
    // what was actually reported: 「地板一閃一閃像破圖」.
    const swallowed = manual.filter(r => pointInPolygon(centre(r), poly)).length;
    if (swallowed >= 2) continue;

    // Too small to be a room. A column drawn as four walls, a duct, a pipe
    // shaft — they are all closed loops the detector will happily return, and
    // naming them 房間 puts a floor and a label inside something nobody can
    // walk into. The backend already drops slivers under 0.25 m²; this is the
    // next size up, where the shape is real but the room is not.
    if (polygonArea(poly) < MIN_AUTO_ROOM) continue;

    doc.add({ id: genId('room'), kind: 'room', layer: layerForKind('room'), name: '房間', poly, auto: true, ...bboxOf(poly) } as any);
  }
}
