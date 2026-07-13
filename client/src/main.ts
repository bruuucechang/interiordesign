import './style.css';
import { Doc } from './model/doc';
import { Editor } from './core/editor';
import { View3D } from './core/view3d';
import { initUI } from './ui/ui';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLElement;
const hint3d = document.getElementById('hint3d') as HTMLElement;
const c3d = document.getElementById('view3d') as HTMLElement;
const btn3d = document.getElementById('btn3d') as HTMLButtonElement;

const doc = new Doc();
const editor = new Editor(canvas, doc, hint);
initUI(editor, doc);

const view3d = new View3D(c3d);
let is3d = false;

function toggle3d() {
  is3d = !is3d;
  if (is3d) {
    view3d.build(doc);
    c3d.classList.remove('hidden');
    hint3d.classList.remove('hidden');
    hint.classList.add('hidden');
    btn3d.classList.add('active');
    btn3d.textContent = '✏️ 2D 編輯';
    view3d.start();
    view3d.resize();
  } else {
    view3d.stop();
    c3d.classList.add('hidden');
    hint3d.classList.add('hidden');
    hint.classList.remove('hidden');
    btn3d.classList.remove('active');
    btn3d.textContent = '🧊 3D 檢視';
    editor.vp.resize();
    editor.render();
  }
}
btn3d.addEventListener('click', toggle3d);
window.addEventListener('resize', () => { if (is3d) view3d.resize(); });

requestAnimationFrame(() => { editor.vp.resize(); editor.render(); });
