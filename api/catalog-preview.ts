import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCatalogPreviewResponse } from '../src/lib/catalogPreview';
import { SUPABASE_PUBLISHABLE_KEY } from '../src/lib/supabasePublicConfig';

interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>;
}

const SUPABASE_URL = 'https://nkfqhuqrgrpfufdymkcr.supabase.co';
const PRODUCTION_ORIGIN = 'https://rivastock.vercel.app';

function queryString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getOrigin(req: VercelRequest): string {
  if (process.env.VERCEL_ENV === 'production') return PRODUCTION_ORIGIN;
  if (process.env.VERCEL_URL) return 'https://' + process.env.VERCEL_URL;
  const host = req.headers.host || 'localhost:3000';
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return protocol + '://' + host;
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method not allowed');
    return;
  }

  try {
    const indexHtml = await readFile(resolve(process.cwd(), 'dist', 'index.html'), 'utf8');
    const response = await createCatalogPreviewResponse({
      slug: queryString(req.query.slug) ?? '',
      productId: queryString(req.query.productId),
      origin: getOrigin(req),
      supabaseUrl: SUPABASE_URL,
      publishableKey: SUPABASE_PUBLISHABLE_KEY,
      indexHtml,
    });
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(await response.text());
  } catch {
    res.statusCode = 500;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Preview unavailable');
  }
}
