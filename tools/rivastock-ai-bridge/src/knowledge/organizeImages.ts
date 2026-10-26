import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface RemoteOrganizeImage {
  id: string;
  url: string;
  mime_type: string;
}

export interface LocalOrganizeImage {
  id: string;
  path: string;
}

export async function withDownloadedOrganizeImages<T>(
  remoteImages: RemoteOrganizeImage[],
  execute: (images: LocalOrganizeImage[], missingInformation: string[]) => Promise<T>,
  options: { jobId?: string; temporaryRoot?: string; fetchImage?: typeof fetch } = {},
): Promise<T> {
  const jobLabel = options.jobId?.replace(/[^0-9a-z-]/gi, '').slice(0, 36) || 'job';
  const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), `rivastock-organize-${jobLabel}-`));
  const images: LocalOrganizeImage[] = [];
  const missingInformation: string[] = [];
  const fetchImage = options.fetchImage ?? fetch;

  try {
    for (const image of remoteImages.slice(0, MAX_IMAGES)) {
      const extension = extensionForMimeType(image.mime_type);
      try {
        if (!/^IMG\d{1,3}$/.test(image.id) || !extension || !/^https:\/\//i.test(image.url)) {
          throw new Error('Invalid image descriptor.');
        }
        const response = await fetchImage(image.url, { signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS) });
        if (!response.ok) throw new Error('Image download failed.');
        const declaredLength = Number(response.headers.get('content-length') ?? '0');
        if (declaredLength > MAX_IMAGE_BYTES) throw new Error('Image exceeds the size limit.');
        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
        if (contentType && contentType !== image.mime_type) throw new Error('Image MIME type mismatch.');
        const bytes = await readBoundedImage(response);
        if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the size limit.');
        const path = join(directory, `${image.id}${extension}`);
        await writeFile(path, bytes, { flag: 'wx' });
        images.push({ id: image.id, path });
      } catch {
        missingInformation.push(`No se pudo cargar la captura ${image.id} para que la IA la analice.`);
      }
    }
    return await execute(images, missingInformation);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readBoundedImage(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error('Image response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Image exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function extensionForMimeType(mimeType: string): string | null {
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  return null;
}

