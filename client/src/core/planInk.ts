// Quieter colours for the 2D plan (B25).
//
// On the A1 plan five different things were the same yellow: 57 downlights,
// 21 battens, every piece of furniture's outline, the sub-area dashes and the
// amber "缺：…" line. The eye could not tell a light from a wardrobe, and the
// one line meant to catch attention was lost among the rest. Now only lights
// are yellow and only the missing-items line is amber; furniture draws in a
// warm grey that still reads as "a thing in the room".
//
// Furniture pictograms pick their own colours (data/furniture.ts, 29+ draw
// functions), so they are recoloured at the context boundary, like
// tintContext and monoContext do, rather than edited one by one. The catalogue
// thumbnails and the 3D keep the original colours.

/** The amber family the pictograms use, mapped to the warm greys that replace it. */
const QUIET: Record<string, string> = {
  '#e0b45a': '#a39d90',   // outline and detail lines
  '#f0c869': '#b3ad9f',
  '#ffd98a': '#c4beb0',
  '#c9c07a': '#a8a597',   // tatami edging (olive-yellow)
  '#d9c49a': '#b8b2a5',   // Nordic cabinet dividers (straw)
};

/**
 * A catalogue lamp is a light, and on the plan only lights are yellow: lamps
 * keep their colour. A ceiling fan is filed under 燈具 but is not a light (the
 * same rule roomUse counts lamps by).
 */
export function keepsLampInk(item: { cat?: string; name?: string }): boolean {
  return item.cat === '燈具' && !/扇/.test(item.name ?? '');
}

/** Furniture name labels on the plan, matching the outline. */
export const FURNITURE_LABEL = '#b8b2a5';
/** Sub-area dashes and names: a note on the room, not a second room. */
export const AREA_INK = '#7d8597';

/**
 * Swap an amber pictogram colour for its grey, keeping any alpha suffix
 * ('#e0b45a88' → '#a39d9088'). Anything else passes through untouched.
 */
export function quietInk(c: unknown): unknown {
  if (typeof c !== 'string') return c;
  const m = /^(#[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c.trim());
  if (!m) return c;
  const to = QUIET[m[1].toLowerCase()];
  return to ? to + (m[2] ?? '') : c;
}

/**
 * Whether a floor hatch is worth drawing at this zoom: only when its marks
 * land at least `minPx` apart on screen. Zoomed out to the whole A1 flat
 * (0.5 px/cm) the 30 cm planks were 15 px stripes over five rooms — the
 * "zebra" — saying nothing the room's colour does not. Measured pitches:
 * wood 30 cm, terrazzo ~37, 60 cm tiles 64 (a 32 px grid, which stays).
 */
export function hatchShown(stepCm: number, scale: number, minPx = 20): boolean {
  return stepCm > 0 && stepCm * scale >= minPx;
}

/**
 * The average distance, in tile pixels, between neighbouring marks of a hatch
 * tile — along whichever axis they are closest. Read off the tile itself
 * (`alpha` is its alpha channel, `size × size`) so every material, present and
 * future, gets a pitch without anyone writing one down: planks are lines across
 * one axis, tiles a grid, stipple scattered dots, and all three come out right.
 * Infinity for an empty tile.
 */
export function inkPitch(alpha: ArrayLike<number>, size: number, threshold = 24): number {
  const at = (x: number, y: number) => alpha[y * size + x] > threshold;
  let runsX = 0, runsY = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      // A mark starts where ink follows a gap (wrapping, since the tile repeats).
      if (at(j, i) && !at((j + size - 1) % size, i)) runsX++;
      if (at(i, j) && !at(i, (j + size - 1) % size)) runsY++;
    }
  }
  const px = runsX ? size * size / runsX : Infinity;
  const py = runsY ? size * size / runsY : Infinity;
  return Math.min(px, py);
}
