import Anthropic from '@anthropic-ai/sdk';
import type { Request, Response } from 'express';

// Minimal AI assistant for the floor-plan editor. The browser posts the current
// design objects + the furniture catalog + a user message; we run a server-side
// tool loop (Claude Sonnet 5) whose tools produce "operations" (add wall / add
// furniture) that the browser then applies through its Doc — so undo, autosave
// and room detection all keep working. The API key stays here on the server.

const MODEL = 'claude-sonnet-5';

type CatItem = { id: string; name: string; w: number; h: number };
export type Op = { op: 'add'; obj: any };

// Tool handlers are pure over (state, catalog): they append to `ops`/`state` and
// return a small JSON-able result for the model. Exported for testing.
export function runToolCall(name: string, input: any, ctx: { state: any[]; catalog: Map<string, CatItem>; ops: Op[] }): any {
  const { state, catalog, ops } = ctx;
  if (name === 'list_objects') {
    return state.map(o => {
      if (o.kind === 'wall' || o.kind === 'beam' || o.kind === 'dimension') return { kind: o.kind, a: o.a, b: o.b };
      if (o.kind === 'furniture') return { kind: o.kind, item: o.item, x: o.x, y: o.y, w: o.w, h: o.h };
      if (o.kind === 'door' || o.kind === 'window') return { kind: o.kind, x: o.x, y: o.y, width: o.width };
      if (o.kind === 'room') return { kind: o.kind, name: o.name };
      return { kind: o.kind };
    });
  }
  if (name === 'add_wall') {
    const obj = { kind: 'wall', a: { x: input.x1, y: input.y1 }, b: { x: input.x2, y: input.y2 }, thickness: input.thickness ?? 12 };
    state.push(obj); ops.push({ op: 'add', obj });
    return { ok: true };
  }
  if (name === 'add_furniture') {
    const cat = catalog.get(input.item);
    if (!cat) return { ok: false, error: `未知家具 id「${input.item}」。可用 id：${[...catalog.keys()].join(', ')}` };
    const obj = { kind: 'furniture', item: cat.id, x: input.x - cat.w / 2, y: input.y - cat.h / 2, w: cat.w, h: cat.h, angle: input.angle ?? 0, label: cat.name };
    state.push(obj); ops.push({ op: 'add', obj });
    return { ok: true, placed: cat.name };
  }
  return { ok: false, error: 'unknown tool' };
}

const TOOLS: Anthropic.Tool[] = [
  { name: 'list_objects', description: '列出目前平面圖上的所有物件（含種類與主要參數）。動手前若需要了解現況，先呼叫這個。', input_schema: { type: 'object', properties: {} } },
  {
    name: 'add_wall', description: '新增一道直牆，座標單位為公分（cm），x 向右、y 向下。',
    input_schema: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, thickness: { type: 'number', description: '牆厚 cm，預設 12' } }, required: ['x1', 'y1', 'x2', 'y2'] },
  },
  {
    name: 'add_furniture', description: '在指定中心點放置一件家具。item 必須是家具目錄中的 id。座標單位公分。',
    input_schema: { type: 'object', properties: { item: { type: 'string', description: '家具目錄 id' }, x: { type: 'number', description: '中心 X (cm)' }, y: { type: 'number', description: '中心 Y (cm)' }, angle: { type: 'number', description: '旋轉角度，預設 0' } }, required: ['item', 'x', 'y'] },
  },
];

export async function handleAgent(req: Request, res: Response) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: '伺服器未設定 ANTHROPIC_API_KEY（請在 server/.env 設定後重啟）' });

  const { message, objects, catalog } = req.body ?? {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });

  const cat: CatItem[] = Array.isArray(catalog) ? catalog : [];
  const ctx = { state: Array.isArray(objects) ? [...objects] : [], catalog: new Map(cat.map(c => [c.id, c])), ops: [] as Op[] };

  const system = [
    '你是室內設計平面圖的 AI 助手。單位一律是公分（cm），座標系 x 向右、y 向下。',
    '你可以用工具在畫布上新增牆與家具。若需要了解現況，先呼叫 list_objects。',
    '牆用兩個端點座標。放置家具時 item 必須用下列目錄 id 之一：',
    cat.map(c => `${c.id}（${c.name}, ${c.w}x${c.h}cm）`).join('、') || '（目錄為空）',
    '回答用繁體中文、簡潔；完成後用一句話說明你做了什麼。',
  ].join('\n');

  try {
    const client = new Anthropic({ apiKey: key });
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: message }];
    let reply = '';
    for (let i = 0; i < 8; i++) {
      const resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system, tools: TOOLS, messages });
      messages.push({ role: 'assistant', content: resp.content });
      const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      if (text) reply = text;
      const toolUses = resp.content.filter((b: any) => b.type === 'tool_use') as any[];
      if (resp.stop_reason !== 'tool_use' || !toolUses.length) break;
      const results = toolUses.map(tu => ({ type: 'tool_result' as const, tool_use_id: tu.id, content: JSON.stringify(runToolCall(tu.name, tu.input, ctx)) }));
      messages.push({ role: 'user', content: results });
    }
    res.json({ reply: reply || '（已完成）', ops: ctx.ops });
  } catch (e: any) {
    console.error('[agent]', e?.message || e);
    res.status(500).json({ error: 'AI 服務錯誤：' + (e?.message || String(e)) });
  }
}
