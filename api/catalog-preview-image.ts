import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { isPublicCatalogAssetUrl } from '../src/lib/catalogPreview';

const SUPABASE_URL = 'https://nkfqhuqrgrpfufdymkcr.supabase.co';
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;

function sendError(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
  });
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

export async function handleCatalogPreviewImageRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  const sourceUrl = new URL(request.url).searchParams.get('source') ?? '';
  if (!sourceUrl || !isPublicCatalogAssetUrl(sourceUrl, SUPABASE_URL)) {
    return sendError(400, 'Invalid image source');
  }

  try {
    const sourceResponse = await fetch(sourceUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'image/jpeg,image/png,image/webp,image/avif' },
    });
    if (!sourceResponse.ok) return sendError(404, 'Image not found');
    const contentType = sourceResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(contentType ?? '')) {
      return sendError(415, 'Unsupported image format');
    }
    const declaredSize = Number(sourceResponse.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_SOURCE_BYTES) {
      return sendError(413, 'Image exceeds the source size limit');
    }
    const source = await readLimitedBody(sourceResponse);
    const jpeg = await transformCatalogPreviewImage(source);
    const digest = createHash('sha256').update(jpeg).digest('hex');
    const headers = new Headers({
      'content-type': 'image/jpeg',
      'content-length': String(jpeg.byteLength),
      'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      etag: '"' + digest + '"',
    });
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(jpeg), {
      status: 200,
      headers,
    });
  } catch {
    return sendError(415, 'Image could not be converted');
  }
}

export const GET = handleCatalogPreviewImageRequest;
export const HEAD = handleCatalogPreviewImageRequest;
