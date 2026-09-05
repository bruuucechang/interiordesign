// The numbers this app assumes when nobody has said otherwise.
//
// Every one of them is a **Taiwanese residential** figure. That was invisible
// while there was one user in Taiwan, and it is the kind of thing that is very
// hard to discover from the outside: a 12 cm wall and a 280 cm ceiling are not
// wrong anywhere, they are just not right everywhere, and a plan drawn on them
// looks entirely plausible until somebody builds it.
//
// Collected here so that:
//
//   · they can be *named* in the interface as defaults rather than presented as
//     facts — a beginner cannot tell the difference otherwise;
//   · a second region is a table, not a search through six files.
//
// Not a settings screen. Changing the region is not implemented; what is
// implemented is saying which region the numbers came from, which is the part
// that stops somebody trusting them by accident.

export interface LocaleDefaults {
  /** Where these came from, shown to the user. */
  region: string;
  /** Interior partition wall, cm. */
  wallThickness: number;
  /** Storey height floor-to-floor, cm. */
  floorHeight: number;
  /** Wall height in the 3D view, cm. */
  wallHeight: number;
  /** Door leaf width / height, cm. */
  doorWidth: number;
  doorHeight: number;
  /** Window width and sill height, cm. */
  windowWidth: number;
  windowSill: number;
}

export const TAIWAN_RESIDENTIAL: LocaleDefaults = {
  region: '台灣住宅',
  wallThickness: 12,
  floorHeight: 280,
  wallHeight: 270,
  doorWidth: 90,
  doorHeight: 210,
  windowWidth: 120,
  windowSill: 90,
};

/** The set in force. One entry today; the point is that it is named. */
export const DEFAULTS = TAIWAN_RESIDENTIAL;

/**
 * A note for a field that is showing one of these.
 *
 * Deliberately says the region *and* that it is only a starting value. "12" on
 * its own reads as a property of walls; "台灣住宅的預設值，可以改" reads as a
 * choice somebody made for you.
 */
export function defaultNote(label: string, value: number, unit = 'cm'): string {
  return `${label} ${value}${unit} 是「${DEFAULTS.region}」的預設值，可以直接改`;
}
