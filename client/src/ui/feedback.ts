/** Transient status messages, shown in the canvas hint strip. */

const $hint = () => document.querySelector('#hint') as HTMLElement | null;

/**
 * The text to go back to when a flash expires — the tool's own hint.
 *
 * Captured on the **first** flash of a run, not on every one. `flash` used to
 * read whatever was on screen and restore that, which is wrong the moment two
 * of them overlap: exporting a 360 panorama flashes 「正在算全景…」, blocks the
 * main thread for eight seconds capturing it, and then flashes the result — and
 * the second call read 「正在算全景…」 as the thing to restore. It restored it,
 * with no timer behind it, so the strip sat there claiming to be still working
 * on a panorama that had already been saved. The next export then inherited
 * that as *its* resting text, and so on.
 *
 * Null when nothing is pending, which is also the signal to capture again.
 */
let resting: string | null = null;
let timer: number | undefined;

export function flash(msg: string) {
  const el = $hint();
  if (!el) return;
  if (resting === null) resting = el.textContent ?? '';
  el.textContent = msg;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const back = resting; resting = null;
    if (back !== null && $hint()) $hint()!.textContent = back;
  }, 1200);
}

/**
 * A message that stays until something replaces it.
 *
 * `flash` is for "saved", "exported" — things you either catch or do not need.
 * A link that opened nothing is different: you are looking at a blank plan and
 * the reason has to still be on screen when you look for it. Measured at 1.2 s,
 * the flash was gone before a person could finish reading the URL bar.
 *
 * It cancels any pending flash: this *is* the resting text now, and letting an
 * older one paint over it a second later would hide the very thing that has to
 * stay.
 */
export function notice(msg: string) {
  clearTimeout(timer);
  resting = null;
  const el = $hint();
  if (el) el.textContent = msg;
}

/** The tool's own hint became the resting text — drop any flash waiting to undo it. */
export function hintChanged() {
  clearTimeout(timer);
  resting = null;
}
