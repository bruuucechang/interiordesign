import { Doc } from '../model/doc';
import { saveProject } from '../net/api';

// Saving is debounced rather than periodic, so edits reach the backend almost
// immediately (mirrored to localStorage too). A slow heartbeat retries whatever
// is still unsaved — e.g. after an offline blip — and a beforeunload flush
// catches the last few edits. `lastSaved` skips writes when nothing actually
// changed, such as a selection-only change.
//
// The three pieces of state below are the reason this is its own module: they
// are meaningless outside it, and nothing else should be able to touch them.

const SAVE_DEBOUNCE_MS = 700;
const AUTOSAVE_MS = 20_000;      // fallback heartbeat / offline retry

let dirty = false;
let lastSaved = '';
let saveTimer: number | undefined;

function setSaveStatus(state: 'saving' | 'saved' | 'offline') {
  const el = document.querySelector('#saveStatus'); if (!el) return;
  el.className = 'save-status ' + state;
  el.textContent = state === 'saving' ? '儲存中…'
    : state === 'offline' ? '離線・已暫存本機'
    : '已儲存 ✓';
}

/** Mark the document as having unsaved changes without scheduling a write. */
export function markDirty() { dirty = true; }

/**
 * Treat `json` as already stored — used after loading or importing a project,
 * so the first autosave does not rewrite what was just read.
 */
export function setSaveBaseline(json: string) { lastSaved = json; }

/** Returns whether the stored copy is now up to date — the report export needs to know. */
export async function flushSave(doc: Doc): Promise<boolean> {
  if (!dirty) return true;
  dirty = false;
  const p = doc.serialize();
  const json = JSON.stringify(p);
  if (json === lastSaved) { setSaveStatus('saved'); return true; }   // nothing meaningful changed
  const ok = await saveProject(p);
  if (ok) { lastSaved = json; setSaveStatus('saved'); }
  else { dirty = true; setSaveStatus('offline'); }                  // heartbeat will retry
  return ok;
}

export function scheduleAutosave(doc: Doc) {
  dirty = true;
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => flushSave(doc), SAVE_DEBOUNCE_MS);
}

export function startAutosave(doc: Doc) {
  window.setInterval(() => { if (dirty) flushSave(doc); }, AUTOSAVE_MS);
  window.addEventListener('beforeunload', () => { if (dirty) saveProject(doc.serialize()); });
}
