// Keyboard for the 3D view: the WASD/QE fly keys, the arrow-key pan, and the
// on-screen chips that light up as keys arrive. The view owns the `pressed` set
// and reads it every frame; this file only fills it.

// Match on e.code (physical key position), NOT e.key: a Chinese/Japanese IME or
// a non-US layout rewrites e.key (W becomes "Process" or a composition char) while
// e.code stays "KeyW". Matching e.key was silently dropping WASD under an active IME.
export const MOVE: Record<string, string> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
// The arrow keys slide the view without turning it: up is always up the
// screen, whichever way the camera is pointing.
//
// WASD is a fly — W goes where you are looking — so after orbiting 180° it
// walks the other way across the plan, which is correct for walking through
// a room and wrong for pushing a drawing around. Measured before changing
// anything: W tracked the camera's heading exactly at 8 headings × 7 pitches
// and D was on the right at every one, so the fly was never broken. What was
// missing was the other gesture, not a fix to this one.
export const PAN: Record<string, string> = {
  ArrowUp: 'panUp', ArrowDown: 'panDown', ArrowLeft: 'panLeft', ArrowRight: 'panRight',
};
const isShift = (code: string) => code === 'ShiftLeft' || code === 'ShiftRight';

// Real text entry (project name, labels) must keep the keys; but the property
// panel's number inputs treat letters as junk, so WASD there should fly instead
// of getting swallowed — a common "WASD stopped working" trap after editing a value.
export const isTextField = (el: { isContentEditable?: boolean; tagName: string; type?: string } | null) => {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['number', 'range', 'checkbox', 'radio', 'button'].includes(el.type ?? '');
};

/**
 * Build the key HUD in `container` and listen on the window.
 *
 * `active()` says whether the fly keys are on; `rotate` gets ±90 for Q/E.
 */
export function attachFlyKeys(container: HTMLElement, pressed: Set<string>, active: () => boolean, rotate: (deg: number) => void) {
  const keyChips: Record<string, HTMLElement> = {};
  // B27: the key strip stays out of sight until it has something to say — the
  // pointer is over the 3D view (CSS :hover) or a movement key is down.
  let hudTimer: number | undefined;
  const held = new Set<string>();   // chips lit right now: the strip stays while any key is down
  const flashChip = (k: string, on: boolean) => {
    const c = keyChips[k];
    if (!c) return;
    if (on) { held.add(k); hud.classList.add('live'); clearTimeout(hudTimer); }
    else {
      held.delete(k);
      if (!held.size) { clearTimeout(hudTimer); hudTimer = window.setTimeout(() => hud.classList.remove('live'), 1200); }
    }
    c.style.background = on ? '#7bc6ff' : 'rgba(255,255,255,0.06)';
    c.style.color = on ? '#0b0f14' : '#8b93a3';
  };

  // On-screen key indicator — lights up as movement keys arrive, so it's obvious
  // the fly controls are receiving input (and a quick diagnostic if they aren't).
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  // It shares a bottom dock with the hint line when the page has one (`.dock3d`), so
  // the two stack instead of overlapping (U5); `.key-hud` in style.css lays it out.
  const hud = document.createElement('div');
  hud.className = 'key-hud';
  for (const [label, key] of [['W', 'w'], ['A', 'a'], ['S', 's'], ['D', 'd'], ['⇧', 'shift'], ['␣', 'space'], ['Q', 'q'], ['E', 'e']]) {
    const c = document.createElement('div');
    c.textContent = label;
    c.style.cssText = 'min-width:15px;text-align:center;padding:2px 4px;border-radius:4px;background:rgba(255,255,255,0.06);color:#8b93a3;transition:background .07s,color .07s;';
    hud.appendChild(c); keyChips[key] = c;
  }
  (container.querySelector('.dock3d') ?? container).appendChild(hud);

  // Capture phase so we can release a focused number field and prevent it from
  // also consuming the key before the browser's default runs.
  window.addEventListener('keydown', e => {
    if (!active()) return;
    const el = document.activeElement as HTMLElement | null;
    if (isTextField(el as HTMLInputElement | null)) return;   // genuinely typing — leave the keys alone
    // Q/E rotate the selected object 90° (one-shot per press; ignore auto-repeat)
    if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat) {
      e.preventDefault();
      rotate(e.code === 'KeyE' ? 90 : -90);
      flashChip(e.code === 'KeyE' ? 'e' : 'q', true);
      return;
    }
    const mv = MOVE[e.code], pan = PAN[e.code], up = isShift(e.code), down = e.code === 'Space';
    if (!mv && !pan && !up && !down) return;
    if (el && el !== document.body) el.blur();    // drop focus off a number field so it stops eating keys
    e.preventDefault();
    if (up) { pressed.add('up'); flashChip('shift', true); }         // Shift → rise
    else if (down) { pressed.add('down'); flashChip('space', true); } // Space → descend
    else if (pan) pressed.add(pan);
    else { pressed.add(mv); flashChip(mv, true); }
  }, { capture: true });
  window.addEventListener('keyup', e => {
    const mv = MOVE[e.code], pan = PAN[e.code];
    if (pan) pressed.delete(pan);
    if (mv) { pressed.delete(mv); flashChip(mv, false); }
    else if (isShift(e.code)) { pressed.delete('up'); flashChip('shift', false); }
    else if (e.code === 'Space') { pressed.delete('down'); flashChip('space', false); }
    else if (e.code === 'KeyQ') flashChip('q', false);
    else if (e.code === 'KeyE') flashChip('e', false);
  });
  window.addEventListener('blur', () => { pressed.clear(); for (const k in keyChips) flashChip(k, false); });   // don't let a held key stick across an alt-tab
}
