// Whether this machine can do 3D, and what to show when it cannot.
//
// Lives in its own module so the decision can be tested. It used to be implicit
// in `main.ts`: a bare `new View3D(c3d)` at module scope, whose constructor
// opens with `new THREE.WebGLRenderer()`. On a machine without WebGL that
// throws while the module is still evaluating, so nothing after it runs and the
// user gets a blank page — including the 2D editor, which needs no WebGL and is
// the part that actually draws the plan.
//
// The machines this happens on are not exotic: an old laptop, hardware
// acceleration switched off, a remote desktop session, a locked-down corporate
// VM. None of them are a reason to lose the whole application.

/** Can a WebGL context be created at all? */
export function webglAvailable(make: () => HTMLCanvasElement = () => document.createElement('canvas')): boolean {
  try {
    const probe = make();
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch {
    // Some hardened browsers and privacy extensions throw from `getContext`
    // rather than returning null. Same answer either way.
    return false;
  }
}

/**
 * Say why the 3D pane is empty, and take away the controls that lead to it.
 *
 * Leaving 分割/3D enabled would let the user switch to a pane that can never
 * draw anything. A blank rectangle is indistinguishable from a bug, and they
 * would reasonably spend time trying to fix their file.
 */
export function show3DUnavailable(pane: HTMLElement, viewModes: HTMLElement): void {
  pane.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'pane-empty';
  const b = document.createElement('b');
  b.textContent = '這台機器無法使用 3D';
  const s = document.createElement('span');
  s.innerHTML = '瀏覽器拿不到 WebGL。常見原因是硬體加速被關掉、遠端桌面，或顯示卡驅動。'
    + '<br>2D 平面圖、匯出與所有繪圖功能都不受影響。';
  msg.append(b, s);
  pane.appendChild(msg);
  for (const btn of Array.from(viewModes.querySelectorAll('button'))) {
    if ((btn as HTMLElement).dataset.mode !== '2d') {
      (btn as HTMLButtonElement).disabled = true;
      btn.setAttribute('title', '這台機器無法使用 3D');
    }
  }
}
