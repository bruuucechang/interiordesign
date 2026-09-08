// 空間健檢的介面。
//
// **它永遠不會自己跳出來。** 這一整輪的起點就是使用者說「instruction 有時候會在
// 奇怪時機跳出來」，所以健檢的全部存在感就是工具列上那顆帶數字的按鈕：想看的時候
// 點它，不想看的時候它就只是一個數字。描圖描到一半有十幾條提醒是正常的，不是需要
// 被攔下來的事。
//
// 面板不是 `.modal`：沒有遮罩、不擋畫布。點一列會選取那個物件並把畫面帶過去，而
// 那件事在一個蓋住畫布的對話框裡做完全沒有意義。

import { Editor } from '../core/editor';
import { Doc } from '../model/doc';
import { Finding, checkPlan, visible } from '../core/health';
import { CLEARANCE, DEFAULTS } from '../model/locale-defaults';
import { bounds } from '../core/hit';
import { t } from '../core/i18n';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/**
 * 忽略清單存在 localStorage，不進存檔。
 *
 * 「我看過了，我不同意」是一個人的判斷，不是這張圖的性質——把它寫進 `Project` 就
 * 要動 schemaVersion、codegen 與回填，為了一份建議清單的靜音狀態，那個代價不對。
 * 代價是它不會跟著 `.floorplan.json` 走：換一台機器開同一份圖，忽略過的會再出現
 * 一次。對一份「建議」來說，重新看一遍是可以接受的失敗方向。
 */
const IGNORE_KEY = 'interior_health_ignored';

function ignoredFor(planId: string): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(IGNORE_KEY) || '{}');
    return new Set<string>(Array.isArray(all[planId]) ? all[planId] : []);
  } catch { return new Set(); }
}

function setIgnored(planId: string, ids: Set<string>) {
  try {
    const all = JSON.parse(localStorage.getItem(IGNORE_KEY) || '{}');
    all[planId] = [...ids];
    localStorage.setItem(IGNORE_KEY, JSON.stringify(all));
  } catch { /* storage off — 靜音狀態記不住不該擋住使用 */ }
}

let findings: Finding[] = [];
let open = false;

/** 重算並更新按鈕上的數字。文件一變就呼叫，但實際運算是防抖的。 */
let timer: number | undefined;
export function scheduleHealth(editor: Editor, doc: Doc) {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    findings = visible(checkPlan(doc.objects), ignoredFor(doc.project.id));
    paintBadge();
    if (open) render(editor, doc);
  }, 250);
}

function paintBadge() {
  const b = document.querySelector('[data-act="health"]') as HTMLElement | null;
  if (!b) return;
  const chip = b.querySelector('.health-count') as HTMLElement | null;
  if (!chip) return;
  chip.textContent = String(findings.length);
  chip.classList.toggle('none', findings.length === 0);
  b.title = findings.length
    ? `空間健檢：${findings.length} 項提醒`
    : '空間健檢：目前沒有提醒';
}

function row(f: Finding, editor: Editor, doc: Doc): HTMLElement {
  const el = document.createElement('div');
  el.className = 'hf ' + f.severity;

  const head = document.createElement('div'); head.className = 'hf-head';
  const title = document.createElement('b'); title.textContent = f.title;
  head.appendChild(title);
  el.appendChild(head);

  const detail = document.createElement('div'); detail.className = 'hf-detail'; detail.textContent = f.detail;
  const why = document.createElement('div'); why.className = 'hf-why'; why.textContent = f.why;
  el.append(detail, why);

  const acts = document.createElement('div'); acts.className = 'hf-acts';

  // 指過去。整列可點，但也放一顆明講的按鈕——「這一列可以點」不是每個人都會試。
  const go = document.createElement('button'); go.className = 'hf-btn'; go.textContent = t('指給我看');
  const focus = () => {
    doc.selectMany(f.targets);
    const objs = doc.selectedObjects;
    if (!objs.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of objs) {
      const b = bounds(o);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    editor.vp.centerOn((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, 200) * 3, Math.max(y1 - y0, 200) * 3);
    editor.render();
  };
  go.onclick = (e) => { e.stopPropagation(); focus(); };
  el.onclick = focus;
  acts.appendChild(go);

  if (f.fix) {
    const fix = document.createElement('button'); fix.className = 'hf-btn primary'; fix.textContent = t('接上');
    fix.onclick = (e) => {
      e.stopPropagation();
      applyFix(f, doc);
      scheduleHealth(editor, doc);
    };
    acts.appendChild(fix);
  }

  const skip = document.createElement('button'); skip.className = 'hf-btn muted'; skip.textContent = t('忽略這一條');
  skip.onclick = (e) => {
    e.stopPropagation();
    const set = ignoredFor(doc.project.id);
    set.add(f.id);
    setIgnored(doc.project.id, set);
    scheduleHealth(editor, doc);
  };
  acts.appendChild(skip);

  el.appendChild(acts);
  return el;
}

function applyFix(f: Finding, doc: Doc) {
  if (!f.fix) return;
  if (f.fix.kind === 'joinWall') {
    const { wallId, end, to } = f.fix;
    doc.commit();
    doc.update(wallId, { [end]: { x: to.x, y: to.y } } as any);
  }
}

function render(editor: Editor, doc: Doc) {
  const body = $('#healthBody');
  body.innerHTML = '';

  if (!findings.length) {
    const ok = document.createElement('div'); ok.className = 'hf-empty';
    ok.textContent = doc.objects.length
      ? t('目前沒有提醒。')
      : t('還沒有東西可以檢查——先畫幾道牆。');
    body.appendChild(ok);
  } else {
    for (const f of findings) body.appendChild(row(f, editor, doc));
  }

  // 數字是哪來的，就寫在清單下面。使用者對「70cm」有意見的時候，唯一有用的資訊是
  // 「這是誰的 70」——這跟牆厚 12cm 那個 tooltip 是同一條規則（design-rules 9.5.4）。
  const note = document.createElement('div'); note.className = 'hf-note';
  note.textContent = `淨距用的是「${DEFAULTS.region}」的一般值：床邊 ${CLEARANCE.bedSide}、`
    + `餐桌 ${CLEARANCE.diningPullOut}、馬桶側 ${CLEARANCE.toiletSide}、洗手台前 ${CLEARANCE.basinFront} 公分。`
    + '這些是常見的人因尺寸，不是法規；覺得不合你的案子，忽略那一條就好。';
  body.appendChild(note);

  const ignored = ignoredFor(doc.project.id);
  if (ignored.size) {
    const undo = document.createElement('button');
    undo.className = 'hf-btn muted'; undo.style.marginTop = '8px';
    undo.textContent = `${t('把忽略過的')} ${ignored.size} ${t('條叫回來')}`;
    undo.onclick = () => { setIgnored(doc.project.id, new Set()); scheduleHealth(editor, doc); };
    body.appendChild(undo);
  }
}

export function openHealth(editor: Editor, doc: Doc) {
  open = true;
  findings = visible(checkPlan(doc.objects), ignoredFor(doc.project.id));
  paintBadge();
  render(editor, doc);
  $('#healthPanel').classList.remove('hidden');
}

function close() { open = false; $('#healthPanel').classList.add('hidden'); }

export function toggleHealth(editor: Editor, doc: Doc) {
  if (open) close(); else openHealth(editor, doc);
}

export function wireHealth(editor: Editor, doc: Doc) {
  $('[data-act="close-health"]').addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); e.preventDefault(); close(); }
  }, true);
  scheduleHealth(editor, doc);
}
