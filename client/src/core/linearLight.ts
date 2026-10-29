// How long a fitting drawn as a line is, and what an LED linear light of that
// length gives off (B29, docs/spec-luxury.md §2).
//
// Pure: catalogue numbers in, numbers out. The 2D symbol, the hit test, the 3D
// body and the illuminance maths all ask here, so a 3 m run is drawn, grabbed,
// built and counted at the same 3 m.

import type { ElectricalId } from '../model/schema';
import { LINEAR_LIGHTS, T5_SIZES, T5_DEFAULT_SIZE } from '../model/catalogue';

export const isLinear = (item: ElectricalId | string) => !!LINEAR_LIGHTS[item as ElectricalId];

/**
 * A linear light's length (cm): the stored one held inside the catalogue's
 * bounds, or its default when unset or not a number. 0 for anything else.
 */
export function linearLength(e: { item: ElectricalId | string; length?: number }): number {
  const spec = LINEAR_LIGHTS[e.item as ElectricalId];
  if (!spec) return 0;
  const l = e.length;
  if (l === undefined || !Number.isFinite(l)) return spec.length.def;
  return Math.min(spec.length.max, Math.max(spec.length.min, l));
}

/** Luminous flux (lm, whole) and power (W, one decimal) of `length` cm of this linear light. */
export function linearOutput(item: ElectricalId | string, length: number): { lumens: number; watts: number } {
  const spec = LINEAR_LIGHTS[item as ElectricalId];
  if (!spec) return { lumens: 0, watts: 0 };
  const m = length / 100;
  return { lumens: Math.round(spec.lmPerM * m), watts: Math.round(spec.wPerM * m * 10) / 10 };
}

/** Full length (cm) of a fitting drawn as a line — a T5 batten or a linear light; 0 for a point fitting. */
export function fittingLength(e: { item: ElectricalId | string; length?: number; size?: 1 | 2 | 3 | 4 }): number {
  if (e.item === 'batten') return T5_SIZES[e.size ?? T5_DEFAULT_SIZE].length;
  return linearLength(e);
}
