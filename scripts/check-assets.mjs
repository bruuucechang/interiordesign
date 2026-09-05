// Did the 3D models actually make it into the build?
//
//   node scripts/check-assets.mjs [dir]      # default: client/dist
//
// This exists because the failure is **silent**. `client/public/models/` is 63 MB
// and gitignored, so a build from a clean clone ships without it — and the app
// starts fine, draws fine, and never logs an error. `loadFurnitureModel` just
// returns false for every item and falls back to hand-built geometry, which
// exists for only ~55 of the 224 items. The other two thirds render as
// featureless blocks.
//
// Nobody would report that as a bug. It looks like the app was designed that
// way. And the person who packaged it cannot see the problem, because on the
// author's own machine `models/` is always there — the build only breaks for
// somebody else. That is the worst shape a defect can have, so it gets a gate
// rather than a note in a README.
//
// Exits 1 with an explanation of which command to run. Never "fixes" anything:
// fetching 63 MB is not something a check should do behind your back.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'client/dist';
const models = join(dir, 'models');

/** 224 today. A floor well under that means a partial or interrupted fetch. */
const EXPECTED = 200;

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  console.error('  先抓素材再建置：');
  console.error('    macOS/Linux   .venv/bin/python scripts/fetch_models.py   （四支都要，或 npm run assets）');
  console.error('    Windows       .venv\\Scripts\\python scripts\\fetch_models.py');
  console.error('\n  不抓的話 app 還是會動，但 224 件家具裡只有約 55 件有手寫幾何，');
  console.error('  其餘會渲成無特徵方塊——而且不會有任何錯誤訊息。\n');
  process.exit(1);
}

if (!existsSync(dir)) fail(`找不到 ${dir}／前端還沒建置`);
if (!existsSync(models)) fail(`${models} 不存在——這份建置沒有 3D 模型`);
if (!existsSync(join(models, 'manifest.json'))) fail(`${models} 少了 manifest.json`);

const dirs = readdirSync(models).filter((n) => statSync(join(models, n)).isDirectory());
if (dirs.length < EXPECTED) fail(`只有 ${dirs.length} 件模型，預期 ${EXPECTED} 件以上——素材抓到一半`);

// Textures are in the repo, so this one is a tripwire for a broken build rather
// than a missing download step. Every surface uses them; without them the whole
// scene is flat colour.
const tex = join(dir, 'textures');
if (!existsSync(tex)) fail(`${tex} 不存在——貼圖在 repo 裡，這代表建置壞了而不是少下載`);

console.log(`素材檢查：${dirs.length} 件模型、貼圖在位 ✓`);
