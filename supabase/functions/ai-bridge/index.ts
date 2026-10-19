import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AI_BRIDGE_TOKEN = Deno.env.get('AI_BRIDGE_TOKEN') ?? '';
const AI_BRIDGE_OWNER_UID = Deno.env.get('AI_BRIDGE_OWNER_UID') ?? '';
const MAX_BODY_BYTES = 16_384;
const ALLOWED_PROVIDERS = new Set(['mock', 'codex', 'claude']);
const DEFAULT_ORIGINS = ['https://rivastock.vercel.app', 'http://localhost:5173'];

function configuredOrigins(): Set<string> {
  const configured = Deno.env.get('AI_BRIDGE_ALLOWED_ORIGINS');
  return new Set((configured ? configured.split(',') : DEFAULT_ORIGINS)
    .map((origin) => origin.trim()).filter(Boolean));
}

function jsonResponse(body: unknown, status = 200, origin?: string | null): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  });
  if (origin && configuredOrigins().has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
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
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const body = JSON.parse(new TextDecoder().decode(concatBytes(chunks, size)));
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function concatBytes(chunks: Uint8Array[], size: number): Uint8Array {
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function validateWorkerConfiguration(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    && AI_BRIDGE_TOKEN.length >= 32 && isUuid(AI_BRIDGE_OWNER_UID));
}

function safeDbError(error: { message?: string } | null, status = 400): Response {
  const message = error?.message ?? '';
  if (message.includes('Solo el propietario')) return jsonResponse({ error: 'Solo el administrador propietario puede usar IA.' }, 403);
  if (message.includes('ya se usó')) return jsonResponse({ error: 'Esta solicitud ya fue enviada con otros datos.' }, 409);
  if (message.includes('Resultado inválido') || message.includes('instrucción') || message.includes('Proveedor')) {
    return jsonResponse({ error: message }, status);
  }
  console.error('[ai-bridge] Database operation failed.');
  return jsonResponse({ error: 'No se pudo completar la operación de IA.' }, 500);
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  if (origin && !configuredOrigins().has(origin)) return jsonResponse({ error: 'Origen no permitido.' }, 403);
  if (req.method === 'OPTIONS') return jsonResponse({}, 204, origin);
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405, origin);

  const body = await readJson(req);
  if (!body) return jsonResponse({ error: 'Solicitud inválida o demasiado grande.' }, 413, origin);
  const action = body.action;

  if (action === 'worker_heartbeat' || action === 'worker_claim'
    || action === 'worker_complete' || action === 'worker_fail') {
    if (!validateWorkerConfiguration()) return jsonResponse({ error: 'El AI Bridge no está configurado en el servidor.' }, 503, origin);
    const authorization = req.headers.get('authorization') ?? '';
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!constantTimeEqual(suppliedToken, AI_BRIDGE_TOKEN)) return jsonResponse({ error: 'Credencial del AI Bridge inválida.' }, 401, origin);
    if (!isUuid(body.worker_id)) return jsonResponse({ error: 'Identificador de worker inválido.' }, 400, origin);

    let rpcAction: string;
    let jobId: string | null = null;
    let payload: Record<string, unknown> | null = null;
    switch (action) {
      case 'worker_heartbeat':
        if (body.state !== 'idle' && body.state !== 'busy') return jsonResponse({ error: 'Estado de worker inválido.' }, 400, origin);
        if (body.job_id !== undefined && body.job_id !== null && !isUuid(body.job_id)) return jsonResponse({ error: 'Identificador de tarea inválido.' }, 400, origin);
        rpcAction = 'heartbeat';
        jobId = typeof body.job_id === 'string' ? body.job_id : null;
        payload = { state: body.state };
        break;
      case 'worker_claim':
        rpcAction = 'claim';
        break;
      case 'worker_complete':
        if (!isUuid(body.job_id) || typeof body.output !== 'string' || body.output.trim().length === 0 || body.output.length > 20_000) {
          return jsonResponse({ error: 'Resultado inválido.' }, 400, origin);
        }
        rpcAction = 'complete';
        jobId = body.job_id;
        payload = { output: body.output };
        break;
      default:
        if (!isUuid(body.job_id) || typeof body.error !== 'string' || body.error.trim().length === 0 || body.error.length > 1000) {
          return jsonResponse({ error: 'Error de tarea inválido.' }, 400, origin);
        }
        rpcAction = 'fail';
        jobId = body.job_id;
        payload = { error: body.error };
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await serviceClient.rpc('ai_bridge_worker', {
      p_action: rpcAction,
      p_owner_uid: AI_BRIDGE_OWNER_UID,
      p_worker_id: body.worker_id,
      p_job_id: jobId,
      p_result: payload,
    });
    if (error) return safeDbError(error);
    return jsonResponse({ data }, 200, origin);
  }

  const authorization = req.headers.get('authorization');
  if (!authorization) return jsonResponse({ error: 'No autenticado.' }, 401, origin);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return jsonResponse({ error: 'El backend de IA no está configurado.' }, 503, origin);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return jsonResponse({ error: 'La sesión no es válida.' }, 401, origin);
  if (!isUuid(AI_BRIDGE_OWNER_UID) || user.id !== AI_BRIDGE_OWNER_UID) {
    return jsonResponse({ error: 'Este AI Bridge no está habilitado para esta cuenta.' }, 403, origin);
  }

  if (action === 'create') {
    if (!isUuid(body.idempotency_key) || typeof body.provider !== 'string'
      || !ALLOWED_PROVIDERS.has(body.provider) || typeof body.input !== 'string'
      || body.input.trim().length === 0 || body.input.length > 8000) {
      return jsonResponse({ error: 'Elegí un proveedor e ingresá una instrucción de hasta 8000 caracteres.' }, 400, origin);
    }
    const { data, error } = await userClient.rpc('ai_create_job', {
      p_idempotency_key: body.idempotency_key,
      p_provider: body.provider,
      p_input: body.input,
    });
    if (error) return safeDbError(error);
    return jsonResponse({ job: data }, 201, origin);
  }

  if (action === 'get') {
    if (!isUuid(body.job_id)) return jsonResponse({ error: 'Identificador de tarea inválido.' }, 400, origin);
    const { data, error } = await userClient.from('ai_jobs')
      .select('id, provider, task_type, input, output, status, error, created_at, started_at, completed_at, attempt_count')
      .eq('id', body.job_id).maybeSingle();
    if (error) return safeDbError(error);
    if (!data) return jsonResponse({ error: 'No se encontró la tarea.' }, 404, origin);
    return jsonResponse({ job: data }, 200, origin);
  }

  if (action === 'recent') {
    const { data, error } = await userClient.from('ai_jobs')
      .select('id, provider, task_type, input, output, status, error, created_at, started_at, completed_at, attempt_count')
      .order('created_at', { ascending: false }).limit(10);
    if (error) return safeDbError(error);
    return jsonResponse({ jobs: data ?? [] }, 200, origin);
  }

  if (action === 'status') {
    const { data, error } = await userClient.from('ai_bridge_workers')
      .select('state, last_seen_at').maybeSingle();
    if (error) return safeDbError(error);
    const lastSeenAt = data?.last_seen_at ?? null;
    const online = Boolean(lastSeenAt && Date.now() - Date.parse(lastSeenAt) < 60_000);
    return jsonResponse({ state: online ? (data?.state ?? 'idle') : 'offline', last_seen_at: lastSeenAt }, 200, origin);
  }

  return jsonResponse({ error: 'Operación no permitida.' }, 400, origin);
});
