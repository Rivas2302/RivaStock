import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authorizeWorkerRequest } from '../_shared/aiBridgeWorkerAuth.ts';
import { createSupabaseApiKeyFetch, resolveSupabaseAdminKey, SUPABASE_PUBLISHABLE_KEY, withSupabaseAdminKeyMode } from '../_shared/supabaseAdminKey.ts';
import { findReadTool, validateReadToolArguments } from '../_shared/aiToolDefinitions.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const { key: SUPABASE_ADMIN_KEY, mode: SUPABASE_ADMIN_KEY_MODE } = resolveSupabaseAdminKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
const LEGACY_TOKEN = Deno.env.get('AI_BRIDGE_TOKEN') ?? '';
const LEGACY_OWNER_UID = Deno.env.get('AI_BRIDGE_OWNER_UID') ?? '';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_RESULT_BYTES = 12 * 1024;
const DEFAULT_ORIGINS = ['https://rivastock.vercel.app', 'http://localhost:5173'];

function allowedOrigins(): Set<string> {
  const configured = Deno.env.get('AI_BRIDGE_ALLOWED_ORIGINS');
  return new Set((configured ? configured.split(',') : DEFAULT_ORIGINS).map((value) => value.trim()).filter(Boolean));
}

function response(body: unknown, status = 200, origin?: string | null): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  if (origin && allowedOrigins().has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES || !req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateInternalEmbedding(tool: string, args: Record<string, unknown>): boolean {
  if (!('__embedding' in args)) return true;
  const embedding = args.__embedding;
  return tool === 'conocimiento_buscar' && Array.isArray(embedding) && embedding.length === 384
    && embedding.every((value) => typeof value === 'number' && Number.isFinite(value));
}

function truncateResult(value: unknown): { data: unknown; truncated: boolean } {
  let data = value;
  let truncated = false;
  const size = () => new TextEncoder().encode(JSON.stringify(data)).byteLength;
  while (size() > MAX_RESULT_BYTES) {
    if (data && typeof data === 'object' && 'items' in data && Array.isArray((data as { items: unknown }).items)
      && (data as { items: unknown[] }).items.length > 1) {
      const items = (data as { items: unknown[] }).items;
      data = { ...(data as Record<string, unknown>), items: items.slice(0, Math.max(1, Math.floor(items.length / 2))) };
      truncated = true;
      continue;
    }
    const compacted = compactLongStrings(data, 800);
    if (JSON.stringify(compacted) === JSON.stringify(data)) break;
    data = compacted;
    truncated = true;
  }
  if (size() > MAX_RESULT_BYTES) data = { aviso: 'La respuesta es demasiado extensa; acotá la consulta.' };
  return { data, truncated };
}

function compactLongStrings(value: unknown, maxLength: number): unknown {
  if (typeof value === 'string') return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
  if (Array.isArray(value)) return value.map((item) => compactLongStrings(item, maxLength));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactLongStrings(item, maxLength)]));
}

serve(withSupabaseAdminKeyMode(async (req) => {
  const origin = req.headers.get('origin');
  if (origin && !allowedOrigins().has(origin)) return response({ ok: false, error: 'Origen no permitido.' }, 403);
  if (req.method === 'OPTIONS') return response({}, 204, origin);
  if (req.method !== 'POST') return response({ ok: false, error: 'Método no permitido.' }, 405, origin);
  const body = await readBody(req);
  if (!body) return response({ ok: false, error: 'Solicitud inválida o demasiado grande.' }, 413, origin);
  if (!SUPABASE_URL || !SUPABASE_ADMIN_KEY) return response({ ok: false, error: 'El servicio de herramientas no está configurado.' }, 503, origin);
  if (!isUuid(body.worker_id) || !isUuid(body.job_id) || typeof body.tool !== 'string'
    || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) {
    return response({ ok: false, error: 'La consulta no es válida.' }, 400, origin);
  }
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createSupabaseApiKeyFetch(SUPABASE_ADMIN_KEY) },
  });
  const { ownerUid } = await authorizeWorkerRequest(serviceClient, body.worker_id,
    req.headers.get('authorization'), { token: LEGACY_TOKEN, ownerUid: LEGACY_OWNER_UID });
  if (!ownerUid) return response({ ok: false, error: 'Conexión del AI Bridge inválida o desvinculada.' }, 401, origin);

  const { data: job, error: jobError } = await serviceClient.from('ai_jobs')
    .select('id, user_id, worker_id, chat_id, status, provider')
    .eq('id', body.job_id).eq('user_id', ownerUid).eq('worker_id', body.worker_id).eq('status', 'processing').maybeSingle();
  if (jobError || !job || !job.chat_id || job.provider !== 'codex') {
    return response({ ok: false, error: 'La tarea ya no está disponible para consultar datos.' }, 409, origin);
  }

  const tool = findReadTool(body.tool);
  if (!tool) return response({ ok: false, error: 'La herramienta no está disponible.' }, 400, origin);
  const fullArgs = body.args as Record<string, unknown>;
  const args = { ...fullArgs };
  delete args.__embedding;
  if (tool.module) {
    const { data: enabled, error } = await serviceClient.rpc('business_module_enabled', { p_owner: ownerUid, p_module: tool.module });
    if (error || enabled !== true) return response({ ok: false, error: 'El módulo necesario no está incluido en el plan.' }, 403, origin);
  }
  if (!validateReadToolArguments(tool, args) || !validateInternalEmbedding(body.tool, fullArgs)) {
    return response({ ok: false, error: 'Los parámetros no coinciden con la herramienta.' }, 400, origin);
  }
  if ('desde' in args && 'hasta' in args) {
    const start = Date.parse(`${String(args.desde)}T00:00:00Z`);
    const end = Date.parse(`${String(args.hasta)}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 365 * 86_400_000) {
      return response({ ok: false, error: 'El período debe estar dentro de 366 días.' }, 400, origin);
    }
  }

  const startedAt = Date.now();
  const { data: callId, error: reserveError } = await serviceClient.rpc('ai_tool_reserve_call', {
    p_owner: ownerUid, p_job_id: job.id, p_chat_id: job.chat_id, p_tool: tool.name, p_args: args,
  });
  if (reserveError) return response({ ok: false, error: 'No se pudo registrar la consulta.' }, 409, origin);
  if (!callId) return response({ ok: false, error: 'Límite de consultas por respuesta alcanzado' }, 429, origin);

  let ok = false;
  let rowCount: number | null = null;
  let result: unknown;
  let errorMessage: string | null = null;
  try {
    const { data, error } = await serviceClient.rpc(`ai_tool_${tool.name}`, { p_owner: ownerUid, p_args: fullArgs });
    if (error) throw new Error(error.message);
    result = data;
    ok = true;
    rowCount = data && typeof data === 'object' && 'items' in data && Array.isArray((data as { items: unknown }).items)
      ? (data as { items: unknown[] }).items.length : data ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    errorMessage = message.includes('no está incluido') ? 'El módulo necesario no está incluido en el plan.'
      : message.includes('No se encontró') ? message : 'No se pudo completar la consulta.';
  }
  await serviceClient.rpc('ai_tool_finish_call', {
    p_owner: ownerUid, p_id: callId, p_ok: ok, p_row_count: rowCount, p_duration_ms: Date.now() - startedAt,
    p_error: errorMessage,
  });
  if (!ok) return response({ ok: false, error: errorMessage ?? 'No se pudo completar la consulta.' }, 200, origin);
  const bounded = truncateResult(result);
  return response({ ok: true, data: bounded.data, truncated: bounded.truncated }, 200, origin);
}, SUPABASE_ADMIN_KEY_MODE));
