import type { Product } from '../types';

export function getSupplierCatalogImageUrl(rawImageUrl: string | null | undefined, supplierUrl: string): string | null {
  if (!rawImageUrl) return null;
  try {
    const imageUrl = new URL(rawImageUrl);
    const sourceUrl = new URL(supplierUrl);
    if (imageUrl.protocol !== 'https:' || imageUrl.origin !== sourceUrl.origin || imageUrl.username || imageUrl.password) return null;
    return imageUrl.href;
  } catch {
    return null;
  }
}

export function hasProductPhoto(product: Pick<Product, 'imageUrl' | 'images'> | null | undefined): boolean {
  return Boolean(product && ([product.imageUrl, ...(product.images ?? [])].some(url => typeof url === 'string' && url.trim())));
}

export function isSupplierManagedPhotoUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return /\/products\/[^/]+\/supplier-[a-f0-9]{64}(?:\.thumb)?\.webp$/i.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

export function isLegacySupplierPhotoUrl(rawUrl: string | null | undefined, supplierUrl: string): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    const source = new URL(supplierUrl);
    return url.protocol === 'https:' && url.origin === source.origin;
  } catch {
    return false;
  }
}

export function shouldReplaceWithSupplierPhoto(product: Product | null | undefined, supplierUrl: string): boolean {
  if (!product || !hasProductPhoto(product)) return true;
  const currentUrls = [product.imageUrl, ...(product.images ?? [])].filter((url): url is string => Boolean(url));
  return currentUrls.every(url => isSupplierManagedPhotoUrl(url) || isLegacySupplierPhotoUrl(url, supplierUrl));
}

export function withImportedProductPhoto(product: Product, photoUrl: string, supplierUrl?: string, makePrimary = false): Product {
  const isProviderPhoto = (value: string) => isSupplierManagedPhotoUrl(value)
    || Boolean(supplierUrl && isLegacySupplierPhotoUrl(value, supplierUrl));
  const currentImages = product.images ?? [];
  const imageUrlIsProvider = Boolean(product.imageUrl && isProviderPhoto(product.imageUrl));
  const hasProviderImage = imageUrlIsProvider || currentImages.some(isProviderPhoto);
  const images = currentImages.map(url => isProviderPhoto(url) ? photoUrl : url);
  if (!hasProviderImage) images.unshift(photoUrl);
  else if (!images.includes(photoUrl)) images.push(photoUrl);
  if (makePrimary && product.imageUrl && product.imageUrl !== photoUrl && !images.includes(product.imageUrl)) images.push(product.imageUrl);
  return {
    ...product,
    imageUrl: makePrimary || !product.imageUrl || imageUrlIsProvider ? photoUrl : product.imageUrl,
    images: Array.from(new Set(images)),
  };
}
