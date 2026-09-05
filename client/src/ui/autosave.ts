import { t } from '../core/i18n';
import { Doc, isBlankPlan } from '../model/doc';
import { saveProject, syncPending } from '../net/api';

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

/**
 * What the indicator says, and the rule it has to obey.
 *
 * **「已儲存」may only be set by a response from the server.** Not by "I sent
 * it", not by "no error was thrown near me". This project has already shipped
 * the other version once: the backend answered 200 with a body of the wrong
 * shape, every heartbeat threw, offline edits were never pushed — and the
 * indicator read 已儲存 the whole time.
 *
 * `stuck` is the state that was missing. A plan the mirror cannot push is not
 * "offline" — the backend is answering fine, this particular plan just never
 * lands — and it is not "saved" either. Without a name of its own it was
 * reported as one or the other, both of which are lies.
 */
type SaveState = 'saving' | 'saved' | 'offline' | 'stuck' | 'idle';

let stuckCount = 0;

function setSaveStatus(state: SaveState, detail?: string) {
  const el = document.querySelector('#saveStatus') as HTMLElement | null; if (!el) return;
  el.className = 'save-status ' + state;
  el.textContent = state === 'idle' ? ''
    : state === 'saving' ? t('儲存中…')
    : state === 'offline' ? t('離線・已暫存本機')
    : state === 'stuck' ? `${stuckCount} 份同步失敗`
    : t('已儲存 ✓');
  el.title = detail ?? (
    state === 'stuck'
      ? '這幾份存在本機但送不上伺服器。點一下重試；仍然失敗的話用「匯出專案檔」把它們留下來。'
      : state === 'offline' ? '連不上伺服器，改動先留在這台機器上，連上就會自動送出。'
      : '');
}

/** Report a finished sync round. Only this and `flushSave` may say 已儲存. */
export function reportSync(r: { failed: string[]; offline?: boolean }) {
  stuckCount = r.failed.length;
  if (stuckCount > 0) setSaveStatus('stuck');
  else if (r.offline) setSaveStatus('offline');
  else if (!dirty) setSaveStatus('saved');
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
  // An untouched blank plan is not work, and filing it as one is how the list
  // grew 150 rows called 未命名平面圖. `lastSaved` is empty only for a document
  // that has never been loaded from anywhere or saved — so a real plan that the
  // user has emptied still saves, which is the case this must not break.
  if (lastSaved === '' && isBlankPlan(p)) { setSaveStatus('idle'); return true; }
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
  // `dirty` only lives as long as the tab. Anything saved offline and then
  // closed is remembered by the mirror instead, which is what syncPending
  // reads — so the heartbeat retries work from previous sessions too, not just
  // this one's.
  void syncPending().then(reportSync);
  window.setInterval(() => {
    if (dirty) flushSave(doc);
    else void syncPending().then(reportSync);
  }, AUTOSAVE_MS);
  // Clicking the indicator retries. A status that names a problem and offers no
  // way to act on it just moves the helplessness somewhere visible.
  document.querySelector('#saveStatus')?.addEventListener('click', () => {
    setSaveStatus('saving');
    void syncPending().then(reportSync);
  });
  window.addEventListener('beforeunload', () => { if (dirty) saveProject(doc.serialize()); });
}
