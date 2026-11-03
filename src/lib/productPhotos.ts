import type { Product } from '../types';

export function getProductPhotoUrls(product: Pick<Product, 'images' | 'imageUrl'>): string[] {
  return [...new Set([...(product.images ?? []), product.imageUrl ?? ''].filter(Boolean))];
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
