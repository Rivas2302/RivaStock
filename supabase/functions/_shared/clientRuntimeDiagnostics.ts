const allowedOrigins = new Set([
  'https://rivastock.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]);

function headers(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : 'https://rivastock.vercel.app';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleClientRuntimeDiagnostics(request: Request): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(origin) });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
  if (!origin || !allowedOrigins.has(origin)) return json({ error: 'origin_not_allowed' }, 403, origin);
  if (Number(request.headers.get('Content-Length') ?? 0) > 2_048) return json({ error: 'payload_too_large' }, 413, origin);

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 2_048) return json({ error: 'payload_too_large' }, 413, origin);
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return json({ error: 'invalid_payload' }, 400, origin);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_payload' }, 400, origin);

  const input = body as Record<string, unknown>;
  const allowedKeys = ['event', 'moduleId', 'clientBuildId', 'currentBuildId', 'recovered', 'failureKind'];
  const moduleId = String(input.moduleId ?? '');
  const clientBuildId = String(input.clientBuildId ?? '');
  const currentBuildId = input.currentBuildId === null ? null : String(input.currentBuildId ?? '');
  const failureKind = String(input.failureKind ?? '');
  if (Object.keys(input).length !== allowedKeys.length
    || Object.keys(input).some((key) => !allowedKeys.includes(key))
    || input.event !== 'lazy_chunk_failure'
    || !/^[a-z0-9_./-]{1,120}$/i.test(moduleId)
    || !/^[a-z0-9._-]{1,80}$/i.test(clientBuildId)
    || (currentBuildId !== null && !/^[a-z0-9._-]{1,80}$/i.test(currentBuildId))
    || typeof input.recovered !== 'boolean'
    || !['network', 'preload', 'offline'].includes(failureKind)) {
    return json({ error: 'invalid_payload' }, 400, origin);
  }

  console.warn(JSON.stringify({
    event: 'lazy_chunk_failure',
    module_id: moduleId,
    client_build: clientBuildId,
    current_build: currentBuildId,
    recovered: input.recovered,
    failure_kind: failureKind,
  }));
  return json({ recorded: true }, 202, origin);
}
