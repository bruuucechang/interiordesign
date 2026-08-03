/** Transient status messages, shown in the canvas hint strip. */
export function flash(msg: string) {
  const el = document.querySelector('#hint') as HTMLElement | null;
  if (!el) return;
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = prev; }, 1200);
}
