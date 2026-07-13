import { Vec } from '../model/types';

// Maps world coordinates (cm) to screen pixels. scale = pixels per cm.
export class Viewport {
  scale = 0.4;          // px per cm (start ~ fits a house)
  origin: Vec = { x: 0, y: 0 }; // world cm at screen (0,0)
  width = 0; height = 0; dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {}

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = rect.width; this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  toScreen(w: Vec): Vec {
    return { x: (w.x - this.origin.x) * this.scale, y: (w.y - this.origin.y) * this.scale };
  }
  toWorld(s: Vec): Vec {
    return { x: s.x / this.scale + this.origin.x, y: s.y / this.scale + this.origin.y };
  }

  panBy(dxScreen: number, dyScreen: number) {
    this.origin.x -= dxScreen / this.scale;
    this.origin.y -= dyScreen / this.scale;
  }

  zoomAt(screen: Vec, factor: number) {
    const before = this.toWorld(screen);
    this.scale = Math.max(0.05, Math.min(6, this.scale * factor));
    const after = this.toWorld(screen);
    this.origin.x += before.x - after.x;
    this.origin.y += before.y - after.y;
  }

  // center the view on a world rect
  centerOn(x: number, y: number, w: number, h: number) {
    this.origin.x = x + w / 2 - this.width / 2 / this.scale;
    this.origin.y = y + h / 2 - this.height / 2 / this.scale;
  }
}
