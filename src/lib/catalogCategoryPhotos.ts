import type { PublicCatalogProduct } from '../types';

function firstPhoto(product: Pick<PublicCatalogProduct, 'images' | 'imageUrl'>): string | undefined {
  return product.images?.find(Boolean) ?? product.imageUrl ?? undefined;
}

export function getCategoryPhotoUrls(
  categoryId: string,
  products: PublicCatalogProduct[],
  overrideUrl?: string | null,
  enabled = true,
): string[] {
  if (!enabled) return [];
  if (overrideUrl) return [overrideUrl];
  const firstVisibleProduct = products.find(product => product.categoryId === categoryId && firstPhoto(product));
  const url = firstVisibleProduct && firstPhoto(firstVisibleProduct);
  return url ? [url] : [];
}

export function getAllCategoryPhotoUrls(products: PublicCatalogProduct[], limit = 4): string[] {
  const photos: string[] = [];
  for (const product of products) {
    const url = firstPhoto(product);
    if (url && !photos.includes(url)) photos.push(url);
    if (photos.length === limit) break;
  }
  return photos;
}
