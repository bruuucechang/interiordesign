// Runs the editor's migration over plans piped in as JSON.
//
// The backfill script owns the database and this owns the transform, so there
// is still exactly one implementation of a migration — the one the editor runs
// when it opens a plan. Reimplementing the ladder in Python is the thing this
// exists to avoid.
//
//   echo '[{"id":"p1","data":{...}}]' | tsx scripts/migrate-plans.ts
//   -> [{"id":"p1","data":{...},"changed":true}]

import { migrate, SCHEMA_VERSION } from '../client/src/model/migrate';

interface Row { id: string; data: unknown; }

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// Wrapped rather than using top-level await: the repo has no "type": "module"
// at the root, so tsx transpiles this to CommonJS, which has no such thing.
async function main() {
  const rows: Row[] = JSON.parse(await readStdin());

  const out = rows.map(({ id, data }) => {
    const before = JSON.stringify(data);
    // migrate mutates, so hand it a copy — `before` has to stay comparable.
    const after = migrate(JSON.parse(before));
    return { id, data: after, changed: JSON.stringify(after) !== before };
  });

  process.stdout.write(JSON.stringify({ schemaVersion: SCHEMA_VERSION, rows: out }));
}

main();
