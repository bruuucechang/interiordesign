import { Project, Vec } from '../model/schema';
import { migrate } from '../model/migrate';
import {
  allPlans, clearTombstone, dropPlan, getPlan, isNewer, markDeleted, nowIso,
  putPlan, tombstones,
} from './store';

// CRUD for projects, over an offline mirror that can disagree with the backend.
// store.ts explains how that disagreement is settled; this file is the traffic.

interface Meta { id: string; name: string; updatedAt: string; }
interface ServerMeta extends Meta { updatedAtIso: string; }
interface ServerPlan extends ServerMeta { data: Project; }

async function j<T>(url: string, opts?: RequestInit, ms = 2500): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json() as T;
  } finally { clearTimeout(t); }
}

async function put(p: Project): Promise<string> {
  const d = await j<{ updatedAtIso: string }>(`/api/projects/${p.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: p.name, data: p }),
  });
  return d.updatedAtIso;
}

/**
 * The named field of a response, but only if it is really an array.
 *
 * Every reader below declares `Promise<X | null>`, where null means "could not
 * ask". None of them used to honour it: `j<T>()` is typed as returning T, so
 * `d.walls` type-checks as `DxfWall[]` even when the body has no `walls` at
 * all, and what came out was `undefined` — neither the value nor the null the
 * signature promised. The caller then did `.map` on it and threw inside an
 * async function, which is an unhandled rejection: nothing on screen, nothing
 * in the network tab, just a feature that stopped working.
 *
 * A 200 carrying the wrong shape is not an answer, so it comes back as null and
 * takes the same path as unreachable. This is the "讀嚴格" half of the project's
 * own rule; the types alone cannot enforce it because the input is untrusted.
 */
function arrayField<T>(d: unknown, key: string): T[] | null {
  const v = (d as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(v) ? (v as T[]) : null;
}

export async function listProjects(): Promise<Meta[]> {
  const local = allPlans();
  const deleted = tombstones();
  try {
    const d = await j<{ projects: ServerMeta[] }>('/api/projects');
    const projects = arrayField<ServerMeta>(d, 'projects');
    if (!projects) throw new Error('/api/projects 的回應沒有 projects 陣列');
    const listed = projects.filter(m => !(m.id in deleted));
    const seen = new Set(listed.map(m => m.id));
    // Plans created while the backend was unreachable exist only here, and
    // still have to be openable.
    const unsent = Object.entries(local)
      .filter(([id]) => !seen.has(id) && !(id in deleted))
      .map(([id, m]) => ({ id, name: m.plan.name, updatedAt: '尚未上傳' }));
    return [...unsent, ...listed];
  } catch {
    return Object.entries(local)
      .filter(([id]) => !(id in deleted))
      .map(([id, m]) => ({ id, name: m.plan.name, updatedAt: '離線' }));
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  const mine = getPlan(id);
  try {
    const d = await j<ServerPlan>(`/api/projects/${id}`);
    if (mine && isNewer(mine.savedAt, d.updatedAtIso)) {
      // Edited offline, then the tab was closed before it could be sent. The
      // server's copy is the older one; push ours rather than opening its.
      void saveProject(mine.plan);
      return mine.plan;
    }
    // Same rule as the array readers: a body without a usable `data` is not a
    // plan, and opening `undefined` as one blanks the editor.
    if (!d?.data || typeof d.data !== 'object') throw new Error('回應沒有 data');
    putPlan(id, d.data, d.updatedAtIso);
    return d.data;
  } catch {
    return mine?.plan ?? null;
  }
}

export async function saveProject(p: Project): Promise<boolean> {
  // Mirrored first, under our own clock, so an interrupted send still leaves
  // the work somewhere and marked as ahead of the server.
  putPlan(p.id, p, nowIso());
  try {
    // Re-filed under the server's clock: now the mirror only reads as newer
    // when its write genuinely did not arrive.
    putPlan(p.id, p, await put(p));
    return true;
  } catch { return false; }
}

export async function deleteProject(id: string): Promise<void> {
  dropPlan(id);
  markDeleted(id, nowIso());
  try {
    await j(`/api/projects/${id}`, { method: 'DELETE' });
    clearTombstone(id);
  } catch { /* the tombstone holds the intent until syncPending replays it */ }
}

/**
 * Replay whatever the backend has not been told: deletions made offline, and
 * plans whose mirror is ahead of the stored copy.
 *
 * Called on startup and from the autosave heartbeat. Silent when there is
 * nothing to do, which is almost always.
 */
export async function syncPending(): Promise<{ pushed: number; deleted: number }> {
  let pushed = 0, deleted = 0;
  let listed: ServerMeta[];
  try {
    const got = arrayField<ServerMeta>(await j<{ projects: ServerMeta[] }>('/api/projects'), 'projects');
    // Treated as offline rather than as an empty server. This one runs on the
    // 20-second autosave heartbeat, so getting it wrong is not a one-off: a
    // backend answering 200 with an unexpected body made every beat throw, for
    // ever, and offline edits were never pushed — with the save indicator
    // still showing 已儲存.
    if (!got) return { pushed, deleted };
    listed = got;
  } catch {
    return { pushed, deleted };   // still offline; the next beat tries again
  }

  for (const id of Object.keys(tombstones())) {
    try {
      await j(`/api/projects/${id}`, { method: 'DELETE' });
      clearTombstone(id);
      deleted++;
    } catch { /* leave the tombstone for the next attempt */ }
  }

  const onServer = new Map(listed.map(m => [m.id, m.updatedAtIso]));
  const stillDeleted = tombstones();
  for (const [id, mine] of Object.entries(allPlans())) {
    if (id in stillDeleted) continue;
    if (!isNewer(mine.savedAt, onServer.get(id) ?? '')) continue;
    try {
      // Migrate on the way out. The mirror holds whatever shape was current
      // when it was written, and the oldest entries predate schemaVersion
      // entirely — pushing them raw put plans on the server that the backend
      // then refused to build a report from, with a 422. Everything the editor
      // opens goes through the same ladder; this path had been skipping it.
      const plan = migrate(mine.plan);
      putPlan(id, plan, await put(plan));
      pushed++;
    } catch { /* next beat */ }
  }
  return { pushed, deleted };
}

// ---- compute served by the backend ----

export interface WallInput { a: Vec; b: Vec; bulge?: number; }

/**
 * Rooms enclosed by the wall network. Runs on the server because it is a
 * batch step behind a 150 ms debounce, not a per-frame one.
 *
 * Returns null — rather than an empty list — when the backend cannot be
 * reached, so the caller can leave the existing rooms alone instead of
 * deleting every one of them on a dropped connection.
 */
export interface DimensionOut { a: Vec; b: Vec; offset: number; }

/**
 * A run of consecutive dimensions along one wall, broken where its openings and
 * any T-junctions fall — the way a plan is actually dimensioned. `objects` is
 * the floor's contents, which is how the backend finds those breaks and which
 * side of the plan is outside.
 */
export async function dimensionChain(
  wall: { a: Vec; b: Vec }, objects: unknown[], offset?: number,
): Promise<DimensionOut[] | null> {
  try {
    const d = await j<{ dimensions: DimensionOut[] }>('/api/dimensions/chain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wall: { a: wall.a, b: wall.b }, objects, ...(offset !== undefined ? { offset } : {}) }),
    }, 8000);
    return arrayField<DimensionOut>(d, 'dimensions');
  } catch { return null; }
}

export interface DxfLayer { layer: string; segments: number; length: number; suggested: boolean; }
export interface DxfInspection {
  layers: DxfLayer[]; unit: string; unitGuessed: boolean;
  extent: { w: number; h: number }; dxfversion: string;
}
export interface DxfWall { a: Vec; b: Vec; thickness: number; bulge?: number; }

/** What a DXF holds, so the user can choose layers before anything is imported. */
export async function inspectDxf(file: string): Promise<DxfInspection | { error: string }> {
  try {
    return await j<DxfInspection>('/api/dxf/inspect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file }),
    }, 30000);
  } catch (e) { return { error: String(e) }; }
}

/** The chosen layers as editor walls, already in centimetres. */
export async function importDxf(file: string, layers: string[], unit: string): Promise<DxfWall[] | null> {
  try {
    const d = await j<{ walls: DxfWall[] }>('/api/dxf/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, layers, unit }),
    }, 60000);
    return arrayField<DxfWall>(d, 'walls');
  } catch { return null; }
}

// thickness 與 segments 一一對應，單位同座標（處理後的像素）。0 = 只看到一個面，量不到。
export interface TracedWalls { segments: [Vec, Vec][]; thickness?: number[]; w: number; h: number; }

/**
 * Wall centrelines traced out of an underlay image, in the processed pixel
 * space whose size comes back as w/h. One-shot and user-initiated, so the
 * round trip costs nothing that matters — and OpenCV finds walls at any angle,
 * which the scanline detector this replaced could not.
 */
export async function detectWalls(imageDataUrl: string): Promise<TracedWalls | null> {
  try {
    const d = await j<TracedWalls>('/api/walls/detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl }),
    }, 30000);   // large scans take a while to decode and transform
    return arrayField<[Vec, Vec]>(d, 'segments') ? d : null;
  } catch { return null; }
}

export async function detectRooms(walls: WallInput[]): Promise<Vec[][] | null> {
  try {
    const d = await j<{ polygons: Vec[][] }>('/api/rooms/detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walls: walls.map(w => ({ a: w.a, b: w.b, bulge: w.bulge ?? 0 })) }),
    }, 5000);
    // A 200 whose body is not the shape we asked for is not an answer. It has
    // to come back as null — the same as unreachable — because the caller's
    // whole reason for distinguishing null from an empty list is that acting on
    // "no rooms" deletes every auto room on the plan. Returning undefined here
    // instead made the caller throw inside an async function: an unhandled
    // rejection, invisible unless the console is open, and it left the walls
    // marked as already-reconciled so the same plan was never retried.
    return arrayField<Vec[]>(d, 'polygons');
  } catch { return null; }
}
