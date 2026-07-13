import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'interior.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface ProjectRow { id: string; name: string; data: string; created_at: string; updated_at: string; }

export function listProjects() {
  return db.prepare(
    'SELECT id, name, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC'
  ).all();
}

export function getProject(id: string) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, data: JSON.parse(row.data), updatedAt: row.updated_at };
}

export function saveProject(id: string, name: string, data: unknown) {
  const json = JSON.stringify(data);
  const exists = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id);
  if (exists) {
    db.prepare('UPDATE projects SET name = ?, data = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(name, json, id);
  } else {
    db.prepare('INSERT INTO projects (id, name, data) VALUES (?, ?, ?)').run(id, name, json);
  }
  return { id, name };
}

export function deleteProject(id: string) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}
