const allowedOrigins = new Set([
  'https://rivastock.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]);

const stages = new Set([
  'validate', 'compress_original', 'compress_thumbnail', 'check_storage', 'upload_original', 'upload_thumbnail',
]);
const reasons = new Set([
  'no_permission', 'no_space', 'suspended', 'unsupported_format', 'no_connection', 'photo_too_large',
  'read_failed', 'compression_failed', 'server_error',
]);
const imageTypes = new Set(['jpeg', 'png', 'webp', 'heic', 'avif', 'other']);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : 'https://rivastock.vercel.app';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function response(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function verifiedSubject(request: Request): string | null {
  // The Supabase Edge gateway verifies the JWT before invoking this function.
  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return null;

  try {
    const encoded = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    const payload = JSON.parse(decoded) as { sub?: unknown; role?: unknown };
    if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') return null;
    return /^[0-9a-f-]{36}$/i.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

async function anonymizedAccountRef(subject: string): Promise<string> {
  const bytes = new TextEncoder().encode(subject);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405, origin);

  const subject = verifiedSubject(request);
  if (!subject) return response({ error: 'authenticated_user_required' }, 401, origin);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ error: 'invalid_payload' }, 400, origin);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return response({ error: 'invalid_payload' }, 400, origin);

  const input = body as Record<string, unknown>;
  const sizeBytes = Number(input.sizeBytes);
  if (!stages.has(String(input.stage)) || !reasons.has(String(input.reason)) || !imageTypes.has(String(input.imageType))
    || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > 50 * 1024 * 1024 || typeof input.online !== 'boolean') {
    return response({ error: 'invalid_payload' }, 400, origin);
  }

  const event = {
    event: 'product_photo_upload_failure',
    account_ref: await anonymizedAccountRef(subject),
    stage: input.stage,
    reason: input.reason,
    image_type: input.imageType,
    size_bytes: sizeBytes,
    online: input.online,
  };
  console.warn(JSON.stringify(event));
  return response({ recorded: true }, 202, origin);
});
