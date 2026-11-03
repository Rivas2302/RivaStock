import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCatalogPreviewResponse } from '../src/lib/catalogPreview';
import { SUPABASE_PUBLISHABLE_KEY } from '../src/lib/supabasePublicConfig';

const SUPABASE_URL = 'https://nkfqhuqrgrpfufdymkcr.supabase.co';
const PRODUCTION_ORIGIN = 'https://rivastock.vercel.app';

function getOrigin(request: Request): string {
  if (process.env.VERCEL_ENV === 'production') return PRODUCTION_ORIGIN;
  if (process.env.VERCEL_URL) return 'https://' + process.env.VERCEL_URL;
  return new URL(request.url).origin;
}

export async function handleCatalogPreviewRequest(request: Request, indexHtmlOverride?: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }

  try {
    const requestUrl = new URL(request.url);
    const indexHtml = indexHtmlOverride ?? await readFile(resolve(process.cwd(), 'dist', 'index.html'), 'utf8');
    const response = await createCatalogPreviewResponse({
      slug: requestUrl.searchParams.get('slug') ?? '',
      productId: requestUrl.searchParams.get('productId') ?? undefined,
      origin: getOrigin(request),
      supabaseUrl: SUPABASE_URL,
      publishableKey: SUPABASE_PUBLISHABLE_KEY,
      indexHtml,
    });
    return request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  } catch {
    return new Response('Preview unavailable', {
      status: 500,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

export default {
  fetch: handleCatalogPreviewRequest,
};
