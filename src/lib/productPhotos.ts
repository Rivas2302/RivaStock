import type { Product } from '../types';

export const PRODUCT_PHOTO_CACHE_CONTROL = '31536000';

export function getProductPhotoUrls(product: Pick<Product, 'images' | 'imageUrl'>): string[] {
  return [...new Set([...(product.images ?? []), product.imageUrl ?? ''].filter(Boolean))];
}

function isProjectStorageUrl(url: URL, projectUrl: string): boolean {
  try {
    const project = new URL(projectUrl);
    return url.host.toLowerCase() === project.host.toLowerCase()
      && url.pathname.startsWith('/storage/v1/object/');
  } catch {
    return false;
  }
}

function isProjectStoragePhotoUrl(value: string, projectUrl: string): boolean {
  try {
    return isProjectStorageUrl(new URL(value), projectUrl);
  } catch {
    return false;
  }
}

export function normalizeProductStoragePhotoUrl(value: string, projectUrl: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' && isProjectStorageUrl(url, projectUrl)) {
      url.protocol = 'https:';
      return url.toString();
    }
  } catch {
    // Keep non-URL values, including data URLs, unchanged for the caller to handle.
  }
  return trimmed;
}

function productPhotoIdentity(value: string, projectUrl: string): string {
  try {
    const url = new URL(value);
    if (!isProjectStorageUrl(url, projectUrl)) return value;
    const path = url.pathname
      .replace(/\.thumb(?=\.[^./]+$)/i, '')
      .replace(/\.(?:avif|gif|jpe?g|png|webp)$/i, '');
    return `${url.host.toLowerCase()}${path}`;
  } catch {
    return value;
  }
}

function isStorageThumbnail(value: string, projectUrl: string): boolean {
  try {
    const url = new URL(value);
    return isProjectStorageUrl(url, projectUrl) && /\.thumb\.[^./]+$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Builds the list used by “Buscar y enviar”. `images` is the canonical photo
 * collection; a legacy Storage URL is merged and deduplicated, while a legacy
 * inline/external value is only used when `images` has no usable photos.
 */
export function getProductPhotoUrlsForSharing(
  product: Pick<Product, 'images' | 'imageUrl'>,
  projectUrl: string,
): string[] {
  const images = (product.images ?? [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const legacyImageUrl = typeof product.imageUrl === 'string' ? product.imageUrl.trim() : '';
  const candidates = images.length > 0
    ? [...images, ...(legacyImageUrl && isProjectStoragePhotoUrl(legacyImageUrl, projectUrl) ? [legacyImageUrl] : [])]
    : [legacyImageUrl].filter(Boolean);
  const urls: string[] = [];
  const indices = new Map<string, number>();

  for (const candidate of candidates) {
    const url = normalizeProductStoragePhotoUrl(candidate, projectUrl);
    const identity = productPhotoIdentity(url, projectUrl);
    const existingIndex = indices.get(identity);
    if (existingIndex === undefined) {
      indices.set(identity, urls.length);
      urls.push(url);
      continue;
    }
    if (isStorageThumbnail(urls[existingIndex], projectUrl) && !isStorageThumbnail(url, projectUrl)) {
      urls[existingIndex] = url;
    }
  }

  return urls;
}

export function getProductPhotoStorageUrls(product: Pick<Product, 'images' | 'imageUrl'>): string[] {
  return [...new Set(getProductPhotoUrls(product).flatMap((url) => [url, getProductThumbnailUrl(url)]))];
}

export function getProductThumbnailPath(path: string): string {
  if (path.endsWith('.thumb.webp')) return path;
  return path.replace(/\.[^./]+$/, '.thumb.webp');
}

export function getProductThumbnailUrl(url: string): string {
  if (url.includes('.thumb.webp')) return url;
  return url.replace(/\.[^./?#]+(?=[?#]|$)/, '.thumb.webp');
}

export function readStoredString(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function readStoredIds(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeStoredIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Favorites and recents are convenience data; the feature works without storage.
  }
}
