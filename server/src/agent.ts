import Anthropic from '@anthropic-ai/sdk';
import type { Request, Response } from 'express';

// Full AI assistant for the floor-plan editor. The browser posts the current
// design objects (with ids) + the furniture catalog + a user message; we run a
// server-side tool loop (Claude Sonnet 5) whose tools produce "operations"
// (add / move / update / delete) that the browser applies through its Doc — so
// undo, autosave and room detection all keep working. The API key stays here.

const MODEL = 'claude-sonnet-5';

type CatItem = { id: string; name: string; w: number; h: number };
export type Op =
  | { op: 'add'; obj: any }
  | { op: 'move'; id: string; dx: number; dy: number }
  | { op: 'update'; id: string; patch: Record<string, any> }
  | { op: 'delete'; id: string };

export interface AgentCtx { state: any[]; catalog: Map<string, CatItem>; ops: Op[] }

const summarize = (o: any) => {
  const b: any = { id: o.id, kind: o.kind };
  if (o.kind === 'wall') return { ...b, a: o.a, b: o.b, thickness: o.thickness, bulge: o.bulge || 0, color: o.color };
  if (o.kind === 'beam') return { ...b, a: o.a, b: o.b, width: o.width, height: o.height, elevation: o.elevation };
  if (o.kind === 'dimension') return { ...b, a: o.a, b: o.b };
  if (o.kind === 'furniture') return { ...b, item: o.item, x: o.x, y: o.y, w: o.w, h: o.h, angle: o.angle };
  if (o.kind === 'door' || o.kind === 'window') return { ...b, x: o.x, y: o.y, width: o.width, style: o.style, elevation: o.elevation };
  if (o.kind === 'room') return { ...b, name: o.name };
  return b;
};

// added objects get a placeholder id so the model sees them in list_objects,
// but they can't be edited until the next message (the browser assigns real ids)
function pushAdd(ctx: AgentCtx, obj: any) {
  const n = ctx.ops.filter(o => o.op === 'add').length + 1;
  ctx.state.push({ id: `new-${n}`, ...obj });
  ctx.ops.push({ op: 'add', obj });
}

const UPDATABLE = ['angle', 'width', 'thickness', 'height', 'elevation', 'w', 'h', 'color', 'style', 'name', 'item', 'depth'];

// Pure tool handler over (state, catalog): appends ops/state, returns a small
// JSON-able result for the model. Exported for testing.
export function runToolCall(name: string, input: any, ctx: AgentCtx): any {
  const { state, catalog, ops } = ctx;
  const find = (id: string) => state.find(o => o.id === id);
  const editable = (id: string) => {
    if (String(id).startsWith('new-')) return { ok: false as const, error: '剛新增的物件要等下一則訊息才有可編輯的 id' };
    if (!find(id)) return { ok: false as const, error: `找不到 id「${id}」，請先用 list_objects 查看` };
    return null;
  };
  switch (name) {
    case 'list_objects':
      return state.map(summarize);
    case 'add_wall':
      pushAdd(ctx, { kind: 'wall', a: { x: input.x1, y: input.y1 }, b: { x: input.x2, y: input.y2 }, thickness: input.thickness ?? 12, bulge: input.bulge ?? 0 });
      return { ok: true };
    case 'add_beam':
      pushAdd(ctx, { kind: 'beam', a: { x: input.x1, y: input.y1 }, b: { x: input.x2, y: input.y2 }, width: input.width ?? 20, height: input.height ?? 40, elevation: input.elevation ?? 230 });
      return { ok: true };
    case 'add_door':
    case 'add_window': {
      const kind = name === 'add_door' ? 'door' : 'window';
      pushAdd(ctx, { kind, x: input.x, y: input.y, width: input.width ?? (kind === 'door' ? 90 : 120), angle: 0, style: input.style, elevation: input.elevation });
      return { ok: true, note: '會自動貼齊最近的牆' };
    }
    case 'add_furniture': {
      const cat = catalog.get(input.item);
      if (!cat) return { ok: false, error: `未知家具 id「${input.item}」。可用 id：${[...catalog.keys()].join(', ')}` };
      pushAdd(ctx, { kind: 'furniture', item: cat.id, x: input.x - cat.w / 2, y: input.y - cat.h / 2, w: cat.w, h: cat.h, angle: input.angle ?? 0, label: cat.name });
      return { ok: true, placed: cat.name };
    }
    case 'move_object': {
      const e = editable(input.id); if (e) return e;
      ops.push({ op: 'move', id: input.id, dx: input.dx ?? 0, dy: input.dy ?? 0 });
      return { ok: true };
    }
    case 'update_object': {
      const e = editable(input.id); if (e) return e;
      const patch: Record<string, any> = {};
      for (const k of UPDATABLE) if (input[k] !== undefined) patch[k] = input[k];
      if (!Object.keys(patch).length) return { ok: false, error: `沒有提供要更新的屬性（可用：${UPDATABLE.join(', ')}）` };
      ops.push({ op: 'update', id: input.id, patch });
      return { ok: true };
    }
    case 'delete_object': {
      const e = editable(input.id); if (e) return e;
      ops.push({ op: 'delete', id: input.id });
      return { ok: true };
    }
  }
  return { ok: false, error: 'unknown tool' };
}

const xy = { type: 'number' } as const;
const TOOLS: Anthropic.Tool[] = [
  { name: 'list_objects', description: '列出目前平面圖上的所有物件（含 id、種類與主要參數）。要修改或刪除既有物件前，先呼叫這個取得 id。', input_schema: { type: 'object', properties: {} } },
  { name: 'add_wall', description: '新增一道牆，座標單位公分（cm）。bulge 可讓牆變成弧形（垂距 cm，正負決定彎曲方向）。', input_schema: { type: 'object', properties: { x1: xy, y1: xy, x2: xy, y2: xy, thickness: { type: 'number', description: '牆厚，預設 12' }, bulge: { type: 'number', description: '弧度垂距 cm，0=直牆' } }, required: ['x1', 'y1', 'x2', 'y2'] } },
  { name: 'add_beam', description: '新增一根樑（從天花板往下垂）。elevation=樑底離地高度 cm，height=樑高 cm。', input_schema: { type: 'object', properties: { x1: xy, y1: xy, x2: xy, y2: xy, width: xy, height: xy, elevation: xy }, required: ['x1', 'y1', 'x2', 'y2'] } },
  { name: 'add_door', description: '在指定點放一扇門，會自動貼齊最近的牆。style: single/double/sliding/glass。', input_schema: { type: 'object', properties: { x: xy, y: xy, width: xy, style: { type: 'string', enum: ['single', 'double', 'sliding', 'glass'] }, elevation: xy }, required: ['x', 'y'] } },
  { name: 'add_window', description: '在指定點放一扇窗，會自動貼齊最近的牆。style: single/sliding/casement/picture。', input_schema: { type: 'object', properties: { x: xy, y: xy, width: xy, style: { type: 'string', enum: ['single', 'sliding', 'casement', 'picture'] }, elevation: xy }, required: ['x', 'y'] } },
  { name: 'add_furniture', description: '在指定中心點放一件家具。item 必須是家具目錄 id。', input_schema: { type: 'object', properties: { item: { type: 'string' }, x: xy, y: xy, angle: { type: 'number', description: '旋轉角度，預設 0' } }, required: ['item', 'x', 'y'] } },
  { name: 'move_object', description: '把某個既有物件平移 (dx, dy) 公分（+x 向右、+y 向下）。id 來自 list_objects。', input_schema: { type: 'object', properties: { id: { type: 'string' }, dx: xy, dy: xy }, required: ['id'] } },
  { name: 'update_object', description: '修改某個既有物件的屬性：angle 旋轉、width/thickness/height/elevation/w/h 尺寸、color 顏色、style 門窗樣式、name 房間名、item 家具種類。只需帶要改的欄位。', input_schema: { type: 'object', properties: { id: { type: 'string' }, angle: xy, width: xy, thickness: xy, height: xy, elevation: xy, w: xy, h: xy, depth: xy, color: { type: 'string' }, style: { type: 'string' }, name: { type: 'string' }, item: { type: 'string' } }, required: ['id'] } },
  { name: 'delete_object', description: '刪除某個既有物件。id 來自 list_objects。', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

export async function handleAgent(req: Request, res: Response) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: '伺服器未設定 ANTHROPIC_API_KEY（請在 server/.env 設定後重啟）' });

  const { message, objects, catalog } = req.body ?? {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });

  const cat: CatItem[] = Array.isArray(catalog) ? catalog : [];
  const ctx: AgentCtx = { state: Array.isArray(objects) ? objects.map((o: any) => ({ ...o })) : [], catalog: new Map(cat.map(c => [c.id, c])), ops: [] };

  const system = [
    '你是室內設計平面圖的 AI 助手。單位一律是公分（cm），座標系 x 向右、y 向下。',
    '你可以新增／移動／修改／刪除：牆、樑、門、窗、家具。',
    '修改或刪除既有物件前，先呼叫 list_objects 取得它們的 id。剛用 add 新增的物件要等下一則訊息才有可編輯的 id。',
    '牆與樑用兩個端點座標；牆的 bulge 可做弧形。門窗給一個點即可，會自動貼齊最近的牆。',
    '放家具時 item 必須用下列目錄 id 之一：',
    cat.map(c => `${c.id}（${c.name}, ${c.w}x${c.h}cm）`).join('、') || '（目錄為空）',
    '一次可以連續呼叫多個工具完成使用者的要求。回答用繁體中文、簡潔；完成後用一句話說明你做了什麼。',
  ].join('\n');

  try {
    const client = new Anthropic({ apiKey: key });
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: message }];
    let reply = '';
    for (let i = 0; i < 12; i++) {
      const resp = await client.messages.create({ model: MODEL, max_tokens: 1500, system, tools: TOOLS, messages });
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
