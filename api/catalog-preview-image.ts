import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import sharp from 'sharp';
import { isPublicCatalogAssetUrl } from '../src/lib/catalogPreview';

interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>;
}

const SUPABASE_URL = 'https://nkfqhuqrgrpfufdymkcr.supabase.co';
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;

function queryString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(message);
}

async function readLimitedBody(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error('Image response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error('Image exceeds the source size limit');
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}

export async function transformCatalogPreviewImage(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(1200, 630, { fit: 'contain', background: '#ffffff' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendError(res, 405, 'Method not allowed');
    return;
  }
  const sourceUrl = queryString(req.query.source);
  if (!sourceUrl || !isPublicCatalogAssetUrl(sourceUrl, SUPABASE_URL)) {
    sendError(res, 400, 'Invalid image source');
    return;
  }

  try {
    const sourceResponse = await fetch(sourceUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'image/jpeg,image/png,image/webp,image/avif' },
    });
    if (!sourceResponse.ok) {
      sendError(res, 404, 'Image not found');
      return;
    }
    const contentType = sourceResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(contentType ?? '')) {
      sendError(res, 415, 'Unsupported image format');
      return;
    }
    const declaredSize = Number(sourceResponse.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_SOURCE_BYTES) {
      sendError(res, 413, 'Image exceeds the source size limit');
      return;
    }
    const source = await readLimitedBody(sourceResponse);
    const jpeg = await transformCatalogPreviewImage(source);
    const digest = createHash('sha256').update(jpeg).digest('hex');
    res.statusCode = 200;
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('content-length', String(jpeg.byteLength));
    res.setHeader('cache-control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('etag', '"' + digest + '"');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(jpeg);
  } catch {
    sendError(res, 415, 'Image could not be converted');
  }
}
