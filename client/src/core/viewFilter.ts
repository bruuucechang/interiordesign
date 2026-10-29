// 頂列「顯示」(B28, docs/spec-luxury.md §1): what the person looking at the plan
// wants to see right now. It is a filter on the screen, not part of the plan —
// stored in this browser, never committed, never undone, and the exports
// (PNG, plot PDF) draw everything regardless.
//
// The 圖層 still apply on top of it: something is drawn only when its layer is
// visible *and* its group here is ticked. Lighting is computed from every
// fitting either way — a hidden light still lights the room.

import { Obj } from '../model/schema';
import { ELECTRICAL_BY_ID } from '../model/catalogue';
import { FURNITURE_BY_ID } from '../data/furniture';

export type ViewGroup = 'lights' | 'outlets' | 'furniture' | 'notes';

/** The four ticks, in menu order. Names are interface text (translated where drawn). */
export const VIEW_GROUPS: readonly { id: ViewGroup; name: string }[] = [
  { id: 'lights', name: '燈具' },
  { id: 'outlets', name: '插座開關' },
  { id: 'furniture', name: '家具' },
  { id: 'notes', name: '尺寸與標註' },
];

/**
 * Which tick an object answers to, or null for what is always there: walls,
 * beams, partitions, rooms, doors and windows, the underlay — "the actual room".
 * A catalogue lamp is a light, not furniture (the same 燈具 category the plan
 * colours lamps by); a fitting is a light when the catalogue files it under 燈具.
 */
// 尺寸與標註 also takes the wall lengths and beam clearances off the screen —
// those are labels on a wall, not objects, so the renderer does that itself
// (`RenderOpts.lengths`); the wall stays.
export function viewGroup(o: Obj): ViewGroup | null {
  switch (o.kind) {
    case 'electrical': return ELECTRICAL_BY_ID[o.item]?.cat === '燈具' ? 'lights' : 'outlets';
    case 'furniture': return FURNITURE_BY_ID[o.item]?.cat === '燈具' ? 'lights' : 'furniture';
    case 'dimension': case 'area': return 'notes';
    default: return null;
  }
}

export function shownWith(hidden: ReadonlySet<ViewGroup>, o: Obj): boolean {
  const g = viewGroup(o);
  return g === null || !hidden.has(g);
}

/** Read the stored list back, keeping only names that are still groups. */
export function parseHidden(raw: string | null): Set<ViewGroup> {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    const ids = new Set<string>(VIEW_GROUPS.map(g => g.id));
    return new Set(Array.isArray(v) ? v.filter((x): x is ViewGroup => typeof x === 'string' && ids.has(x)) : []);
  } catch { return new Set(); }
}

// ---- this browser's setting ----

const KEY = 'interior_view_hidden';
let hidden: Set<ViewGroup> = (() => {
  try { return parseHidden(globalThis.localStorage?.getItem(KEY) ?? null); } catch { return new Set<ViewGroup>(); }
})();
const listeners = new Set<() => void>();

/** Is this object drawn and pickable on screen, as far as 顯示 goes? */
export function isShown(o: Obj): boolean { return shownWith(hidden, o); }
export function isGroupShown(g: ViewGroup): boolean { return !hidden.has(g); }
export function setGroupShown(g: ViewGroup, on: boolean) {
  if (on === !hidden.has(g)) return;
  hidden = new Set(hidden);
  if (on) hidden.delete(g); else hidden.add(g);
  try { localStorage.setItem(KEY, JSON.stringify([...hidden])); } catch { /* private window: this session only */ }
  for (const f of listeners) f();
}
export function onViewFilterChange(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }
