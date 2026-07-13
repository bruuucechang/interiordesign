import { jsPDF } from 'jspdf';
import { Doc } from '../model/doc';
import { Viewport } from './viewport';
import { Renderer } from './renderer';
import { bounds } from './hit';

// Render the whole plan (fit to content) onto an offscreen canvas.
function renderToCanvas(doc: Doc): HTMLCanvasElement {
  const objs = doc.objects;
  let bx = 0, by = 0, bw = 500, bh = 400;
  if (objs.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of objs) {
      const b = bounds(o);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    bx = minX; by = minY; bw = maxX - minX; bh = maxY - minY;
  }
  const pad = 100; // cm
  const worldW = bw + pad * 2, worldH = bh + pad * 2;
  const scale = Math.max(1, Math.min(4, 2400 / Math.max(worldW, worldH)));
  const W = Math.round(worldW * scale), H = Math.round(worldH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const vp = new Viewport(canvas);
  vp.dpr = 1; vp.width = W; vp.height = H; vp.scale = scale;
  vp.origin = { x: bx - pad, y: by - pad };

  new Renderer(canvas, vp, doc).render({ background: '#171a20', grid: false, selection: false });
  return canvas;
}

function download(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

export function exportPNG(doc: Doc, name: string) {
  const canvas = renderToCanvas(doc);
  download(canvas.toDataURL('image/png'), `${name || 'floorplan'}.png`);
}

export function exportPDF(doc: Doc, name: string) {
  const canvas = renderToCanvas(doc);
  const img = canvas.toDataURL('image/png');
  const landscape = canvas.width >= canvas.height;
  const pdf = new jsPDF({ orientation: landscape ? 'l' : 'p', unit: 'pt', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
  const m = 24;
  const scale = Math.min((pw - m * 2) / canvas.width, (ph - m * 2) / canvas.height);
  const dw = canvas.width * scale, dh = canvas.height * scale;
  pdf.setFillColor(23, 26, 32); pdf.rect(0, 0, pw, ph, 'F');
  pdf.addImage(img, 'PNG', (pw - dw) / 2, (ph - dh) / 2, dw, dh);
  pdf.save(`${name || 'floorplan'}.pdf`);
}
