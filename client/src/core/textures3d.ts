import * as THREE from 'three';

// Procedurally-generated textures (drawn on a canvas) so the 3D view has real
// materials — no external image assets.

let _wood: THREE.Texture | null = null;
let _tile: THREE.Texture | null = null;

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeWood(): THREE.Texture {
  return canvasTex(256, (x, s) => {
    const planks = 4, pw = s / planks;
    const tones = ['#b98a54', '#a9784a', '#9a6b3f', '#b0895e'];
    for (let i = 0; i < planks; i++) {
      x.fillStyle = tones[i % tones.length];
      x.fillRect(i * pw, 0, pw, s);
      x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(i * pw, 0, 2, s);        // seam
      x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(i * pw + 2, 0, 2, s);
      x.strokeStyle = 'rgba(70,45,22,0.22)'; x.lineWidth = 1;               // grain
      for (let g = 0; g < 22; g++) {
        const y = Math.random() * s;
        x.beginPath(); x.moveTo(i * pw + 4, y);
        x.bezierCurveTo(i * pw + pw * 0.3, y + Math.random() * 6 - 3, i * pw + pw * 0.6, y + Math.random() * 6 - 3, i * pw + pw - 4, y + Math.random() * 4 - 2);
        x.stroke();
      }
    }
  });
}

function makeTile(): THREE.Texture {
  return canvasTex(256, (x, s) => {
    x.fillStyle = '#dfe6ec'; x.fillRect(0, 0, s, s);
    const n = 4, t = s / n;
    x.strokeStyle = '#b7c0cb'; x.lineWidth = 3;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, s); x.moveTo(0, i * t); x.lineTo(s, i * t); x.stroke(); }
    // subtle per-tile shade
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`; x.fillRect(i * t + 3, j * t + 3, t - 6, t - 6); }
  });
}

function wood(): THREE.Texture { return _wood ?? (_wood = makeWood()); }
function tile(): THREE.Texture { return _tile ?? (_tile = makeTile()); }

// clones share the source image but carry their own repeat, so each floor can
// tile the planks at a realistic scale.
export function woodClone(u: number, v: number): THREE.Texture {
  const t = wood().clone(); t.needsUpdate = true; t.repeat.set(u, v); return t;
}
export function tileClone(u: number, v: number): THREE.Texture {
  const t = tile().clone(); t.needsUpdate = true; t.repeat.set(u, v); return t;
}
