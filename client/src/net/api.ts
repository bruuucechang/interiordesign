import { Project } from '../model/types';

// CRUD for projects. Degrades to localStorage when the backend is unreachable
// so the editor stays usable offline.

const LS_KEY = 'interior_projects';
export const apiState = { online: true };

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
    apiState.online = true; return d.projects;
  } catch {
    apiState.online = false;
    return Object.values(lsAll()).map(p => ({ id: p.id, name: p.name, updatedAt: 'local' }));
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  try {
    const d = await j<{ id: string; name: string; data: Project }>(`/api/projects/${id}`);
    apiState.online = true; return d.data;
  } catch {
    apiState.online = false; return lsAll()[id] ?? null;
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
    apiState.online = true; return true;
  } catch { apiState.online = false; return false; }
}

export async function deleteProject(id: string): Promise<void> {
  const map = lsAll(); delete map[id]; lsWrite(map);
  try { await j(`/api/projects/${id}`, { method: 'DELETE' }); apiState.online = true; }
  catch { apiState.online = false; }
}
