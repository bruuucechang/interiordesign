import { Doc } from '../model/doc';
import { Viewport } from '../core/viewport';
import { Vec } from '../model/types';

export interface PointerInfo {
  world: Vec;    // raw world (cm)
  snapped: Vec;  // grid-snapped world (cm) if snapping on, else world
  screen: Vec;   // css px
  shift: boolean;
  alt: boolean;
}

export type DrawFn = (ctx: CanvasRenderingContext2D) => void;

export interface ToolCtx {
  doc: Doc;
  vp: Viewport;
  snapEnabled: boolean;
  gridSize: number;
  currentFurniture: string;
  render(): void;
  setPreview(world?: DrawFn, screen?: DrawFn): void;
  setHint(s: string): void;
  selectTool(name: string): void;
}

export interface Tool {
  name: string;
  cursor: string;
  hint: string;
  onDown(p: PointerInfo): void;
  onMove(p: PointerInfo): void;
  onUp(p: PointerInfo): void;
  onKey?(e: KeyboardEvent): void;
  deactivate?(): void;
}
