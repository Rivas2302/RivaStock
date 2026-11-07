import {
  assertPublicDns,
  createInMemoryRateLimiter,
  extractVisibleSupplierText,
  readLimitedResponseText,
  SUPPLIER_PAGE_MAX_BYTES,
  validateSupplierPageUrl,
} from '../_shared/supplierUrlProxy.ts';

const ALLOWED_ORIGINS = new Set(['https://rivastock.vercel.app', 'http://localhost:5173']);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 8;
const FETCH_TIMEOUT_MS = 10_000;
const rateLimit = createInMemoryRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
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
  return new Response(JSON.stringify(body), { status, headers });
}

async function getRateKey(request: Request): Promise<string> {
  const forwarded = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(forwarded));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
    } });
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: 'Origen no permitido.' }, 403, origin);

  const rateKey = await getRateKey(request);
  if (!rateLimit(rateKey)) {
    const response = jsonResponse({ error: 'Llegaste al límite de consultas. Probá de nuevo en un minuto.' }, 429, origin);
    response.headers.set('Retry-After', '60');
    return response;
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return jsonResponse({ error: 'El enlace supera el máximo permitido.' }, 400, origin);
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: 'Enviá un enlace HTTPS válido.' }, 400, origin);
  }

  const rawUrl = (body as { url?: unknown } | null)?.url;
  if (typeof rawUrl !== 'string') return jsonResponse({ error: 'Enviá un enlace HTTPS válido.' }, 400, origin);

  let url: URL;
  try {
    url = validateSupplierPageUrl(rawUrl);
    const dnsCheck = assertPublicDns(url.hostname, (hostname, type) => Deno.resolveDns(hostname, type));
    const dnsTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 4_000));
    await Promise.race([dnsCheck, dnsTimeout]);
  } catch {
    return jsonResponse({ error: 'El enlace debe apuntar a un sitio HTTPS público y disponible.' }, 422, origin);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'text/html,text/plain,text/csv;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
  } catch {
    return jsonResponse({ error: 'No pudimos leer ese sitio. Probá con otra dirección o subí una captura o planilla.' }, 502, origin);
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return jsonResponse({ error: 'El sitio redirige. Pegá la dirección final que empieza con HTTPS.' }, 422, origin);
  }
  if (!response.ok) {
    await response.body?.cancel();
    return jsonResponse({ error: 'El sitio no permitió la lectura. Podés subir una captura o planilla.' }, 422, origin);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!/^(text\/html|text\/plain|text\/csv)(?:\s*;|$)/i.test(contentType)) {
    await response.body?.cancel();
    return jsonResponse({ error: 'El enlace no devolvió una página o texto compatible.' }, 415, origin);
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > SUPPLIER_PAGE_MAX_BYTES) {
    await response.body?.cancel();
    return jsonResponse({ error: 'La página supera el límite de 2 MB.' }, 413, origin);
  }

  try {
    const source = await readLimitedResponseText(response);
    const text = extractVisibleSupplierText(source, contentType);
    if (text.replace(/\s/g, '').length < 2) {
      return jsonResponse({ error: 'No encontramos texto para revisar en esa página.' }, 422, origin);
    }
    return jsonResponse({ text }, 200, origin);
  } catch (error) {
    if (error instanceof Error && error.message.includes('2 MB')) {
      return jsonResponse({ error: 'La página supera el límite de 2 MB.' }, 413, origin);
    }
    return jsonResponse({ error: 'No pudimos procesar el contenido del sitio.' }, 422, origin);
  }
});
