import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function readJsonLimited(req: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > maxBytes || !req.body) return null;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function authorizeWorker(
  req: Request,
  body: Record<string, unknown>,
  serviceClient: SupabaseClient,
): Promise<string | null> {
  if (!isUuid(body.worker_id)) return null;
  const authorization = req.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (token.length < 32 || token.length > 256) return null;

  try {
    const { data, error } = await serviceClient.rpc('ai_bridge_authorize_device', {
      p_device_id: body.worker_id,
      p_token: token,
    });
    return !error && isUuid(data) ? data : null;
  } catch {
    return null;
  }
}
