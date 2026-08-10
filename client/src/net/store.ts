// The offline mirror: what localStorage holds and how it is compared with the
// backend.
//
// The mirror is not a cache. The editor stays usable with the backend down, so
// a plan can be edited, and deleted, while only this copy exists — which means
// the two can genuinely disagree and something has to decide.
//
// Newest wins, by timestamp. That is only sound because both sides are stamped
// with the *server's* clock wherever possible: a save that reaches the backend
// files its mirror under the time the backend recorded, so a local entry reads
// as newer exactly when its write did not get through. A local stamp is used
// only for a save the backend never saw, which is the case the rule is for.
//
// Deleting offline leaves a tombstone. Without one, the next sync would see a
// plan on the server and not locally, take it for something created elsewhere,
// and pull the deleted plan back.
//
// Entries written before any of this existed have no timestamp. They are read
// as older than anything on the server, which is how the editor behaved then:
// the backend copy wins. Everything saved from here on carries its own time.

import { Project } from '../model/schema';

const PLANS_KEY = 'interior_projects';
const TOMBSTONES_KEY = 'interior_deleted';

export interface Mirrored {
  plan: Project;
  /** ISO-8601 UTC. The server's stamp when the save reached it, ours when it did not. */
  savedAt: string;
}

/** Older than any real timestamp — see the note about pre-timestamp entries. */
const NEVER = '';

function read<T>(key: string): Record<string, T> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or disabled localStorage must not take the editor down with it;
    // the backend is still the primary copy.
  }
}

/**
 * The mirror, in the current shape.
 *
 * The first version stored plans directly (`{[id]: Project}`). Those are read
 * as untimestamped rather than being thrown away.
 */
export function allPlans(): Record<string, Mirrored> {
  const raw = read<any>(PLANS_KEY);
  const out: Record<string, Mirrored> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && 'plan' in value) {
      out[id] = { plan: value.plan, savedAt: typeof value.savedAt === 'string' ? value.savedAt : NEVER };
    } else if (value && typeof value === 'object') {
      out[id] = { plan: value as Project, savedAt: NEVER };
    }
  }
  return out;
}

export function getPlan(id: string): Mirrored | undefined {
  return allPlans()[id];
}

export function putPlan(id: string, plan: Project, savedAt: string): void {
  const all = allPlans();
  all[id] = { plan, savedAt };
  write(PLANS_KEY, all);
  clearTombstone(id);
}

export function dropPlan(id: string): void {
  const all = allPlans();
  delete all[id];
  write(PLANS_KEY, all);
}

export function tombstones(): Record<string, string> {
  return read<string>(TOMBSTONES_KEY);
}

export function markDeleted(id: string, at: string): void {
  const t = tombstones();
  t[id] = at;
  write(TOMBSTONES_KEY, t);
}

export function clearTombstone(id: string): void {
  const t = tombstones();
  if (!(id in t)) return;
  delete t[id];
  write(TOMBSTONES_KEY, t);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Whether the mirrored copy is ahead of the server's.
 *
 * The two guards have to be in this order.
 *
 * "The server does not have this plan at all" comes first, because there is
 * nothing to overwrite and sending it is unconditionally safe. "The entry has
 * no timestamp, so let the server win" comes second — that rule exists only to
 * stop a stale mirror clobbering a newer stored copy, which needs a stored copy
 * to exist.
 *
 * Reversed, the two rules cancel each other exactly where it matters: entries
 * written before timestamps existed have no `savedAt`, and the plans that live
 * only in the mirror are precisely those old ones. Seven of them were sitting
 * on this machine — six with real work in them — listed as 尚未上傳 and never
 * uploaded, because the no-timestamp guard answered first every time.
 */
export function isNewer(savedAt: string, serverIso: string): boolean {
  const server = Date.parse(serverIso);
  if (!serverIso || Number.isNaN(server)) return true;
  if (!savedAt) return false;
  const local = Date.parse(savedAt);
  if (Number.isNaN(local)) return false;
  return local > server;
}
