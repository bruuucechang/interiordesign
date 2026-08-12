/** Transient status messages, shown in the canvas hint strip. */
export function flash(msg: string) {
  const el = document.querySelector('#hint') as HTMLElement | null;
  if (!el) return;
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = prev; }, 1200);
}

/**
 * A message that stays until something replaces it.
 *
 * `flash` is for "saved", "exported" — things you either catch or do not need.
 * A link that opened nothing is different: you are looking at a blank plan and
 * the reason has to still be on screen when you look for it. Measured at 1.2 s,
 * the flash was gone before a person could finish reading the URL bar.
 */
export function notice(msg: string) {
  const el = document.querySelector('#hint') as HTMLElement | null;
  if (el) el.textContent = msg;
}
