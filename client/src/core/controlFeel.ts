// How sensitive the mouse, wheel and movement keys are — the numbers a game
// puts on its controls page (docs/spec-game-mode.md §1).
//
// The old values were three.js and browser defaults, and two of them scaled the
// wrong way: the fly speed grew with the scene (≈10 m/s through a flat), and the
// 2D wheel zoomed ×1.1 per *event*, which a Mac trackpad fires dozens of times a
// swipe. Here every speed is a fixed base times a per-viewer multiplier.
//
// Pure apart from load/save, which go through a Storage the caller passes in and
// never throw (private windows, blocked storage).

/** Base values at multiplier 1. */
export const FEEL_BASE = {
  /** OrbitControls.rotateSpeed (three's default is 1). */
  rotate: 0.5,
  /** OrbitControls.dampingFactor — higher stops sooner after the drag ends (default 0.05 coasts). */
  damping: 0.15,
  /** OrbitControls.zoomSpeed (default 1). */
  zoom3d: 0.5,
  /** 3D fly and arrow-key pan, cm/s. */
  fly: 250,
  /** 2D wheel: zoom = exp(−deltaY·k), so a 100 px mouse notch is ≈ ×1.08 and a 120 px one ×1.1. */
  wheel2d: 0.0008,
  /** Walk mode mouse look, degrees per pixel of mouse movement. */
  look: 0.12,
} as const;

/** Longest frame the movement keys integrate over, s — a hitch moves you at most this long. */
export const MAX_STEP_S = 0.1;

/** The most one wheel event may zoom the 2D plan, either way. */
export const WHEEL_STEP_MAX = 1.1;

export interface FeelSettings {
  /** Multipliers, 1 = the base above. */
  rotate: number;
  move: number;
  wheel: number;
  look: number;
}

export const FEEL_DEFAULTS: FeelSettings = { rotate: 1, move: 1, wheel: 1, look: 1 };
/** Slider range for every multiplier. */
export const FEEL_MIN = 0.25, FEEL_MAX = 3;
export const FEEL_KEY = 'id.controlFeel';

const clampMul = (v: unknown): number | null =>
  typeof v === 'number' && isFinite(v) ? Math.min(FEEL_MAX, Math.max(FEEL_MIN, v)) : null;

/** Settings from storage; anything missing or junk falls back to the default. */
export function loadFeel(store?: Pick<Storage, 'getItem'> | null): FeelSettings {
  let raw: unknown = null;
  try { raw = JSON.parse(store?.getItem(FEEL_KEY) ?? 'null'); } catch { raw = null; }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...FEEL_DEFAULTS };
  for (const k of Object.keys(out) as (keyof FeelSettings)[]) out[k] = clampMul(o[k]) ?? FEEL_DEFAULTS[k];
  return out;
}

export function saveFeel(s: FeelSettings, store?: Pick<Storage, 'setItem'> | null): void {
  try { store?.setItem(FEEL_KEY, JSON.stringify(s)); } catch { /* storage blocked: settings last this page only */ }
}

/**
 * Zoom factor for one 2D wheel event. Proportional to how far the wheel or
 * trackpad moved, so a swipe made of forty small events zooms as much as one
 * notch of the same total, capped per event so a fast flick cannot jump.
 * `deltaMode` 1 (lines) is a notched mouse in Firefox: ~33 px a line.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0, mul = 1): number {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
  const f = Math.exp(-px * FEEL_BASE.wheel2d * mul);
  return Math.min(WHEEL_STEP_MAX, Math.max(1 / WHEEL_STEP_MAX, f));
}

/** The OrbitControls and movement numbers for a set of multipliers. */
export function orbitFeel(s: FeelSettings) {
  return {
    rotateSpeed: FEEL_BASE.rotate * s.rotate,
    dampingFactor: FEEL_BASE.damping,
    zoomSpeed: FEEL_BASE.zoom3d * s.wheel,
    moveSpeed: FEEL_BASE.fly * s.move,
  };
}
