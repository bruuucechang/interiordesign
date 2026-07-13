import express from 'express';
import cors from 'cors';
import { listProjects, getProject, saveProject, deleteProject } from './db.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // floor plans can carry many objects

const PORT = Number(process.env.PORT) || 8791;

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/projects', (_req, res) => res.json({ projects: listProjects() }));

app.get('/api/projects/:id', (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

app.put('/api/projects/:id', (req, res) => {
  const { name, data } = req.body ?? {};
  if (!name || data === undefined) return res.status(400).json({ error: 'name and data required' });
  res.json(saveProject(req.params.id, String(name), data));
});

app.delete('/api/projects/:id', (req, res) => {
  deleteProject(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`[interior-designer] API on http://localhost:${PORT}`));
