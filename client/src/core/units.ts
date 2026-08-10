// The cm/m toggle in the properties panel.
//
// Everything in a plan is stored in centimetres; the toggle only changes what
// the panel shows and how it reads back what was typed. That makes it exactly
// the kind of code that fails without complaining: an area converted with the
// length factor is out by 100×, and 24 m² instead of 0.24 m² is still a number
// a room could plausibly have. Getting the round-trip wrong is worse — the
// field redisplays its own rounded value, so a width typed once, then nudged,
// walks away from what the user set.
//
// Pure functions over numbers and strings. The panel owns the DOM and the
// current unit.

export type Unit = 'cm' | 'm';

/** Centimetres per display unit. Area uses the square of this. */
const PER = { cm: 1, m: 100 } as const;

/** Decimals shown, and the input's step. A centimetre is already fine enough. */
const DECIMALS = { cm: 0, m: 2 } as const;

export const unitLabel = (u: Unit) => u;
export const areaLabel = (u: Unit) => (u === 'm' ? 'm²' : 'cm²');

/** The step for a number input, so the arrow keys move by one displayed digit. */
export const stepFor = (u: Unit) => (u === 'm' ? '0.01' : '1');

/** A stored length (cm) as a number in the display unit. */
export const toDisplay = (cm: number, u: Unit) => cm / PER[u];

/** A number typed in the display unit, back to centimetres. */
export const fromDisplay = (v: number, u: Unit) => v * PER[u];

/**
 * What a length field shows.
 *
 * Rounded to the unit's precision, because the value goes into the input and
 * the user may edit it: show 12.3456 in a field stepping by 1 and the next
 * arrow-key press commits 13.3456. Rounding here means what is shown is what
 * gets committed.
 */
export function fieldValue(cm: number, u: Unit): string {
  const d = toDisplay(cm, u);
  return DECIMALS[u] ? d.toFixed(DECIMALS[u]) : String(Math.round(d));
}

/** A length as text with its unit, for read-only rows. */
export function formatLength(cm: number, u: Unit): string {
  return `${fieldValue(cm, u)} ${unitLabel(u)}`;
}

/** A stored area (cm²) as a number in the display unit. Squared factor. */
export const areaToDisplay = (cm2: number, u: Unit) => cm2 / (PER[u] * PER[u]);

/**
 * An area as text with its unit.
 *
 * The factor is squared: 1 m² is 10,000 cm², not 100. This is the one that
 * looks right when it is wrong.
 */
export function formatArea(cm2: number, u: Unit): string {
  const v = areaToDisplay(cm2, u);
  const s = DECIMALS[u] ? v.toFixed(DECIMALS[u]) : String(Math.round(v));
  return `${s} ${areaLabel(u)}`;
}

/**
 * What a typed length should be stored as, or null to leave the object alone.
 *
 * Null for anything unparseable, which includes the transient states of typing
 * a number: an empty field while it is being cleared, or a lone "-". Writing
 * those through as 0 makes the object collapse mid-keystroke and puts a junk
 * entry on the undo stack.
 */
export function parseLength(raw: string, u: Unit, min = 0): number | null {
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  return Math.max(min, fromDisplay(v, u));
}
