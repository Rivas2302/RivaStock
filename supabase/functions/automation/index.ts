import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authorizeFacebookDevice, authorizeWorker, isUuid, readJsonLimited } from '../_shared/workerAuth.ts';
import { isPostSubmitObservations } from '../_shared/facebookPostSubmit.ts';
import { createSupabaseApiKeyFetch, logSupabaseAdminKeyMode, resolveSupabaseAdminKey, SUPABASE_PUBLISHABLE_KEY } from '../_shared/supabaseAdminKey.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const { key: SUPABASE_ADMIN_KEY, mode: SUPABASE_ADMIN_KEY_MODE } = resolveSupabaseAdminKey(
  Deno.env.get('SUPABASE_SECRET_KEYS'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
);
logSupabaseAdminKeyMode('automation', SUPABASE_ADMIN_KEY_MODE);
const MAX_BODY_BYTES = 1_048_576;
const MAX_SCREENSHOT_BYTES = 600_000;
const MAX_SUMMARY_BYTES = 20_480;
const TRACE_BUCKET = 'automation-traces';
const SUPERVISOR_FUNCTION_KEYS: Record<string, string> = {
  recover_step: 'fb_supervisor_recover',
  verify_result: 'fb_supervisor_verify',
  review_content: 'fb_copywriting',
  review_photos: 'fb_photo_review',
};
const ALLOWED_ORIGINS = new Set(['https://rivastock.vercel.app', 'http://localhost:5173']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;
type DeviceIdentity = { ownerUid: string; deviceId: string };

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isTraceObjectPath(path: string, ownerUid?: string, traceId?: string): boolean {
  const parts = path.split('/');
  return parts.length === 3
    && UUID_PATTERN.test(parts[0])
    && UUID_PATTERN.test(parts[1])
    && /^[1-9][0-9]{0,4}\.jpg$/.test(parts[2])
    && (!ownerUid || parts[0] === ownerUid)
    && (!traceId || parts[1] === traceId);
}

function jsonResponseWithCors(body: unknown, status = 200, origin?: string | null): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function decodeJpeg(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length < 8 || value.length > Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 4
    || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  try {
    const binary = atob(value);
    if (binary.length < 4 || binary.length > MAX_SCREENSHOT_BYTES) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
    return bytes;
  } catch {
    return null;
  }
}

function validSummary(value: unknown): value is JsonRecord {
  return isRecord(value) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_SUMMARY_BYTES;
}

function errorResponse(message = 'No se pudo completar la operación de automatización.', origin?: string | null): Response {
  return jsonResponseWithCors({ error: message }, 500, origin);
}

function configured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_ADMIN_KEY);
}

function bearerToken(req: Request): string {
  const authorization = req.headers.get('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

async function signedUrls(
  body: JsonRecord,
  authorization: string,
  serviceClient: ReturnType<typeof createClient>,
  origin?: string | null,
): Promise<Response> {
  if (!isUuid(body.trace_id)) return jsonResponseWithCors({ error: 'Identificador de traza inválido.' }, 400, origin);
  const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return jsonResponseWithCors({ error: 'La sesión no es válida.' }, 401, origin);

  const { data: trace, error: traceError } = await userClient.from('fb_run_traces')
    .select('id').eq('id', body.trace_id).maybeSingle();
  if (traceError) return errorResponse(undefined, origin);
  if (!trace) return jsonResponseWithCors({ error: 'No se encontró la traza.' }, 404, origin);

  const { data: steps, error: stepsError } = await userClient.from('fb_trace_steps')
    .select('seq, screenshot_path').eq('trace_id', body.trace_id).not('screenshot_path', 'is', null).order('seq');
  if (stepsError) return errorResponse(undefined, origin);
  const paths = (steps ?? []).map((step) => step.screenshot_path)
    .filter((path): path is string => typeof path === 'string'
      && isTraceObjectPath(path, authData.user.id, body.trace_id as string));
  if (!paths.length) return jsonResponseWithCors({ screenshots: [] }, 200, origin);

  const { data: urls, error: signedError } = await serviceClient.storage.from(TRACE_BUCKET).createSignedUrls(paths, 300);
  if (signedError || !urls) return errorResponse(undefined, origin);
  return jsonResponseWithCors({
    screenshots: urls.map((entry, index) => ({
      seq: (steps ?? []).find((step) => step.screenshot_path === paths[index])?.seq,
      path: paths[index],
      url: entry.signedUrl,
    })),
  }, 200, origin);
}

async function cleanupExpiredTraces(serviceClient: ReturnType<typeof createClient>): Promise<void> {
  const { data, error } = await serviceClient.rpc('fb_traces_cleanup');
  if (error || !isRecord(data) || data.due !== true || !Array.isArray(data.traces)) return;

  const finalized: string[] = [];
  for (const item of data.traces) {
    if (!isRecord(item) || !isUuid(item.trace_id) || !Array.isArray(item.screenshot_paths)) continue;
    const paths = item.screenshot_paths.filter((path): path is string => typeof path === 'string'
      && isTraceObjectPath(path, undefined, item.trace_id as string));
    if (paths.length !== item.screenshot_paths.length) continue;
    if (paths.length) {
      const { error: removeError } = await serviceClient.storage.from(TRACE_BUCKET).remove(paths);
      if (removeError) continue;
    }
    finalized.push(item.trace_id);
  }

  if (finalized.length) {
    const { error: finalizeError } = await serviceClient.rpc('fb_traces_cleanup_finalize', {
      p_trace_ids: finalized,
    });
    if (finalizeError) console.error('[automation] Trace retention cleanup failed.');
  }
}

async function supervisorWorker(
  body: JsonRecord,
  req: Request,
  serviceClient: ReturnType<typeof createClient>,
  origin?: string | null,
): Promise<Response> {
  if (!['next', 'answer', 'fail', 'post_submit_observations'].includes(String(body.operation))) {
    return jsonResponseWithCors({ error: 'Operación de supervisor inválida.' }, 400, origin);
  }
  const ownerUid = await authorizeWorker(req, body, serviceClient);
  if (!ownerUid) return jsonResponseWithCors({ error: 'Conexión del AI Bridge vencida o revocada.' }, 401, origin);
  const workerId = body.worker_id as string;

  if (body.operation === 'next') {
    if (body.id !== undefined || body.data !== undefined) {
      return jsonResponseWithCors({ error: 'Solicitud de supervisor inválida.' }, 400, origin);
    }
    const { data, error } = await serviceClient.rpc('fb_supervisor_worker', {
      p_owner: ownerUid,
      p_worker: workerId,
      p_operation: 'next',
      p_id: null,
      p_data: {},
    });
    if (error) return jsonResponseWithCors({ error: 'No se pudo consultar la cola del supervisor.' }, 503, origin);
    if (data === null) return jsonResponseWithCors({ task: null }, 200, origin);
    if (!isRecord(data) || !isUuid(data.id) || !isUuid(data.trace_id)
      || !isInteger(data.step_seq, 1, 10000) || !Object.hasOwn(SUPERVISOR_FUNCTION_KEYS, String(data.kind))
      || !isRecord(data.intent) || !validSummary(data.dom_summary)) {
      return jsonResponseWithCors({ error: 'La solicitud de supervisor no es válida.' }, 503, origin);
    }

    let screenshotUrl: string | null = null;
    if (data.screenshot_path !== null && data.screenshot_path !== undefined) {
      if (typeof data.screenshot_path !== 'string'
        || !isTraceObjectPath(data.screenshot_path, ownerUid, data.trace_id)) {
        await serviceClient.rpc('fb_supervisor_worker', {
          p_owner: ownerUid, p_worker: workerId, p_operation: 'fail', p_id: data.id,
          p_data: { error: 'La captura de supervisión no tiene una ruta válida.' },
        });
        return jsonResponseWithCors({ error: 'La captura de supervisión no está disponible.' }, 503, origin);
      }
      const { data: signed, error: signedError } = await serviceClient.storage.from(TRACE_BUCKET)
        .createSignedUrl(data.screenshot_path, 120);
      if (signedError || !signed?.signedUrl || !/^https:\/\//i.test(signed.signedUrl)) {
        await serviceClient.rpc('fb_supervisor_worker', {
          p_owner: ownerUid, p_worker: workerId, p_operation: 'fail', p_id: data.id,
          p_data: { error: 'No se pudo obtener la captura para supervisión.' },
        });
        return jsonResponseWithCors({ error: 'La captura de supervisión no está disponible.' }, 503, origin);
      }
      screenshotUrl = signed.signedUrl;
    }

    const functionKey = SUPERVISOR_FUNCTION_KEYS[String(data.kind)];
    const { data: setting, error: settingError } = await serviceClient.from('ai_function_settings')
      .select('provider, model_id, reasoning_effort')
      .eq('user_id', ownerUid)
      .eq('function_key', functionKey)
      .maybeSingle();
    if (settingError) console.error('[automation] Supervisor settings lookup failed.');
    const provider = setting?.provider === 'claude' || setting?.provider === 'local' ? setting.provider : 'codex';
    const modelId = typeof setting?.model_id === 'string' && setting.model_id.length <= 120
      && (provider !== 'codex' || ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'].includes(setting.model_id))
      ? setting.model_id : 'gpt-6-luna';
    const reasoningEffort = ['low', 'medium', 'high', 'xhigh'].includes(setting?.reasoning_effort)
      ? setting.reasoning_effort : (data.kind === 'verify_result' ? 'medium' : 'low');
    return jsonResponseWithCors({ task: {
      id: data.id,
      trace_id: data.trace_id,
      step_seq: data.step_seq,
      kind: data.kind,
      intent: data.intent,
      dom_summary: data.dom_summary,
      screenshot_url: screenshotUrl,
      settings: { provider, model_id: modelId, reasoning_effort: reasoningEffort },
      lease_expires_at: data.lease_expires_at,
    } }, 200, origin);
  }

  if (!isUuid(body.id) || !isRecord(body.data) || new TextEncoder().encode(JSON.stringify(body.data)).byteLength > 12_000) {
    return jsonResponseWithCors({ error: 'Respuesta de supervisor inválida.' }, 400, origin);
  }
  if (body.operation === 'answer') {
    const answer = body.data;
    if (!isRecord(answer.decision) || !['codex', 'claude'].includes(String(answer.provider))
      || typeof answer.model_id !== 'string' || answer.model_id.length < 1 || answer.model_id.length > 80
      || !['low', 'medium', 'high', 'xhigh'].includes(String(answer.reasoning_effort))) {
      return jsonResponseWithCors({ error: 'Respuesta de supervisor inválida.' }, 400, origin);
    }
  } else if (body.operation === 'post_submit_observations') {
    if (!isPostSubmitObservations(body.data)) {
      return jsonResponseWithCors({ error: 'Observaciones posteriores al envío inválidas.' }, 400, origin);
    }
  } else if (Object.keys(body.data).some((key) => key !== 'error')
    || typeof body.data.error !== 'string' || body.data.error.length > 500) {
    return jsonResponseWithCors({ error: 'Respuesta de supervisor inválida.' }, 400, origin);
  }

  const { data, error } = await serviceClient.rpc('fb_supervisor_worker', {
    p_owner: ownerUid,
    p_worker: workerId,
    p_operation: body.operation,
    p_id: body.id,
    p_data: body.data,
  });
  if (error) return jsonResponseWithCors({ error: 'No se pudo guardar la respuesta del supervisor.' }, 409, origin);
  return jsonResponseWithCors(data as Record<string, unknown>, 200, origin);
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponseWithCors({ error: 'Origen no permitido.' }, 403, origin);
  }
  if (req.method === 'OPTIONS') return jsonResponseWithCors({}, 204, origin);
  if (req.method !== 'POST') return jsonResponseWithCors({ error: 'Método no permitido.' }, 405, origin);
  if (!configured()) return jsonResponseWithCors({ error: 'El servicio de automatización no está configurado.' }, 503, origin);

  const body = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!body) return jsonResponseWithCors({ error: 'Solicitud inválida o demasiado grande.' }, 413, origin);
  if (body.action !== 'trace_start' && body.action !== 'trace_step'
    && body.action !== 'trace_finish' && body.action !== 'trace_signed_urls'
    && body.action !== 'supervisor_worker') {
    return jsonResponseWithCors({ error: 'Operación no permitida.' }, 400, origin);
  }

  const authorization = req.headers.get('authorization') ?? '';
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createSupabaseApiKeyFetch(SUPABASE_ADMIN_KEY, fetch, {
      supabaseUrl: SUPABASE_URL,
      legacyServiceRoleJwt: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    }) },
  });

  if (body.action === 'supervisor_worker') return await supervisorWorker(body, req, serviceClient, origin);

  if (body.action === 'trace_signed_urls') {
    if (!authorization.startsWith('Bearer ') || bearerToken(req).length < 20) {
      return jsonResponseWithCors({ error: 'No autenticado.' }, 401, origin);
    }
    return await signedUrls(body, authorization, serviceClient, origin);
  }

  const identity: DeviceIdentity | null = await authorizeFacebookDevice(bearerToken(req), serviceClient);
  if (!identity) return jsonResponseWithCors({ error: 'Conexión de Facebook vencida o revocada.' }, 401, origin);

  try {
    if (body.action === 'trace_start') {
      if (!['real', 'rehearsal'].includes(String(body.mode))
        || !['marketplace', 'group_direct'].includes(String(body.mechanism))
        || typeof body.extension_version !== 'string' || body.extension_version.length < 1 || body.extension_version.length > 40
        || !validSummary(body.summary ?? {})) {
        return jsonResponseWithCors({ error: 'Datos de inicio de traza inválidos.' }, 400, origin);
      }
      const deliveryId = body.delivery_id ?? null;
      const attemptId = body.attempt_id ?? null;
      const rehearsalId = body.rehearsal_id ?? null;
      if (body.mode === 'real' && (!isUuid(deliveryId) || !isUuid(attemptId))) {
        return jsonResponseWithCors({ error: 'La traza real requiere un envío e intento válidos.' }, 400, origin);
      }
      if (body.mode === 'real' && rehearsalId !== null) {
        return jsonResponseWithCors({ error: 'La traza real no puede vincularse a un ensayo.' }, 400, origin);
      }
      if (body.mode === 'rehearsal' && (deliveryId !== null || attemptId !== null || !isUuid(rehearsalId))) {
        return jsonResponseWithCors({ error: 'El ensayo no puede vincularse a un envío real.' }, 400, origin);
      }
      const { data, error } = body.mode === 'rehearsal'
        ? await serviceClient.rpc('fb_trace_start_for_rehearsal', {
          p_user_id: identity.ownerUid,
          p_device_id: identity.deviceId,
          p_rehearsal_id: rehearsalId,
          p_mechanism: body.mechanism,
          p_extension_version: body.extension_version,
          p_summary: body.summary ?? {},
        })
        : await serviceClient.rpc('fb_trace_start', {
          p_user_id: identity.ownerUid,
          p_device_id: identity.deviceId,
          p_delivery_id: deliveryId,
          p_attempt_id: attemptId,
          p_mode: body.mode,
          p_mechanism: body.mechanism,
          p_extension_version: body.extension_version,
          p_summary: body.summary ?? {},
        });
      if (error || !isUuid(data)) return errorResponse(undefined, origin);
      await cleanupExpiredTraces(serviceClient);
      return jsonResponseWithCors({ trace_id: data }, 201, origin);
    }

    if (body.action === 'trace_step') {
      if (!isUuid(body.trace_id) || !isInteger(body.seq, 1, 10000)
        || typeof body.step !== 'string' || body.step.length < 1 || body.step.length > 160
        || !['ok', 'retry', 'failed', 'supervised'].includes(String(body.status))
        || !isInteger(body.elapsed_ms, 0, 86_400_000)
        || !validSummary(body.dom_summary ?? {})
        || (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > 500))) {
        return jsonResponseWithCors({ error: 'Datos del paso de traza inválidos.' }, 400, origin);
      }

      let screenshotPath: string | null = null;
      let note = typeof body.note === 'string' ? body.note : null;
      if (body.screenshot_base64 !== undefined && body.screenshot_base64 !== null) {
        const jpeg = decodeJpeg(body.screenshot_base64);
        if (!jpeg) return jsonResponseWithCors({ error: 'La captura debe ser JPEG válido de hasta 600 KB.' }, 400, origin);
        const objectPath = `${identity.ownerUid}/${body.trace_id}/${body.seq}.jpg`;
        const { data: reserved, error: reserveError } = await serviceClient.rpc('fb_trace_storage_reserve', {
          p_user_id: identity.ownerUid,
          p_trace_id: body.trace_id,
          p_storage_path: objectPath,
          p_file_size: jpeg.byteLength,
        });
        if (!reserveError && reserved === true) {
          const { error: uploadError } = await serviceClient.storage.from(TRACE_BUCKET).upload(objectPath, jpeg, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false,
          });
          if (!uploadError) {
            screenshotPath = objectPath;
          } else {
            const { error: removeError } = await serviceClient.storage.from(TRACE_BUCKET).remove([objectPath]);
            if (!removeError) {
              await serviceClient.rpc('fb_trace_storage_release', {
                p_user_id: identity.ownerUid,
                p_storage_path: objectPath,
              });
            } else {
              console.error('[automation] Screenshot cleanup failed.');
            }
            note = [note, 'No se pudo guardar la captura.'].filter(Boolean).join(' ').slice(0, 500);
          }
        } else {
          note = [note, reserveError ? 'No se pudo guardar la captura.' : 'Captura omitida por cuota de almacenamiento.']
            .filter(Boolean).join(' ').slice(0, 500);
        }
      }

      const { data, error } = await serviceClient.rpc('fb_trace_add_step', {
        p_user_id: identity.ownerUid,
        p_trace_id: body.trace_id,
        p_seq: body.seq,
        p_step: body.step,
        p_status: body.status,
        p_elapsed_ms: body.elapsed_ms,
        p_dom_summary: body.dom_summary ?? {},
        p_screenshot_path: screenshotPath,
        p_note: note,
      });
      if (error || !isUuid(data)) {
        if (screenshotPath) {
          const { error: removeError } = await serviceClient.storage.from(TRACE_BUCKET).remove([screenshotPath]);
          if (!removeError) {
            await serviceClient.rpc('fb_trace_storage_release', {
              p_user_id: identity.ownerUid,
              p_storage_path: screenshotPath,
            });
          } else {
            console.error('[automation] Screenshot cleanup failed.');
          }
        }
        return errorResponse(undefined, origin);
      }
      if (screenshotPath) {
        await serviceClient.rpc('fb_trace_storage_release', {
          p_user_id: identity.ownerUid,
          p_storage_path: screenshotPath,
        });
      }
      return jsonResponseWithCors({ step_id: data, screenshot_saved: screenshotPath !== null, note }, 201, origin);
    }

    if (!isUuid(body.trace_id) || !['completed', 'aborted', 'failed', 'rehearsal_ok'].includes(String(body.outcome))
      || !validSummary(body.summary ?? {})) {
      return jsonResponseWithCors({ error: 'Datos de cierre de traza inválidos.' }, 400, origin);
    }
    const { error } = await serviceClient.rpc('fb_trace_finish', {
      p_user_id: identity.ownerUid,
      p_trace_id: body.trace_id,
      p_outcome: body.outcome,
      p_summary: body.summary ?? {},
    });
    if (error) return errorResponse(undefined, origin);
    return jsonResponseWithCors({ finished: true }, 200, origin);
  } catch {
    console.error('[automation] Trace operation failed.');
    return errorResponse(undefined, origin);
  }
});
