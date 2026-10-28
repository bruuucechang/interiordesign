// The translucent previews shown while placing: a furniture piece following the
// cursor on the floor, and a door/window snapped onto the wall under it. Editing
// aids, not part of the design — they live in the scene but outside the groups
// that are built, exported and cut away.
import * as THREE from 'three';
import { buildDoor3D, buildWindow3D } from './openings3d';
import { getFurnitureModel } from './furniture3d';
import { ghostify } from './surfaces3d';

export type OpeningGhostSpec = { kind: 'door' | 'window'; x: number; y: number; angle: number; width: number };

export class PlacementGhosts {
  private previewItem: { id: string; w: number; h: number } | null = null;  // furniture to ghost while placing
  private ghost: THREE.Object3D | null = null;
  private openingGhost: THREE.Object3D | null = null;
  private openingGhostKey = '';
  private warn = false;

  constructor(private scene: THREE.Scene) {}

  /** A furniture placement is armed. */
  get placing() { return !!this.previewItem; }

  /** Put the furniture ghost on the floor at plan point p, building it on first use. */
  moveFurniture(p: { x: number; y: number }) {
    const g = this.ghost ?? this.buildGhost();
    if (g) { g.visible = true; g.position.set(p.x, 0, p.y); }
  }

  /** Red where the piece would not sit well (B22). Applied to the ghost as it is now and to any rebuilt one. */
  setWarn(on: boolean) {
    if (on === this.warn) return;
    this.warn = on;
    if (this.ghost) tint(this.ghost, on);
  }

  /** The cursor left the view. */
  hide() {
    if (this.ghost) this.ghost.visible = false;
    if (this.openingGhost) this.openingGhost.visible = false;
  }

  /** Both ghosts, for hiding around a capture. */
  objects(): (THREE.Object3D | null)[] { return [this.ghost, this.openingGhost]; }

  // Arm/disarm the placement ghost. Pass the furniture item (id + size) to show
  // a translucent preview that follows the cursor, or null to remove it.
  setPlacementPreview(item: { id: string; w: number; h: number } | null) {
    const same = item && this.previewItem && item.id === this.previewItem.id && item.w === this.previewItem.w && item.h === this.previewItem.h;
    this.previewItem = item;
    if (!item || !same) this.clearGhost();   // rebuilt for the new item on the next hover
  }

  private buildGhost(): THREE.Object3D | null {
    if (!this.previewItem) return null;
    const g = getFurnitureModel(this.previewItem.id, this.previewItem.w, this.previewItem.h).clone(true);
    ghostify(g);   // shared cloned geometry — only the materials are cloned
    if (this.warn) tint(g, true);
    this.scene.add(g);
    this.ghost = g;
    return g;
  }

  /**
   * Rebuild the placement ghost in place.
   *
   * The ghost is built once per item and kept until the item changes, so a model
   * that lands afterwards leaves the preview showing the built stand-in — and
   * then the piece changes shape the instant it is dropped, which is the one
   * thing a preview exists to prevent. Called when a model finishes loading.
   */
  refreshGhost() {
    if (!this.ghost || !this.previewItem) return;
    const pos = this.ghost.position.clone();
    const rot = this.ghost.rotation.clone();
    const vis = this.ghost.visible;
    this.clearGhost();
    const g = this.buildGhost();
    if (!g) return;
    g.position.copy(pos); g.rotation.copy(rot); g.visible = vis;
  }

  private clearGhost() {
    if (!this.ghost) return;
    this.ghost.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => mm.dispose()); });
    this.scene.remove(this.ghost);
    this.ghost = null;
  }

  // Show/move a translucent door/window ghost snapped onto a wall. `spec` comes
  // from the app (it does the wall snapping); null hides it. Geometry is rebuilt
  // only when the kind/width changes — otherwise just repositioned.
  setOpeningGhost(spec: OpeningGhostSpec | null) {
    if (!spec) { if (this.openingGhost) this.openingGhost.visible = false; return; }
    const key = `${spec.kind}_${Math.round(spec.width)}`;
    if (this.openingGhostKey !== key) {
      this.clearOpeningGhost();
      const g = spec.kind === 'door' ? buildDoor3D(spec.width, 210, 0) : buildWindow3D(spec.width, 100, 90);
      ghostify(g);
      this.scene.add(g);
      this.openingGhost = g; this.openingGhostKey = key;
    }
    this.openingGhost!.position.set(spec.x, 0, spec.y);
    this.openingGhost!.rotation.y = -spec.angle * Math.PI / 180;
    this.openingGhost!.visible = true;
  }

  private clearOpeningGhost() {
    if (!this.openingGhost) return;
    this.openingGhost.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry?.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(mm => mm.dispose()); } });
    this.scene.remove(this.openingGhost);
    this.openingGhost = null; this.openingGhostKey = '';
  }
}

/** Glow the ghost's (already cloned) materials red, or back to none. */
function tint(g: THREE.Object3D, on: boolean) {
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) {
      const sm = mm as THREE.MeshStandardMaterial;
      if (!sm.emissive) continue;
      // remember the model's own glow (a lamp shade has one) so turning red off restores it
      sm.userData.ownEmissive ??= { color: sm.emissive.getHex(), k: sm.emissiveIntensity };
      const own = sm.userData.ownEmissive as { color: number; k: number };
      sm.emissive.set(on ? 0xff3344 : own.color);
      sm.emissiveIntensity = on ? 0.7 : own.k;
    }
  });
}
