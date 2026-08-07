#!/usr/bin/env node
//
// Turns the editor's document schema into definitions the backend can read.
//
//   client/src/model/schema.ts  ->  schema/plan.schema.json  ->  server/app/plan_schema.py
//
// The client owns the schema and evolves it freely; the backend used to keep up
// by guessing at dictionary keys, which meant a renamed field broke report.py
// silently. Generating the Python from the TypeScript makes that a type error
// instead.
//
//   npm run codegen         regenerate both artefacts
//   npm run codegen:check   fail if the committed artefacts are stale
//
// Both artefacts are committed, so a reader can see them without a toolchain,
// and `npm test` runs the check — this repo has no CI, so a stale artefact has
// to fail where the failure is actually noticed.
//
// Timestamps are disabled in the generated Python: a header that changes on
// every run would make the staleness diff meaningless.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const SCHEMA_TS = join(root, 'client/src/model/schema.ts');
const SCHEMA_JSON = join(root, 'schema/plan.schema.json');
const PLAN_PY = join(root, 'server/app/plan_schema.py');

const tsGen = join(root, 'node_modules/.bin/ts-json-schema-generator');
const pyGen = join(root, '.venv/bin/datamodel-codegen');

for (const [tool, hint] of [[tsGen, 'npm install'], [pyGen, 'npm run setup:py']]) {
  if (!existsSync(tool)) {
    console.error(`codegen: missing ${tool}\n  run \`${hint}\` first`);
    process.exit(1);
  }
}

const tmpJson = join(root, 'schema/.plan.schema.json.tmp');
const tmpPy = join(root, 'server/app/.plan_schema.py.tmp');
mkdirSync(dirname(SCHEMA_JSON), { recursive: true });

// --additional-properties: a plan saved by a client newer than this checkout
// carries fields the schema does not know yet. Those are not errors — the
// backend ignores what it does not understand rather than rejecting the plan.
execFileSync(tsGen, [
  '--path', SCHEMA_TS,
  '--type', 'Project',
  '--tsconfig', join(root, 'client/tsconfig.json'),
  '--no-type-check',           // tsc --noEmit already covers this, in npm test
  '--additional-properties',
  '--out', tmpJson,
], { stdio: ['ignore', 'inherit', 'inherit'] });

execFileSync(pyGen, [
  '--input', tmpJson,
  '--input-file-type', 'jsonschema',
  '--output-model-type', 'pydantic_v2.BaseModel',
  '--output', tmpPy,
  '--class-name', 'Plan',
  '--target-python-version', '3.12',
  // Without this, `Obj` and `LayerId` come out as RootModel wrappers and every
  // read site has to go through `.root`. Collapsing them gives the backend the
  // plain union and plain str the TypeScript actually describes.
  '--collapse-root-models',
  '--disable-timestamp',
  '--formatters', 'black', 'isort',
  '--custom-file-header', [
    '# Generated from client/src/model/schema.ts by `npm run codegen`.',
    '# Do not edit: `npm test` fails when this file and the schema disagree.',
  ].join('\n'),
], { stdio: ['ignore', 'inherit', 'inherit'] });

let stale = false;
for (const [tmp, dest] of [[tmpJson, SCHEMA_JSON], [tmpPy, PLAN_PY]]) {
  const next = readFileSync(tmp, 'utf8');
  const prev = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  if (next === prev) continue;
  if (check) {
    console.error(`codegen: ${dest.slice(root.length + 1)} is stale — run \`npm run codegen\``);
    stale = true;
  } else {
    writeFileSync(dest, next);
    console.log(`codegen: wrote ${dest.slice(root.length + 1)}`);
  }
}

execFileSync('rm', ['-f', tmpJson, tmpPy]);
if (stale) process.exit(1);
if (!check) console.log('codegen: up to date');
