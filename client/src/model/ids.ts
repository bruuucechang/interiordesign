// Object and project ids.
//
// Its own module so migrate.ts can mint an id for a floor it invents without
// importing doc.ts, which imports migrate.ts in turn.

let counter = 0;

export function genId(prefix = 'o'): string {
  counter++;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}
