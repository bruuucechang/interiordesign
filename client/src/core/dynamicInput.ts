// Typing a wall instead of dragging one.
//
// Two problems, one answer.
//
// The first is that drawing is mouse-only. `draw.ts`'s `onKey` handles Escape
// and nothing else, so somebody who cannot use a pointer — a tremor, an injury,
// a trackpad they cannot place precisely — cannot draw a wall at all. Not
// "cannot draw it comfortably": there is no path.
//
// The second is that everybody hits the same wall for a different reason: you
// want a wall of exactly 350 cm, and the only way to get one is to drag
// something approximate and then correct it in the properties panel. Every CAD
// tool solves this the same way, and it is the same mechanism — type the
// distance and the angle instead of aiming them.
//
// So this is the accessibility path and the precision path at once, which is
// why it is worth building properly rather than as a ramp bolted on the side.
//
// Pure: keystrokes in, a parsed state out. The tool owns the drawing.

import { Vec } from '../model/schema';

export interface DynamicState {
  /** What has been typed for the length, in the display unit. */
  length: string;
  /** What has been typed for the angle, in degrees. */
  angle: string;
  /** Which box the next digit goes into. */
  field: 'length' | 'angle';
}

export const emptyDynamic = (): DynamicState => ({ length: '', angle: '', field: 'length' });

/** Nothing has been typed, so there is nothing to commit or show. */
export const isEmpty = (s: DynamicState) => !s.length && !s.angle;

/**
 * Apply one keystroke.
 *
 * Returns null for keys this does not own, so the caller can let them through
 * — swallowing everything would break Escape, the tool shortcuts, and undo.
 *
 * `Tab` moves between the two boxes rather than leaving the canvas: while a
 * measurement is half-typed, the next field is the only place Tab could
 * sensibly go, and letting focus escape mid-entry loses what was typed.
 */
export function applyKey(s: DynamicState, key: string): DynamicState | null {
  if (/^[0-9]$/.test(key)) {
    return { ...s, [s.field]: s[s.field] + key } as DynamicState;
  }
  if (key === '.' && !s[s.field].includes('.')) {
    return { ...s, [s.field]: (s[s.field] || '0') + '.' } as DynamicState;
  }
  if (key === '-' && s.field === 'angle' && !s.angle) {
    return { ...s, angle: '-' };
  }
  if (key === 'Backspace') {
    const cur = s[s.field];
    if (cur) return { ...s, [s.field]: cur.slice(0, -1) } as DynamicState;
    // Backspace on an empty box steps back to the previous one, which is what
    // "undo my last keystroke" means when the last keystroke was Tab.
    return s.field === 'angle' ? { ...s, field: 'length' } : null;
  }
  if (key === 'Tab') return { ...s, field: s.field === 'length' ? 'angle' : 'length' };
  return null;
}

/**
 * Where the segment ends, given what was typed.
 *
 * A missing angle means "keep the direction the pointer is already indicating"
 * — that is the common case: aim roughly, then type the exact length. A missing
 * length means the opposite: keep the current distance, fix the angle. Only
 * with neither is there nothing to do.
 *
 * Angles are measured the same way as everywhere else in this file's callers:
 * degrees, clockwise from east, matching `angleDeg`.
 */
export function resolveEnd(
  s: DynamicState, start: Vec, pointer: Vec,
): Vec | null {
  const typedLen = s.length === '' ? null : Number(s.length);
  const typedAng = s.angle === '' || s.angle === '-' ? null : Number(s.angle);
  if (typedLen === null && typedAng === null) return null;
  if (typedLen !== null && (!Number.isFinite(typedLen) || typedLen <= 0)) return null;
  if (typedAng !== null && !Number.isFinite(typedAng)) return null;

  const dx = pointer.x - start.x, dy = pointer.y - start.y;
  const curLen = Math.hypot(dx, dy);
  const len = typedLen ?? curLen;
  if (len <= 0) return null;
  const ang = typedAng ?? (curLen > 1e-9 ? Math.atan2(dy, dx) * 180 / Math.PI : 0);
  const r = ang * Math.PI / 180;
  return { x: start.x + Math.cos(r) * len, y: start.y + Math.sin(r) * len };
}

/** The one-line readout, with the active box marked. */
export function describe(s: DynamicState, unitLabel: string): string {
  const box = (v: string, on: boolean) => (on ? `[${v || '_'}]` : v || '–');
  return `長度 ${box(s.length, s.field === 'length')} ${unitLabel}`
    + `　角度 ${box(s.angle, s.field === 'angle')}°`;
}
