import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AI_BRIDGE_TOKEN = Deno.env.get('AI_BRIDGE_TOKEN') ?? '';
const AI_BRIDGE_OWNER_UID = Deno.env.get('AI_BRIDGE_OWNER_UID') ?? '';
const MAX_BODY_BYTES = 16_384;
const ALLOWED_PROVIDERS = new Set(['mock', 'codex', 'claude']);
const ALLOWED_CODEX_MODELS = new Set(['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra']);
const ALLOWED_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
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
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function safeDbError(error: { message?: string } | null, status = 400, origin?: string | null): Response {
  const message = error?.message ?? '';
  if (message.includes('Solo el propietario')) return jsonResponse({ error: 'Solo el administrador propietario puede usar IA.' }, 403, origin);
  if (message.includes('ya se usó')) return jsonResponse({ error: 'Esta solicitud ya fue enviada con otros datos.' }, 409, origin);
  if (message.includes('Actualizá el AI Bridge')) return jsonResponse({ error: message }, 409, origin);
  if (message.includes('No se encontró el chat')) return jsonResponse({ error: message }, 404, origin);
  if (message.includes('No se encontró la tarea')) return jsonResponse({ error: message }, 404, origin);
  if (message.includes('Esperá a que termine') || message.includes('Ya hay diez tareas')
    || message.includes('no se puede cambiar') || message.includes('actualización segura')) return jsonResponse({ error: message }, 409, origin);
  if (message.includes('Computadora desvinculada')) return jsonResponse({ error: message }, 401, origin);
  if (message.includes('Resultado inválido') || message.includes('instrucción') || message.includes('Proveedor')
    || message.includes('mensaje debe') || message.includes('Opciones de contexto')
    || message.includes('Modelo') || message.includes('razonamiento') || message.includes('configuración enviada')
    || message.includes('Nombre de computadora') || message.includes('tareas puntuales')
    || message.includes('Período de retención') || message.includes('lápida') || message.includes('Worker inválido')) {
    return jsonResponse({ error: message }, status, origin);
  }
  console.error('[ai-bridge] Database operation failed.');
  return jsonResponse({ error: 'No se pudo completar la operación de IA.' }, 500, origin);
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
    || action === 'worker_complete' || action === 'worker_fail'
    || action === 'worker_workspace' || action === 'worker_context'
    || action === 'worker_update_prepare' || action === 'worker_start'
    || action === 'worker_chat_tombstones' || action === 'worker_chat_tombstones_ack') {
    if (!validateWorkerConfiguration()) return jsonResponse({ error: 'El AI Bridge no está configurado en el servidor.' }, 503, origin);
    const authorization = req.headers.get('authorization') ?? '';
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!isUuid(body.worker_id)) return jsonResponse({ error: 'Identificador de worker inválido.' }, 400, origin);

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    let ownerUid: string | null = null;
    if (suppliedToken.length >= 32 && suppliedToken.length <= 256) {
      const { data: authorizedUid, error: authorizationError } = await serviceClient.rpc('ai_bridge_authorize_device', {
        p_device_id: body.worker_id,
        p_token: suppliedToken,
      });
      if (!authorizationError && isUuid(authorizedUid)) ownerUid = authorizedUid;
    }

    // Keep the already-configured installation working until its owner pairs
    // a device. A new pairing disables this legacy shared credential.
    if (!ownerUid && AI_BRIDGE_TOKEN.length >= 32 && isUuid(AI_BRIDGE_OWNER_UID)
      && constantTimeEqual(suppliedToken, AI_BRIDGE_TOKEN)) {
      const { data: deviceHistory, error: deviceError } = await serviceClient.from('ai_bridge_devices')
        .select('id').eq('user_id', AI_BRIDGE_OWNER_UID).limit(1).maybeSingle();
      if (!deviceError && !deviceHistory) ownerUid = AI_BRIDGE_OWNER_UID;
    }
    if (!ownerUid) return jsonResponse({ error: 'Conexión del AI Bridge inválida, vencida o desvinculada.' }, 401, origin);

    if (action === 'worker_chat_tombstones' || action === 'worker_chat_tombstones_ack') {
      const chatIds = body.chat_ids;
      if (action === 'worker_chat_tombstones_ack'
        && (!Array.isArray(chatIds) || chatIds.length < 1 || chatIds.length > 50 || !chatIds.every(isUuid))) {
        return jsonResponse({ error: 'Lista de lápidas inválida.' }, 400, origin);
      }
      const { data, error } = await serviceClient.rpc('ai_bridge_chat_tombstones', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
        p_operation: action === 'worker_chat_tombstones' ? 'list' : 'ack',
        p_ids: action === 'worker_chat_tombstones_ack' ? chatIds : null,
      });
      if (error) return safeDbError(error, 400, origin);
      return jsonResponse(data ?? {}, 200, origin);
    }

    if (action === 'worker_workspace') {
      const { data, error } = await serviceClient.from('ai_workspace_files')
        .select('path, content, updated_at')
        .eq('user_id', ownerUid)
        .order('path', { ascending: true });
      if (error) return safeDbError(error, 400, origin);
      return jsonResponse({ files: data ?? [] }, 200, origin);
    }
    if (action === 'worker_context') {
      if (!isUuid(body.job_id)) return jsonResponse({ error: 'Identificador de tarea inválido.' }, 400, origin);
      const { data: job, error: jobError } = await serviceClient.from('ai_jobs')
        .select('include_business_context, include_project_context, model_id, reasoning_effort, chat_id')
        .eq('id', body.job_id).eq('user_id', ownerUid)
        .eq('worker_id', body.worker_id).eq('status', 'processing').maybeSingle();
      if (jobError) return safeDbError(jobError, 400, origin);
      if (!job) return jsonResponse({ error: 'La tarea no está reservada por este worker.' }, 409, origin);

      let providerSessionId: string | null = null;
      if (job.chat_id) {
        const { data: chat, error: chatError } = await serviceClient.from('ai_chats')
          .select('provider_session_id')
          .eq('id', job.chat_id).eq('user_id', ownerUid).maybeSingle();
        if (chatError) return safeDbError(chatError, 400, origin);
        providerSessionId = chat?.provider_session_id ?? null;
      }

      let products: Array<Record<string, unknown>> = [];
      let totalProducts = 0;
      if (job.include_business_context) {
        const { data, count, error } = await serviceClient.from('products')
          .select('name, category, description, purchase_price, sale_price, stock, min_stock', { count: 'exact' })
          .eq('user_id', ownerUid)
          .order('name', { ascending: true })
          .limit(100);
        if (error) return safeDbError(error, 400, origin);
        products = data ?? [];
        totalProducts = count ?? products.length;
      }

      return jsonResponse({
        include_business_context: job.include_business_context,
        include_project_context: job.include_project_context,
        model_id: job.model_id ?? 'gpt-6-luna',
        reasoning_effort: job.reasoning_effort ?? 'low',
        chat_id: job.chat_id,
        provider_session_id: providerSessionId,
        products,
        total_products: totalProducts,
      }, 200, origin);
    }

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
      case 'worker_update_prepare':
        rpcAction = 'prepare_update';
        break;
      case 'worker_start':
        rpcAction = 'start';
        break;
      case 'worker_complete':
        if (!isUuid(body.job_id) || typeof body.output !== 'string' || body.output.trim().length === 0 || body.output.length > 20_000) {
          return jsonResponse({ error: 'Resultado inválido.' }, 400, origin);
        }
        if (body.session_id !== undefined && (typeof body.session_id !== 'string'
          || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(body.session_id))) {
          return jsonResponse({ error: 'Identificador de sesión inválido.' }, 400, origin);
        }
        rpcAction = 'complete';
        jobId = body.job_id;
        payload = {
          output: body.output,
          ...(typeof body.session_id === 'string' ? { session_id: body.session_id } : {}),
        };
        break;
      default:
        if (!isUuid(body.job_id) || typeof body.error !== 'string' || body.error.trim().length === 0 || body.error.length > 1000) {
          return jsonResponse({ error: 'Error de tarea inválido.' }, 400, origin);
        }
        rpcAction = 'fail';
        jobId = body.job_id;
        payload = { error: body.error };
    }

    const { data, error } = await serviceClient.rpc('ai_bridge_worker', {
      p_action: rpcAction,
      p_owner_uid: ownerUid,
      p_worker_id: body.worker_id,
      p_job_id: jobId,
      p_result: payload,
    });
    if (error) return safeDbError(error, 400, origin);
    if (action === 'worker_claim' && data && typeof data === 'object'
      && '__update_requested' in data && data.__update_requested === true) {
      return jsonResponse(body.supports_update_signal === true
        ? { data: null, should_stop: true }
        : { data: null }, 200, origin);
    }
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

  if (action === 'pair_device') {
    const name = typeof body.name === 'string' ? body.name : 'Mi PC';
    if (name.trim().length < 1 || name.length > 80) return jsonResponse({ error: 'El nombre de la PC debe tener entre 1 y 80 caracteres.' }, 400, origin);
    const { data, error } = await userClient.rpc('pair_ai_bridge_device', { p_name: name });
    if (error) return safeDbError(error, 400, origin);
    return jsonResponse({ pairing: data, endpoint: `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ai-bridge` }, 200, origin);
  }

  if (action === 'revoke_device') {
    if (!isUuid(body.device_id)) return jsonResponse({ error: 'Identificador de computadora inválido.' }, 400, origin);
    const { error } = await userClient.rpc('revoke_ai_bridge_device', { p_device_id: body.device_id });
    if (error) return safeDbError(error, 400, origin);
    return jsonResponse({ revoked: true }, 200, origin);
  }

  if (action === 'create') {
    if (!isUuid(body.idempotency_key) || typeof body.provider !== 'string'
      || !ALLOWED_PROVIDERS.has(body.provider) || typeof body.input !== 'string'
      || body.input.trim().length === 0 || body.input.length > 8000
      || (body.include_business_context !== undefined && typeof body.include_business_context !== 'boolean')
      || (body.include_project_context !== undefined && typeof body.include_project_context !== 'boolean')
      || (body.model_id !== undefined && body.model_id !== null
        && (typeof body.model_id !== 'string' || !ALLOWED_CODEX_MODELS.has(body.model_id)))
      || (body.reasoning_effort !== undefined && body.reasoning_effort !== null
        && (typeof body.reasoning_effort !== 'string' || !ALLOWED_REASONING_EFFORTS.has(body.reasoning_effort)))) {
      return jsonResponse({ error: 'Elegí un proveedor e ingresá una instrucción de hasta 8000 caracteres.' }, 400, origin);
    }
    const { data, error } = await userClient.rpc('ai_create_job_with_model', {
      p_idempotency_key: body.idempotency_key,
      p_provider: body.provider,
      p_input: body.input,
      p_include_business_context: body.include_business_context === true,
      p_include_project_context: body.include_project_context === true,
      p_model_id: typeof body.model_id === 'string' ? body.model_id : null,
      p_reasoning_effort: typeof body.reasoning_effort === 'string' ? body.reasoning_effort : null,
    });
    if (error) return safeDbError(error, 400, origin);
    return jsonResponse({ job: data }, 201, origin);
  }

  if (action === 'chat_list') {
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: retentionError } = await serviceClient.rpc('ai_apply_history_retention', { p_owner: user.id });
    if (retentionError) return safeDbError(retentionError, 400, origin);
    const { data, error } = await userClient.from('ai_chats')
      .select('id, provider, title, model_id, reasoning_effort, created_at, updated_at, last_message_at')
      .order('last_message_at', { ascending: false }).limit(50);
    if (error) return safeDbError(error, 400, origin);
    const chats = data ?? [];
    if (!chats.length) return jsonResponse({ chats }, 200, origin);
    const { data: activeJobs, error: activeJobsError } = await serviceClient.from('ai_jobs')
      .select('chat_id').eq('user_id', user.id).in('chat_id', chats.map((chat) => chat.id))
      .in('status', ['pending', 'processing']);
    if (activeJobsError) return safeDbError(activeJobsError, 400, origin);
    const busyChatIds = new Set((activeJobs ?? []).map((job) => job.chat_id));
    return jsonResponse({ chats: chats.map((chat) => ({ ...chat, has_pending_job: busyChatIds.has(chat.id) })) }, 200, origin);
  }

  if (action === 'chat_delete') {
    if (!isUuid(body.chat_id)) return jsonResponse({ error: 'Identificador de chat inválido.' }, 400, origin);
    const { data, error } = await userClient.rpc('ai_delete_chat', { p_chat_id: body.chat_id });
    if (error) return safeDbError(error, 400, origin);
    return jsonResponse({ deleted: data === true }, 200, origin);
  }

  if (action === 'task_delete') {
    if (!isUuid(body.job_id)) return jsonResponse({ error: 'Identificador de tarea inválido.' }, 400, origin);
    const { data, error } = await userClient.rpc('ai_delete_task', { p_job_id: body.job_id });
    if (error) return safeDbError(error, 400, origin);
    return jsonResponse({ deleted: data === true }, 200, origin);
  }

  if (action === 'tasks_delete_all') {
    const { data, error } = await userClient.rpc('ai_delete_all_tasks');
    if (error) return safeDbError(error, 400, origin);
    return jsonResponse({ deleted_count: typeof data === 'number' ? data : 0 }, 200, origin);
  }

  if (action === 'history_settings_get') {
    const { data, error } = await userClient.from('ai_history_settings')
      .select('retention_days, updated_at').maybeSingle();
    if (error) return safeDbError(error, 400, origin);
    return jsonResponse({ retention_days: data?.retention_days ?? null, updated_at: data?.updated_at ?? null }, 200, origin);
  }

  if (action === 'history_settings_update') {
    const days = body.retention_days;
    if (days !== null && days !== 30 && days !== 90 && days !== 180 && days !== 365) {
      return jsonResponse({ error: 'Elegí una retención válida.' }, 400, origin);
    }
    const { data, error } = await userClient.rpc('ai_update_history_settings', { p_retention_days: days });
    if (error) return safeDbError(error, 400, origin);
    return jsonResponse({ retention_days: data?.retention_days ?? null, updated_at: data?.updated_at ?? null }, 200, origin);
  }

  if (action === 'chat_get') {
    if (!isUuid(body.chat_id)) return jsonResponse({ error: 'Identificador de chat inválido.' }, 400, origin);
    const { data: chat, error: chatError } = await userClient.from('ai_chats')
      .select('id, provider, title, model_id, reasoning_effort, created_at, updated_at, last_message_at')
      .eq('id', body.chat_id).maybeSingle();
    if (chatError) return safeDbError(chatError, 400, origin);
    if (!chat) return jsonResponse({ error: 'No se encontró el chat.' }, 404, origin);

    const [{ data: descendingMessages, error: messagesError }, { data: jobs, error: jobsError }] = await Promise.all([
      userClient.from('ai_chat_messages')
        .select('id, job_id, role, content, created_at')
        .eq('chat_id', body.chat_id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100),
      userClient.from('ai_jobs')
        .select('id, status, error, created_at')
        .eq('chat_id', body.chat_id).order('created_at', { ascending: false }).limit(100),
    ]);
    if (messagesError) return safeDbError(messagesError, 400, origin);
    if (jobsError) return safeDbError(jobsError, 400, origin);
    return jsonResponse({
      chat,
      messages: (descendingMessages ?? []).reverse(),
      jobs: (jobs ?? []).reverse(),
    }, 200, origin);
  }

  if (action === 'chat_send') {
    const chatId = body.chat_id === undefined || body.chat_id === null
      ? null : typeof body.chat_id === 'string' ? body.chat_id : undefined;
    if (chatId === undefined || (chatId !== null && !isUuid(chatId)) || !isUuid(body.idempotency_key)
      || typeof body.provider !== 'string' || !ALLOWED_PROVIDERS.has(body.provider)
      || typeof body.input !== 'string' || body.input.trim().length === 0 || body.input.length > 8000
      || (body.include_business_context !== undefined && typeof body.include_business_context !== 'boolean')
      || (body.include_project_context !== undefined && typeof body.include_project_context !== 'boolean')
      || (body.model_id !== undefined && body.model_id !== null
        && (typeof body.model_id !== 'string' || !ALLOWED_CODEX_MODELS.has(body.model_id)))
      || (body.reasoning_effort !== undefined && body.reasoning_effort !== null
        && (typeof body.reasoning_effort !== 'string' || !ALLOWED_REASONING_EFFORTS.has(body.reasoning_effort)))) {
      return jsonResponse({ error: 'Elegí un proveedor e ingresá un mensaje de hasta 8000 caracteres.' }, 400, origin);
    }
    const { data, error } = await userClient.rpc('ai_send_chat_message', {
      p_idempotency_key: body.idempotency_key,
      p_provider: body.provider,
      p_input: body.input,
      p_include_business_context: body.include_business_context === true,
      p_include_project_context: body.include_project_context === true,
      p_model_id: typeof body.model_id === 'string' ? body.model_id : null,
      p_reasoning_effort: typeof body.reasoning_effort === 'string' ? body.reasoning_effort : null,
      p_chat_id: chatId,
    });
    if (error) return safeDbError(error, 400, origin);
    return jsonResponse({ chat_id: data.chat_id, job: data.job }, 201, origin);
  }

  if (action === 'get') {
    if (!isUuid(body.job_id)) return jsonResponse({ error: 'Identificador de tarea inválido.' }, 400, origin);
    const { data, error } = await userClient.from('ai_jobs')
      .select('id, provider, task_type, input, output, status, error, created_at, started_at, completed_at, attempt_count, include_business_context, include_project_context, model_id, reasoning_effort')
      .eq('id', body.job_id).maybeSingle();
    if (error) return safeDbError(error, 400, origin);
    if (!data) return jsonResponse({ error: 'No se encontró la tarea.' }, 404, origin);
    return jsonResponse({ job: data }, 200, origin);
  }

  if (action === 'recent') {
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: retentionError } = await serviceClient.rpc('ai_apply_history_retention', { p_owner: user.id });
    if (retentionError) return safeDbError(retentionError, 400, origin);
    const { data, error } = await userClient.from('ai_jobs')
      .select('id, provider, task_type, input, output, status, error, created_at, started_at, completed_at, attempt_count, include_business_context, include_project_context, model_id, reasoning_effort')
      .eq('task_type', 'text_generation').is('chat_id', null)
      .order('created_at', { ascending: false }).limit(10);
    if (error) return safeDbError(error, 400, origin);
    const { count, error: countError } = await serviceClient.from('ai_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('task_type', 'text_generation').is('chat_id', null)
      .in('status', ['completed', 'failed']);
    if (countError) return safeDbError(countError, 400, origin);
    return jsonResponse({ jobs: data ?? [], finished_task_count: count ?? 0 }, 200, origin);
  }

  if (action === 'status') {
    const { data: device, error: deviceError } = await userClient.from('ai_bridge_devices')
      .select('id, name, state, last_seen_at, created_at')
      .is('revoked_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (deviceError) return safeDbError(deviceError, 400, origin);
    if (device) {
      const lastSeenAt = device.last_seen_at ?? null;
      const online = Boolean(lastSeenAt && Date.now() - Date.parse(lastSeenAt) < 60_000);
      return jsonResponse({
        state: online ? device.state : 'offline',
        last_seen_at: lastSeenAt,
        device: { id: device.id, name: device.name },
        paired: true,
        legacy: false,
      }, 200, origin);
    }

    const { data: deviceHistory, error: historyError } = await userClient.from('ai_bridge_devices')
      .select('id').limit(1).maybeSingle();
    if (historyError) return safeDbError(historyError, 400, origin);

    if (!deviceHistory && user.id === AI_BRIDGE_OWNER_UID && AI_BRIDGE_TOKEN.length >= 32) {
      const { data: legacyWorker, error: legacyError } = await userClient.from('ai_bridge_workers')
        .select('state, last_seen_at').maybeSingle();
      if (legacyError) return safeDbError(legacyError, 400, origin);
      const lastSeenAt = legacyWorker?.last_seen_at ?? null;
      const online = Boolean(lastSeenAt && Date.now() - Date.parse(lastSeenAt) < 60_000);
      return jsonResponse({
        state: online ? (legacyWorker?.state ?? 'idle') : 'offline',
        last_seen_at: lastSeenAt,
        device: null,
        paired: false,
        legacy: true,
      }, 200, origin);
    }

    return jsonResponse({ state: 'offline', last_seen_at: null, device: null, paired: false, legacy: false }, 200, origin);
  }

  return jsonResponse({ error: 'Operación no permitida.' }, 400, origin);
});
