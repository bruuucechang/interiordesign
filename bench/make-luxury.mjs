// B31：從 A1（plan1151022）另存「A1 豪宅版」（plan1151022lx）。
//
//   npx tsx bench/make-luxury.mjs [http://localhost:8791] [--dry-run]     # 要先 npm run dev（後端）
//
// 只讀 A1（GET），只寫豪宅版（PUT 到另一個 id）。可以重跑：豪宅版已存在就整份覆寫。
// 寫之前先用健檢自己的函式驗一次：照明提醒不是 0 就不寫、結束碼 1。
// 換了什麼、為什麼在 client/src/data/luxuryPlan.ts。
//
// 2026-10-29 使用者裁示 A1 改成豪宅版（A1 本身已經是 makeLuxury 的結果，原版備份在 ~/.interior-designer-backups/）。
// 再從 A1 產生會把燈和傢俱疊兩次，所以 A1 裡已經有 lx_ 開頭的物件就拒跑。
import { makeLuxury, LUXURY_ID, SOURCE_ID } from '../client/src/data/luxuryPlan.ts';
import { lightingFindings } from '../client/src/core/lightcheck.ts';

const API = (process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'http://localhost:8791') + '/api';
const DRY = process.argv.includes('--dry-run');
const OWNER = 'own_orsxp52fbvey';
const H = { 'X-Owner': OWNER, 'Content-Type': 'application/json' };

if (LUXURY_ID === SOURCE_ID) throw new Error('豪宅版的 id 不能跟 A1 一樣');
const get = async (id) => {
  const r = await fetch(`${API}/projects/${id}`, { headers: H });
  return r.ok ? r.json() : null;
};

const a1 = await get(SOURCE_ID);
if (!a1) { console.error(`讀不到 ${SOURCE_ID}`); process.exit(1); }
if (a1.data.floors.some(fl => fl.objects.some(o => String(o.id).startsWith('lx_')))) {
  console.error(`${SOURCE_ID} 已經是豪宅版（有 lx_ 物件），再產生會疊兩次；要重做請先用 ~/.interior-designer-backups/ 的原版還原 A1`);
  process.exit(1);
}
const before = JSON.stringify(a1.data);
const lx = makeLuxury(a1.data);

let bad = 0;
for (const fl of lx.floors) {
  const f = lightingFindings(fl.objects, fl.height);
  const rooms = new Map(fl.objects.filter(o => o.kind === 'room').map(o => [o.id, o.name]));
  for (const x of f) console.log(`  ✘ ${rooms.get(x.room) ?? '—'}：${x.title}（${x.detail}）`);
  bad += f.length;
  const count = (k, re) => fl.objects.filter(o => o.kind === k && re.test(o.item ?? '')).length;
  console.log(`${fl.name}：${fl.objects.length} 件，燈 ${count('electrical', /./)} 盞，傢俱 ${count('furniture', /./)} 件，照明提醒 ${f.length}`);
}
if (JSON.stringify(a1.data) !== before) { console.error('makeLuxury 改到了 A1 的資料'); process.exit(1); }
if (bad) { console.error('照明提醒不是 0，不寫'); process.exit(1); }
if (DRY) { console.log('--dry-run：不寫'); process.exit(0); }

const r = await fetch(`${API}/projects/${LUXURY_ID}`, { method: 'PUT', headers: H, body: JSON.stringify({ name: lx.name, data: lx }) });
if (!r.ok) { console.error(`寫入失敗 ${r.status} ${await r.text()}`); process.exit(1); }
const after = await get(SOURCE_ID);
if (JSON.stringify(after?.data) !== before || after.updatedAtIso !== a1.updatedAtIso) { console.error('A1 被動到了'); process.exit(1); }
const deleted = await fetch(`${API}/projects-deleted`, { headers: H }).then(r => r.json());
if (deleted.projects?.some(p => p.id === LUXURY_ID)) console.warn(`注意：${LUXURY_ID} 在回收桶裡，要先在 App 裡還原才看得到`);
console.log(`已寫入 ${LUXURY_ID}「${lx.name}」；A1 沒變（${after.updatedAtIso}）`);
