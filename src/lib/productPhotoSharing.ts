import { optimizeUploadImage } from './imageOptimization';

export interface SharePhotoEntry {
  productName: string;
  imageUrls: string[];
}

export interface ShareTextEntry {
  productName: string;
  priceText: string;
  catalogUrl?: string | null;
}

export interface FileShareNavigator {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; text: string }) => Promise<void>;
}

export interface TextClipboard {
  writeText: (text: string) => Promise<void>;
}

export interface ProductPhotoFilesResult {
  files: File[];
  failedCount: number;
}

export type FileShareResult = 'shared' | 'unsupported' | 'clipboard-failed' | 'cancelled' | 'failed';

export function createProductPhotoShareText(entries: ShareTextEntry[]): string {
  return entries.map(({ productName, priceText, catalogUrl }) => (
    `${productName} — ${priceText}${catalogUrl ? ` — ${catalogUrl}` : ''}`
  )).join('\n');
}

export function isFileSharingSupported(
  navigatorApi: FileShareNavigator,
  files: File[],
): boolean {
  if (files.length === 0 || typeof navigatorApi.canShare !== 'function') return false;
  try {
    return navigatorApi.canShare({ files });
  } catch {
    return false;
  }
}

function safeFilenameStem(value: string): string {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'producto';
}

function imageMimeFromUrl(url: string): string | null {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.png')) return 'image/png';
  return null;
}

function blobFromDataUrl(value: string): Blob {
  const separator = value.indexOf(',');
  if (separator < 0) throw new Error('Invalid data URL');
  const metadata = value.slice(5, separator);
  const mediaType = metadata.split(';', 1)[0] || 'text/plain';
  const payload = value.slice(separator + 1);
  if (/;base64(?:;|$)/i.test(metadata)) {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: mediaType });
  }
  return new Blob([new TextEncoder().encode(decodeURIComponent(payload))], { type: mediaType });
}

async function normalizeShareImage(blob: Blob, url: string): Promise<{ blob: Blob; extension: 'webp' | 'jpg' }> {
  const contentType = blob.type || imageMimeFromUrl(url) || '';
  if (contentType === 'image/webp') return { blob, extension: 'webp' };
  if (contentType === 'image/jpeg' || contentType === 'image/jpg') return { blob, extension: 'jpg' };
  if (contentType === 'image/png') {
    const source = new File([blob], 'product-photo.png', { type: 'image/png' });
    const converted = await optimizeUploadImage(source, 1600, { forceWebP: true });
    if (converted.type !== 'image/webp') throw new Error('No se pudo convertir la imagen PNG a WebP.');
    return { blob: converted, extension: 'webp' };
  }
  throw new Error('El formato de una imagen no se puede compartir desde este navegador.');
}

export async function fetchProductPhotoFiles(
  entries: SharePhotoEntry[],
  fetchImage: typeof fetch = fetch,
): Promise<ProductPhotoFilesResult> {
  const files: File[] = [];
  let failedCount = 0;
  for (const entry of entries) {
    for (const [imageIndex, imageUrl] of entry.imageUrls.entries()) {
      try {
        const blob = imageUrl.trim().toLowerCase().startsWith('data:')
          ? blobFromDataUrl(imageUrl)
          : await (async () => {
            const response = await fetchImage(imageUrl);
            if (!response.ok) throw new Error('Photo request failed');
            return response.blob();
          })();
        const normalized = await normalizeShareImage(await blob, imageUrl);
        files.push(new File(
          [normalized.blob],
          `${safeFilenameStem(entry.productName)}-${imageIndex + 1}.${normalized.extension}`,
          { type: normalized.blob.type },
        ));
      } catch {
        failedCount += 1;
      }
    }
  }
  return { files, failedCount };
}

export async function copyThenShareProductPhotos(
  text: string,
  files: File[],
  navigatorApi: FileShareNavigator,
  clipboard: TextClipboard,
  onCopied?: () => void,
): Promise<FileShareResult> {
  if (!isFileSharingSupported(navigatorApi, files) || !navigatorApi.share) return 'unsupported';
  try {
    await clipboard.writeText(text);
    onCopied?.();
  } catch {
    return 'clipboard-failed';
  }
  try {
    await navigatorApi.share({ files, text });
    return 'shared';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}
