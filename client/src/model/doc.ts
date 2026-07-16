import { Project, Obj, Layer, LayerId, defaultLayers } from './types';

let counter = 0;
export function genId(prefix = 'o'): string {
  counter++;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

// The editor document: project data + selection + undo/redo history.
export class Doc {
  project: Project;
  selectedIds: string[] = [];
  activeLayer: LayerId = 'walls';

  // primary selection (last picked) — used where a single object is expected
  get selectedId(): string | null { return this.selectedIds.length ? this.selectedIds[this.selectedIds.length - 1] : null; }
  // the object only when exactly one is selected (handles, single-object property panel)
  get selected(): Obj | undefined { return this.selectedIds.length === 1 ? this.get(this.selectedIds[0]) : undefined; }
  get selectedObjects(): Obj[] { const r: Obj[] = []; for (const id of this.selectedIds) { const o = this.get(id); if (o) r.push(o); } return r; }
  isSelected(id: string): boolean { return this.selectedIds.includes(id); }

  private past: string[] = [];
  private future: string[] = [];
  private listeners = new Set<() => void>();

  constructor(project?: Project) {
    this.project = project ?? Doc.blank();
  }

  static blank(): Project {
    return { id: genId('proj'), name: '未命名平面圖', layers: defaultLayers(), objects: [] };
  }

  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(fn => fn()); }

  // ---- history ----
  private snapshot(): string {
    return JSON.stringify({ layers: this.project.layers, objects: this.project.objects });
  }
  commit() { // call before a mutation batch to save the current state
    this.past.push(this.snapshot());
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  private restore(json: string) {
    const s = JSON.parse(json);
    this.project.layers = s.layers;
    this.project.objects = s.objects;
    this.selectedIds = this.selectedIds.filter(id => this.get(id));
  }
  undo() {
    if (!this.past.length) return;
    this.future.push(this.snapshot());
    this.restore(this.past.pop()!);
    this.emit();
  }
  redo() {
    if (!this.future.length) return;
    this.past.push(this.snapshot());
    this.restore(this.future.pop()!);
    this.emit();
  }

  // ---- objects ----
  get objects() { return this.project.objects; }
  get(id: string | null): Obj | undefined { return this.project.objects.find(o => o.id === id); }
  add(obj: Obj) { this.project.objects.push(obj); this.emit(); }
  remove(id: string) {
    this.project.objects = this.project.objects.filter(o => o.id !== id);
    this.selectedIds = this.selectedIds.filter(x => x !== id);
    this.emit();
  }
  update(id: string, patch: Partial<Obj>) {
    const o = this.get(id);
    if (!o) return;
    Object.assign(o, patch);
    this.emit();
  }
  select(id: string | null) { this.selectedIds = id ? [id] : []; this.emit(); }
  selectMany(ids: string[]) { this.selectedIds = Array.from(new Set(ids)); this.emit(); }

  // ---- layers ----
  layer(id: LayerId): Layer | undefined { return this.project.layers.find(l => l.id === id); }
  isLayerVisible(id: LayerId) { return this.layer(id)?.visible ?? true; }
  isLayerLocked(id: LayerId) { return this.layer(id)?.locked ?? false; }
  toggleLayerVisible(id: LayerId) { const l = this.layer(id); if (l) { l.visible = !l.visible; this.emit(); } }
  toggleLayerLock(id: LayerId) { const l = this.layer(id); if (l) { l.locked = !l.locked; this.emit(); } }
  moveLayer(id: LayerId, dir: -1 | 1) {
    const ls = this.project.layers;
    const i = ls.findIndex(l => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ls.length) return;
    [ls[i], ls[j]] = [ls[j], ls[i]];
    this.emit();
  }

  // ---- serialize ----
  serialize(): Project { return this.project; }
  load(project: Project) {
    this.project = project;
    if (!this.project.layers?.length) this.project.layers = defaultLayers();
    this.selectedIds = [];
    this.past = []; this.future = [];
    this.emit();
  }
}
