import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/model/schema';
import { SCHEMA_VERSION } from '../src/model/migrate';

// api.ts talks to localStorage and fetch, neither of which node has. Both are
// installed before it is imported, because the module reads them on call — not
// at load — so a plain global works.

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

/** A stand-in backend: the same store the real one keeps, and a switch to unplug it. */
class FakeServer {
  plans = new Map<string, { name: string; data: Project; at: string }>();
  up = true;
  requests: string[] = [];
  clock = Date.parse('2026-08-07T00:00:00Z');

  private tick() { this.clock += 1000; return new Date(this.clock).toISOString(); }

  fetch = async (url: string, opts: any = {}) => {
    const method = opts.method ?? 'GET';
    this.requests.push(`${method} ${url}`);
    if (!this.up) throw new Error('offline');

    const id = url.startsWith('/api/projects/') ? url.slice('/api/projects/'.length) : '';
    const ok = (body: unknown) => ({ ok: true, json: async () => body });

    if (url === '/api/projects') {
      return ok({
        projects: [...this.plans.entries()]
          .map(([pid, r]) => ({ id: pid, name: r.name, updatedAt: r.at, updatedAtIso: r.at })),
      });
    }
    if (method === 'GET') {
      const row = this.plans.get(id);
      if (!row) return { ok: false, status: 404, json: async () => ({}) };
      return ok({ id, name: row.name, data: row.data, updatedAt: row.at, updatedAtIso: row.at });
    }
    if (method === 'PUT') {
      const body = JSON.parse(opts.body);
      const at = this.tick();
      this.plans.set(id, { name: body.name, data: body.data, at });
      return ok({ id, name: body.name, updatedAt: at, updatedAtIso: at });
    }
    if (method === 'DELETE') {
      this.plans.delete(id);
      return ok({ ok: true });
    }
    return { ok: false, status: 400, json: async () => ({}) };
  };
}

const storage = new FakeStorage();
const server = new FakeServer();
(globalThis as any).localStorage = storage;
(globalThis as any).fetch = server.fetch;

const { listProjects, loadProject, saveProject, deleteProject, syncPending } = await import('../src/net/api');
const store = await import('../src/net/store');

function plan(id: string, name = '案子'): Project {
  return {
    schemaVersion: SCHEMA_VERSION, id, name, layers: [], activeFloorId: 'f',
    floors: [{ id: 'f', name: '1F', elevation: 0, height: 280, objects: [] }],
  };
}

beforeEach(() => {
  storage.clear();
  server.plans.clear();
  server.up = true;
  server.requests = [];
  server.clock = Date.parse('2026-08-07T00:00:00Z');
});

// ---- the bug this exists to fix ----

test('work saved offline is not lost when the tab is closed and reopened', async () => {
  await saveProject(plan('p1', '一開始'));          // reaches the server

  server.up = false;
  await saveProject({ ...plan('p1', '離線改的'), activeFloorId: 'f' });
  server.up = true;

  // a new session: nothing in memory, only the mirror and the server
  const loaded = await loadProject('p1');
  assert.equal(loaded?.name, '離線改的', 'the newer local copy must win');
});

test('the newer copy is pushed back, not just shown', async () => {
  await saveProject(plan('p1', '一開始'));
  server.up = false;
  await saveProject(plan('p1', '離線改的'));
  server.up = true;

  await loadProject('p1');
  await new Promise(r => setTimeout(r, 0));          // the push is not awaited
  assert.equal(server.plans.get('p1')?.data.name, '離線改的');
});

test('a plan the server has newer is taken from the server', async () => {
  await saveProject(plan('p1', '本機'));
  // something else updates it — a second machine, or the desktop build
  server.plans.set('p1', { name: '別處改的', data: plan('p1', '別處改的'),
                           at: '2027-01-01T00:00:00Z' });
  assert.equal((await loadProject('p1'))?.name, '別處改的');
});

// ---- deleting offline ----

test('a plan deleted offline does not come back', async () => {
  await saveProject(plan('p1'));
  server.up = false;
  await deleteProject('p1');
  server.up = true;

  const listed = await listProjects();
  assert.deepEqual(listed.map(m => m.id), [], 'it must not be listed again');

  await syncPending();
  assert.equal(server.plans.has('p1'), false, 'and the backend copy must go');
});

test('a tombstone is cleared once the backend has been told', async () => {
  await saveProject(plan('p1'));
  server.up = false;
  await deleteProject('p1');
  assert.deepEqual(Object.keys(store.tombstones()), ['p1']);
  server.up = true;
  await syncPending();
  assert.deepEqual(Object.keys(store.tombstones()), []);
});

test('deleting while online leaves no tombstone behind', async () => {
  await saveProject(plan('p1'));
  await deleteProject('p1');
  assert.deepEqual(Object.keys(store.tombstones()), []);
});

// ---- the heartbeat ----

test('syncPending pushes what never reached the backend', async () => {
  server.up = false;
  await saveProject(plan('p1', '離線建的'));
  server.up = true;

  const { pushed } = await syncPending();
  assert.equal(pushed, 1);
  assert.equal(server.plans.get('p1')?.data.name, '離線建的');
});

test('syncPending does nothing when the two already agree', async () => {
  await saveProject(plan('p1'));
  assert.deepEqual(await syncPending(), { pushed: 0, deleted: 0 });
});

test('syncPending is a no-op while still offline', async () => {
  await saveProject(plan('p1'));
  server.up = false;
  assert.deepEqual(await syncPending(), { pushed: 0, deleted: 0 });
});

// ---- listing ----

test('a plan created offline is listed even though the backend has never seen it', async () => {
  server.up = false;
  await saveProject(plan('p1', '離線建的'));
  server.up = true;
  const listed = await listProjects();
  assert.deepEqual(listed.map(m => m.name), ['離線建的']);
  assert.equal(listed[0].updatedAt, '尚未上傳');
});

test('the list falls back to the mirror when the backend is down', async () => {
  await saveProject(plan('p1', '甲'));
  server.up = false;
  const listed = await listProjects();
  assert.deepEqual(listed.map(m => m.name), ['甲']);
  assert.equal(listed[0].updatedAt, '離線');
});

// ---- the pre-timestamp mirror ----

test('an entry saved before timestamps existed loses to the server', async () => {
  // the first shape of the mirror: the plan, stored directly
  storage.setItem('interior_projects', JSON.stringify({ p1: plan('p1', '舊鏡像') }));
  server.plans.set('p1', { name: '伺服器', data: plan('p1', '伺服器'),
                           at: '2026-08-07T00:00:01.000Z' });
  assert.equal((await loadProject('p1'))?.name, '伺服器');
});

test('an untimestamped entry the server does not have is still readable', async () => {
  storage.setItem('interior_projects', JSON.stringify({ p1: plan('p1', '只在本機') }));
  assert.equal(store.getPlan('p1')?.plan.name, '只在本機');
  assert.deepEqual((await listProjects()).map(m => m.name), ['只在本機']);
});

// ---- isNewer, the rule itself ----

test('isNewer', () => {
  assert.equal(store.isNewer('2026-08-07T00:00:02Z', '2026-08-07T00:00:01Z'), true);
  assert.equal(store.isNewer('2026-08-07T00:00:01Z', '2026-08-07T00:00:02Z'), false);
  assert.equal(store.isNewer('2026-08-07T00:00:01Z', '2026-08-07T00:00:01Z'), false, 'equal is not newer');
  assert.equal(store.isNewer('', '2026-08-07T00:00:01Z'), false, 'no local stamp never wins');
  assert.equal(store.isNewer('2026-08-07T00:00:01Z', ''), true, 'absent on the server means push it');
  assert.equal(store.isNewer('rubbish', '2026-08-07T00:00:01Z'), false);
  assert.equal(store.isNewer('', ''), true,
    'absent on the server wins over having no local stamp — nothing can be overwritten');
});

test('a plan the mirror alone has is uploaded even though it predates timestamps', async () => {
  // Found by opening the app rather than by a test: seven plans on this machine
  // existed only in the mirror, six with real work in them, all written before
  // savedAt existed. They listed as 尚未上傳 and syncPending pushed none of
  // them, because "no local stamp never wins" was answering before "the server
  // does not have it".
  storage.setItem('interior_projects', JSON.stringify({ p1: plan('p1', '只在本機') }));
  const { pushed } = await syncPending();
  assert.equal(pushed, 1);
  assert.equal(server.plans.get('p1')?.data.name, '只在本機');
});

test('what syncPending pushes has been migrated first', async () => {
  // The mirror keeps whatever shape was current when it was written. Pushing
  // that raw put seven plans on this machine's server with no schemaVersion,
  // and the report endpoint answered 422 for every one of them.
  const legacy: any = { id: 'p1', name: '舊鏡像', layers: [],
                        objects: [{ id: 'w1', kind: 'wall', layer: 'walls',
                                    a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 12 }] };
  storage.setItem('interior_projects', JSON.stringify({ p1: legacy }));

  assert.equal((await syncPending()).pushed, 1);
  const sent: any = server.plans.get('p1')?.data;
  assert.equal(sent.schemaVersion, SCHEMA_VERSION);
  assert.equal(sent.objects, undefined, 'the pre-floors list must not survive the trip');
  assert.equal(sent.floors[0].objects.length, 1, 'and its contents must');
});

test('an untimestamped entry still loses to a copy the server does have', async () => {
  // The reordering must not weaken the original rule.
  storage.setItem('interior_projects', JSON.stringify({ p1: plan('p1', '舊鏡像') }));
  server.plans.set('p1', { name: '伺服器', data: plan('p1', '伺服器'),
                           at: '2026-08-07T00:00:01.000Z' });
  assert.deepEqual(await syncPending(), { pushed: 0, deleted: 0 });
  assert.equal((await loadProject('p1'))?.name, '伺服器');
});
