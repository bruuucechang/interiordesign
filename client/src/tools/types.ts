import { Reference } from '../core/wallEdit';
import { Doc } from '../model/doc';
import { Viewport } from '../core/viewport';
import { Vec } from '../model/schema';

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
  wallRef: Reference;
  cycleWallRef(): void;
  gridSize: number;
  currentFurniture: string;
  currentElectrical: string;
  render(): void;
  setPreview(world?: DrawFn, screen?: DrawFn): void;
  setHint(s: string): void;
  selectTool(name: string): void;
  /** Report the outcome of a scale calibration; `ok` advances the step strip. */
  onCalibrated?(message: string, ok?: boolean): void;
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
