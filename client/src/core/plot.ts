import { jsPDF } from 'jspdf';
import { Doc } from '../model/doc';
import { Project, Floor } from '../model/schema';
import { Viewport } from './viewport';
import { Renderer } from './renderer';
import { bounds } from './hit';
import { polygonArea } from './geometry';

// Scaled plotting: lay the plan out on a real paper size at a real drawing
// scale, inside a border with a title block, a graphic scale bar and a room
// schedule. Unlike exportPDF (which just fits a screenshot to the page), a
// sheet produced here can be measured with a ruler.

export type PaperId = 'A4' | 'A3';
export type Orientation = 'landscape' | 'portrait';

// Paper sizes in millimetres, always given long-edge first.
const PAPER: Record<PaperId, { long: number; short: number }> = {
  A4: { long: 297, short: 210 },
  A3: { long: 420, short: 297 },
};

// Standard architectural scales, largest (most detailed) first. `1:N`.
export const SCALES = [20, 25, 30, 50, 100, 200] as const;

// Wall length labels are drawn just outside each wall in screen space, so they
// always sit beyond the geometric extent. Reserve a band of paper for them, or
// the outermost labels get clipped at the drawing-area edge.
const ANNOTATION_MM = 6;

const MARGIN_MM = 10;          // paper edge → border
// The title column is deliberately narrow. At 62 mm a 10.4 x 7.8 m plan — a very
// ordinary apartment — missed 1:50 on A4 by 4 mm and fell all the way to 1:100,
// wasting half the sheet. 55 mm still holds the block and the room schedule.
const TITLE_W_MM = 55;
const GUTTER_MM = 5;           // border → drawing area

export interface SheetChoice {
  scale: number;               // the N in 1:N
  paper: PaperId;
  orientation: Orientation;
  drawAreaMM: { w: number; h: number };
}

/** Millimetres of drawing area available on a given paper/orientation. */
export function drawAreaMM(paper: PaperId, orientation: Orientation): { w: number; h: number } {
  const p = PAPER[paper];
  const pw = orientation === 'landscape' ? p.long : p.short;
  const ph = orientation === 'landscape' ? p.short : p.long;
  return {
    w: pw - MARGIN_MM * 2 - TITLE_W_MM - GUTTER_MM * 2,
    h: ph - MARGIN_MM * 2 - GUTTER_MM * 2,
  };
}

/** Of the drawing area, the part the plan geometry itself may occupy. */
export function planAreaMM(paper: PaperId, orientation: Orientation): { w: number; h: number } {
  const a = drawAreaMM(paper, orientation);
  return { w: a.w - ANNOTATION_MM * 2, h: a.h - ANNOTATION_MM * 2 };
}

/**
 * Pick a sheet for a `worldW × worldH` (cm) plan.
 *
 * Paper is the outer choice and A4 comes first: nearly every home and office
 * printer takes A4, and a sheet nobody can print is worse than a slightly
 * coarser scale. Within a paper size the finest standard scale that still fits
 * wins, so the plan fills the sheet. A3 is reached only when the plan will not
 * fit on A4 even at 1:200. The caller can always override.
 */
export function chooseSheet(worldW: number, worldH: number): SheetChoice {
  const papers: PaperId[] = ['A4', 'A3'];
  const orientations: Orientation[] = ['landscape', 'portrait'];
  let best: SheetChoice | null = null;
  for (const paper of papers) {
    for (const scale of SCALES) {
      for (const orientation of orientations) {
        const plan = planAreaMM(paper, orientation);
        // world cm → mm on paper: 1 cm of world = 10/scale mm of paper
        const needW = worldW * 10 / scale, needH = worldH * 10 / scale;
        if (needW <= plan.w && needH <= plan.h) {
          if (!best) best = { scale, paper, orientation, drawAreaMM: drawAreaMM(paper, orientation) };
        }
      }
      if (best) break;   // finest scale that works on this paper wins
    }
    if (best) break;     // smallest paper that works at all wins
  }
  // Nothing fits even at 1:200 — fall back to the biggest sheet and let the
  // caller shrink; the label will still state the true scale.
  return best ?? {
    scale: SCALES[SCALES.length - 1], paper: 'A3', orientation: 'landscape',
    drawAreaMM: drawAreaMM('A3', 'landscape'),
  };
}

/** Union bounding box (cm) of every object on every floor, so all sheets share one scale. */
export function projectExtent(project: Project): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of project.floors) {
    for (const o of f.objects) {
      if (o.kind === 'image') continue;              // underlay is a tracing aid, never plotted
      const b = bounds(o);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 500, h: 400 };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export interface RoomRow { name: string; m2: number; ping: number; }

/** Room schedule for one floor: name, area in m² and 坪 (1 坪 = 3.30579 m²). */
export function roomSchedule(floor: Floor): RoomRow[] {
  const rows: RoomRow[] = [];
  for (const o of floor.objects) {
    if (o.kind !== 'room') continue;
    const m2 = (o.poly && o.poly.length >= 3 ? polygonArea(o.poly) : o.w * o.h) / 10000;
    if (m2 <= 0) continue;
    rows.push({ name: o.name || '房間', m2, ping: m2 / 3.30579 });
  }
  return rows;
}

/** Nice round scale-bar length: the largest 1/2/5×10ⁿ metres fitting `maxMM` on paper. */
export function scaleBarMetres(scale: number, maxMM: number): number {
  const maxM = maxMM * scale / 1000;
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
  let best = steps[0];
  for (const s of steps) if (s <= maxM) best = s;
  return best;
}

// ---------------------------------------------------------------- rendering

const PLOT_DPI = 300;
const DPMM = PLOT_DPI / 25.4;          // device pixels per millimetre of paper
const mm2px = (mm: number) => Math.max(1, Math.round(mm * DPMM));

// Screen-space labels are authored around this pixel size; on paper they should
// come out about this many millimetres tall.
const SCREEN_LABEL_PX = 13;
const LABEL_TARGET_MM = 2.6;

/**
 * A transparent high-resolution tile of text. jsPDF's built-in fonts are
 * Latin-only, and both project and room names are Chinese, so all lettering is
 * drawn with the browser's font stack and placed as an image. Rules and frames
 * stay vector.
 */
interface TextItem { x: number; y: number; text: string; size: number; bold?: boolean; align?: 'left' | 'right' | 'center'; }

function textTile(items: TextItem[], wMM: number, hMM: number): string {
  const c = document.createElement('canvas');
  c.width = mm2px(wMM); c.height = mm2px(hMM);
  const g = c.getContext('2d')!;
  g.scale(DPMM, DPMM);                  // draw in millimetres
  g.fillStyle = '#000000';
  g.textBaseline = 'alphabetic';
  for (const it of items) {
    g.font = `${it.bold ? '600 ' : ''}${it.size}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`;
    g.textAlign = it.align ?? 'left';
    g.fillText(it.text, it.x, it.y);
  }
  return c.toDataURL('image/png');
}

/** Render one floor's plan into a canvas at true scale, monochrome — the plotted image. */
export function plotFloorCanvas(project: Project, floorId: string, sheet: SheetChoice,
                                extent: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  // Deep copy: Doc.serialize() hands back the live project, so switching the
  // active floor on a shared reference would move the user's real view.
  const copy: Project = JSON.parse(JSON.stringify(project));
  copy.activeFloorId = floorId;
  const doc = new Doc(copy);

  const canvas = document.createElement('canvas');
  canvas.width = mm2px(sheet.drawAreaMM.w);
  canvas.height = mm2px(sheet.drawAreaMM.h);

  // Labels (room names, dimension text) are drawn in screen space at a fixed
  // pixel size tuned for a display. On a 300 DPI sheet that is about 1 mm tall —
  // unreadable. Viewport.dpr scales screen space only, and the world transform
  // is scale × dpr, so dividing scale by the same factor blows the lettering up
  // to a printable size while the drawing keeps its true scale.
  const k = LABEL_TARGET_MM * DPMM / SCREEN_LABEL_PX;
  const pxPerCm = 10 * DPMM / sheet.scale;   // 1 cm of world = (10 / scale) mm of paper

  const vp = new Viewport(canvas);
  vp.dpr = k;
  vp.width = canvas.width / k; vp.height = canvas.height / k;   // CSS-pixel space
  vp.scale = pxPerCm / k;
  // centre the shared extent so every floor lines up sheet to sheet
  const visW = canvas.width / pxPerCm, visH = canvas.height / pxPerCm;
  vp.origin = { x: extent.x + extent.w / 2 - visW / 2, y: extent.y + extent.h / 2 - visH / 2 };

  new Renderer(canvas, vp, doc).render({
    background: '#ffffff', grid: false, selection: false, mono: true, skipKinds: ['image'],
  });
  return canvas;
}

export interface PlotOpts {
  scale?: number;
  paper?: PaperId;
  orientation?: Orientation;
  date?: Date;
}

/** Build and download a scaled, bordered, titled PDF — one page per floor. */
export function plotPDF(doc: Doc, name: string, opts: PlotOpts = {}) {
  buildPlotPDF(doc, name, opts).save(`${name || 'floorplan'}_圖面.pdf`);
}

/** The sheet set itself, without saving — separated so it can be previewed or tested. */
export function buildPlotPDF(doc: Doc, name: string, opts: PlotOpts = {}): jsPDF {
  const project = doc.serialize();
  const extent = projectExtent(project);
  const auto = chooseSheet(extent.w, extent.h);
  const sheet: SheetChoice = {
    scale: opts.scale ?? auto.scale,
    paper: opts.paper ?? auto.paper,
    orientation: opts.orientation ?? auto.orientation,
    drawAreaMM: drawAreaMM(opts.paper ?? auto.paper, opts.orientation ?? auto.orientation),
  };

  const p = PAPER[sheet.paper];
  const pw = sheet.orientation === 'landscape' ? p.long : p.short;
  const ph = sheet.orientation === 'landscape' ? p.short : p.long;
  // compress: jsPDF defaults to storing streams raw, which for a 300 DPI sheet
  // is ~16 MB of pixels regardless of how little ink is on it.
  const pdf = new jsPDF({
    orientation: sheet.orientation === 'landscape' ? 'l' : 'p',
    unit: 'mm', format: [pw, ph], compress: true,
  });

  const bx = MARGIN_MM, by = MARGIN_MM, bw = pw - MARGIN_MM * 2, bh = ph - MARGIN_MM * 2;
  const dx = MARGIN_MM + GUTTER_MM, dy = MARGIN_MM + GUTTER_MM;
  const tx = pw - MARGIN_MM - TITLE_W_MM;
  const dateStr = (opts.date ?? new Date()).toISOString().slice(0, 10);

  project.floors.forEach((floor, i) => {
    if (i > 0) pdf.addPage([pw, ph], sheet.orientation === 'landscape' ? 'l' : 'p');

    // plan image, placed at exactly the drawing-area rectangle → true scale
    const canvas = plotFloorCanvas(project, floor.id, sheet, extent);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', dx, dy, sheet.drawAreaMM.w, sheet.drawAreaMM.h);

    drawSheetFurniture(pdf, {
      pw, ph, bx, by, bw, bh, dx, dy, tx,
      sheet, floor, name, dateStr, pageNo: i + 1, pageCount: project.floors.length,
    });
  });

  return pdf;
}

interface SheetCtx {
  pw: number; ph: number; bx: number; by: number; bw: number; bh: number;
  dx: number; dy: number; tx: number;
  sheet: SheetChoice; floor: Floor; name: string; dateStr: string;
  pageNo: number; pageCount: number;
}

/** Border, title block, room schedule and scale bar — vector rules + text tiles. */
function drawSheetFurniture(pdf: jsPDF, c: SheetCtx) {
  const { bx, by, bw, bh, dx, dy, tx, sheet, floor } = c;
  pdf.setDrawColor(0);

  pdf.setLineWidth(0.6); pdf.rect(bx, by, bw, bh);                          // outer border
  pdf.setLineWidth(0.25); pdf.line(tx - GUTTER_MM, by, tx - GUTTER_MM, by + bh);   // drawing / title split

  // ---- title block (bottom of the right column)
  const rows = roomSchedule(floor);
  const rowH = 5.2, headH = 6;
  const tbH = 34;
  const tbY = by + bh - tbH;
  pdf.setLineWidth(0.25);
  pdf.line(tx, tbY, tx + TITLE_W_MM, tbY);
  for (let k = 1; k <= 3; k++) pdf.line(tx, tbY + k * 7, tx + TITLE_W_MM, tbY + k * 7);

  const title = `${floor.name} 平面配置圖`;
  pdf.addImage(textTile([
    { x: 2, y: 5.0, text: c.name || '未命名平面圖', size: 3.6, bold: true },
    { x: 2, y: 12.0, text: `圖名　${title}`, size: 3.0 },
    { x: 2, y: 19.0, text: `比例　1:${sheet.scale}　(${sheet.paper})`, size: 3.0 },
    { x: 2, y: 26.0, text: `日期　${c.dateStr}`, size: 3.0 },
    { x: TITLE_W_MM - 2, y: 26.0, text: `${c.pageNo}/${c.pageCount}`, size: 3.0, align: 'right' },
  ], TITLE_W_MM, tbH), 'PNG', tx, tbY, TITLE_W_MM, tbH);

  // ---- room schedule (above the title block)
  if (rows.length) {
    const schedH = headH + rows.length * rowH + rowH;      // header + rows + total
    const sy = tbY - 4 - schedH;
    pdf.setLineWidth(0.25);
    pdf.rect(tx, sy, TITLE_W_MM, schedH);
    pdf.line(tx, sy + headH, tx + TITLE_W_MM, sy + headH);
    pdf.line(tx, sy + schedH - rowH, tx + TITLE_W_MM, sy + schedH - rowH);

    const items: TextItem[] = [
      { x: 2, y: headH - 1.8, text: '房間', size: 3.0, bold: true },
      { x: TITLE_W_MM - 20, y: headH - 1.8, text: 'm²', size: 3.0, bold: true, align: 'right' },
      { x: TITLE_W_MM - 2, y: headH - 1.8, text: '坪', size: 3.0, bold: true, align: 'right' },
    ];
    let total = 0;
    rows.forEach((r, i) => {
      const y = headH + (i + 1) * rowH - 1.6;
      total += r.m2;
      items.push({ x: 2, y, text: r.name, size: 2.9 });
      items.push({ x: TITLE_W_MM - 20, y, text: r.m2.toFixed(2), size: 2.9, align: 'right' });
      items.push({ x: TITLE_W_MM - 2, y, text: r.ping.toFixed(2), size: 2.9, align: 'right' });
    });
    const ty = schedH - 1.6;
    items.push({ x: 2, y: ty, text: '合計', size: 2.9, bold: true });
    items.push({ x: TITLE_W_MM - 20, y: ty, text: total.toFixed(2), size: 2.9, bold: true, align: 'right' });
    items.push({ x: TITLE_W_MM - 2, y: ty, text: (total / 3.30579).toFixed(2), size: 2.9, bold: true, align: 'right' });
    pdf.addImage(textTile(items, TITLE_W_MM, schedH), 'PNG', tx, sy, TITLE_W_MM, schedH);
  }

  // ---- graphic scale bar, bottom-left inside the drawing area
  const metres = scaleBarMetres(sheet.scale, Math.min(50, sheet.drawAreaMM.w / 3));
  const barMM = metres * 1000 / sheet.scale;
  const barY = dy + sheet.drawAreaMM.h - 6;
  const seg = barMM / 4;
  pdf.setLineWidth(0.2);
  for (let k = 0; k < 4; k++) {
    if (k % 2 === 0) { pdf.setFillColor(0, 0, 0); pdf.rect(dx + k * seg, barY, seg, 1.4, 'FD'); }
    else pdf.rect(dx + k * seg, barY, seg, 1.4);
  }
  pdf.addImage(textTile([
    { x: 0, y: 3.0, text: '0', size: 2.8 },
    { x: barMM, y: 3.0, text: `${metres} m`, size: 2.8, align: 'center' },
  ], barMM + 12, 4), 'PNG', dx, barY + 1.8, barMM + 12, 4);
}
