import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webglAvailable, show3DUnavailable } from '../src/core/webgl';

/** The smallest stand-in for the bits of the DOM this module touches. */
function fakeCanvas(ctx: (t: string) => unknown): HTMLCanvasElement {
  return { getContext: (t: string) => ctx(t) } as unknown as HTMLCanvasElement;
}

test('拿得到 webgl2 就是可用', () => {
  assert.equal(webglAvailable(() => fakeCanvas(t => (t === 'webgl2' ? {} : null))), true);
});

test('只有舊的 webgl 也算可用', () => {
  assert.equal(webglAvailable(() => fakeCanvas(t => (t === 'webgl' ? {} : null))), true);
});

test('兩個都拿不到就是不可用', () => {
  assert.equal(webglAvailable(() => fakeCanvas(() => null)), false);
});

test('getContext 直接丟例外也算不可用，不是往上炸', () => {
  // 強化過的瀏覽器與隱私擴充套件會丟例外而不是回 null。這一條就是整個功能的重點：
  // 這裡漏接的話，例外會在模組求值時往上炸掉，連 2D 編輯器都開不起來。
  assert.equal(webglAvailable(() => fakeCanvas(() => { throw new Error('blocked'); })), false);
});

test('連 canvas 都建不出來也算不可用', () => {
  assert.equal(webglAvailable(() => { throw new Error('no document'); }), false);
});

// ------------------------------------------------------ 不能用的時候說清楚

function fakeDom() {
  const mk = (mode?: string) => {
    const attrs: Record<string, string> = {};
    return {
      dataset: mode ? { mode } : {},
      disabled: false,
      setAttribute: (k: string, v: string) => { attrs[k] = v; },
      attrs,
    };
  };
  const buttons = [mk('2d'), mk('split'), mk('3d')];
  const viewModes = { querySelectorAll: () => buttons } as unknown as HTMLElement;
  const kids: any[] = [];
  const pane = {
    innerHTML: 'old',
    children: kids,
    appendChild: (c: any) => { kids.push(c); return c; },
  } as unknown as HTMLElement;
  return { pane, viewModes, buttons, kids };
}

// jsdom-free: the module only uses createElement/append, so stub document.
(globalThis as any).document = {
  createElement: () => {
    const kids: any[] = [];
    return {
      className: '', innerHTML: '', textContent: '',
      children: kids,
      append: (...c: any[]) => { kids.push(...c); },
      appendChild: (c: any) => { kids.push(c); return c; },
    };
  },
};

test('3D 不可用時，那一格要說出原因', () => {
  const { pane, kids } = fakeDom();
  show3DUnavailable(pane, fakeDom().viewModes);
  const box: any = kids[0];
  assert.equal(box.className, 'pane-empty');
  const text = box.children.map((c: any) => c.textContent + c.innerHTML).join(' ');
  assert.match(text, /WebGL/, '要講出是 WebGL 拿不到');
  assert.match(text, /2D/, '要講清楚 2D 不受影響');
});

test('3D 與分割按鈕要停用，2D 不能停用', () => {
  // 留著能按的話，使用者會切到一格永遠畫不出東西的畫面——那跟壞掉分不出來，
  // 而他會合理地去懷疑自己的檔案。
  const { pane, viewModes, buttons } = fakeDom();
  show3DUnavailable(pane, viewModes);
  assert.equal(buttons[0].disabled, false, '2D 一定要留著');
  assert.equal(buttons[1].disabled, true);
  assert.equal(buttons[2].disabled, true);
  assert.match(buttons[2].attrs.title ?? '', /3D/);
});
