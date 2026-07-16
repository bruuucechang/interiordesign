import { Project, Obj, Layer, LayerId, Floor, defaultLayers } from './types';

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
    this.normalize();
  }

  static blank(): Project {
    const floor: Floor = { id: genId('floor'), name: '1F', elevation: 0, height: 280, objects: [] };
    return { id: genId('proj'), name: '未命名平面圖', layers: defaultLayers(), floors: [floor], activeFloorId: floor.id };
  }

  // migrate older single-list projects into the floors model
  private normalize() {
    const p = this.project as any;
    if (!p.layers?.length) p.layers = defaultLayers();
    if (!Array.isArray(p.floors) || !p.floors.length) {
      const floor: Floor = { id: genId('floor'), name: '1F', elevation: 0, height: 280, objects: p.objects ?? [] };
      p.floors = [floor];
      p.activeFloorId = floor.id;
    }
    delete p.objects;
    if (!p.floors.find((f: Floor) => f.id === p.activeFloorId)) p.activeFloorId = p.floors[0].id;
  }

  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(fn => fn()); }

  // ---- floors ----
  get floors(): Floor[] { return this.project.floors; }
  get activeFloor(): Floor { return this.project.floors.find(f => f.id === this.project.activeFloorId) ?? this.project.floors[0]; }
  setActiveFloor(id: string) { if (this.project.floors.some(f => f.id === id)) { this.project.activeFloorId = id; this.selectedIds = []; this.emit(); } }
  addFloor() {
    this.commit();
    const top = this.project.floors.reduce((m, f) => Math.max(m, f.elevation + f.height), 0);
    const floor: Floor = { id: genId('floor'), name: `${this.project.floors.length + 1}F`, elevation: top, height: 280, objects: [] };
    this.project.floors.push(floor);
    this.project.activeFloorId = floor.id;
    this.selectedIds = [];
    this.emit();
  }
  removeFloor(id: string) {
    if (this.project.floors.length <= 1) return;
    this.commit();
    this.project.floors = this.project.floors.filter(f => f.id !== id);
    if (this.project.activeFloorId === id) this.project.activeFloorId = this.project.floors[0].id;
    this.selectedIds = [];
    this.emit();
  }
  renameFloor(id: string, name: string) { const f = this.project.floors.find(f => f.id === id); if (f) { f.name = name; this.emit(); } }
  setFloorElevation(id: string, elevation: number) { const f = this.project.floors.find(f => f.id === id); if (f) { f.elevation = elevation; this.emit(); } }

  // ---- history ----
  private snapshot(): string {
    return JSON.stringify({ layers: this.project.layers, floors: this.project.floors, activeFloorId: this.project.activeFloorId });
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  commit() { // call before a mutation batch to save the current state
    this.past.push(this.snapshot());
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  private restore(json: string) {
    const s = JSON.parse(json);
    this.project.layers = s.layers;
    this.project.floors = s.floors;
    this.project.activeFloorId = s.activeFloorId;
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

  // ---- objects (scoped to the active floor) ----
  get objects() { return this.activeFloor.objects; }
  get(id: string | null): Obj | undefined { return this.activeFloor.objects.find(o => o.id === id); }
  add(obj: Obj) { this.activeFloor.objects.push(obj); this.emit(); }
  remove(id: string) {
    const f = this.activeFloor;
    f.objects = f.objects.filter(o => o.id !== id);
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
    this.normalize();   // migrate older single-list projects into floors
    this.selectedIds = [];
    this.past = []; this.future = [];
    this.emit();
  }
}
