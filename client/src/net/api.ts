import { Project, Vec } from '../model/types';

// CRUD for projects. Degrades to localStorage when the backend is unreachable
// so the editor stays usable offline.

const LS_KEY = 'interior_projects';

interface Meta { id: string; name: string; updatedAt: string; }

function lsAll(): Record<string, Project> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function lsWrite(map: Record<string, Project>) { localStorage.setItem(LS_KEY, JSON.stringify(map)); }

async function j<T>(url: string, opts?: RequestInit, ms = 2500): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json() as T;
  } finally { clearTimeout(t); }
}

export async function listProjects(): Promise<Meta[]> {
  try {
    const d = await j<{ projects: Meta[] }>('/api/projects');
    return d.projects;
  } catch {
    return Object.values(lsAll()).map(p => ({ id: p.id, name: p.name, updatedAt: 'local' }));
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  try {
    const d = await j<{ id: string; name: string; data: Project }>(`/api/projects/${id}`);
    return d.data;
  } catch {
    return lsAll()[id] ?? null;
  }
}

export async function saveProject(p: Project): Promise<boolean> {
  // always mirror locally
  const map = lsAll(); map[p.id] = p; lsWrite(map);
  try {
    await j(`/api/projects/${p.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: p.name, data: p }),
    });
    return true;
  } catch { return false; }
}

export async function deleteProject(id: string): Promise<void> {
  const map = lsAll(); delete map[id]; lsWrite(map);
  try { await j(`/api/projects/${id}`, { method: 'DELETE' }); }
  catch { /* local mirror already updated; the backend copy stays until next sync */ }
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
export interface TracedWalls { segments: [Vec, Vec][]; w: number; h: number; }

/**
 * Wall centrelines traced out of an underlay image, in the processed pixel
 * space whose size comes back as w/h. One-shot and user-initiated, so the
 * round trip costs nothing that matters — and OpenCV finds walls at any angle,
 * which the scanline detector this replaced could not.
 */
export async function detectWalls(imageDataUrl: string): Promise<TracedWalls | null> {
  try {
    return await j<TracedWalls>('/api/walls/detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl }),
    }, 30000);   // large scans take a while to decode and transform
  } catch { return null; }
}

export async function detectRooms(walls: WallInput[]): Promise<Vec[][] | null> {
  try {
    const d = await j<{ polygons: Vec[][] }>('/api/rooms/detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walls: walls.map(w => ({ a: w.a, b: w.b, bulge: w.bulge ?? 0 })) }),
    }, 5000);
    return d.polygons;
  } catch { return null; }
}
