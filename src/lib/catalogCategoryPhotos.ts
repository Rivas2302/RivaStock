import type { Product, PublicCatalogProduct } from '../types';

type CategoryPhotoProduct = Pick<Product, 'categoryId' | 'images' | 'imageUrl'>;

function firstPhoto(product: Pick<PublicCatalogProduct, 'images' | 'imageUrl'>): string | undefined {
  return product.images?.find(Boolean) ?? product.imageUrl ?? undefined;
}

export function getCategoryPhotoUrls(
  categoryId: string,
  products: Array<Pick<PublicCatalogProduct, 'categoryId' | 'images' | 'imageUrl'>>,
  overrideUrl?: string | null,
  enabled = true,
): string[] {
  if (!enabled) return [];
  if (overrideUrl) return [overrideUrl];
  const firstVisibleProduct = products.find(product => product.categoryId === categoryId && firstPhoto(product));
  const url = firstVisibleProduct && firstPhoto(firstVisibleProduct);
  return url ? [url] : [];
}

export function getAllCategoryPhotoUrls(
  products: CategoryPhotoProduct[],
  limit = 4,
  overrideUrl?: string | null,
  enabled = true,
): string[] {
  if (!enabled) return [];
  if (overrideUrl) return [overrideUrl];
  const photos: string[] = [];
  for (const product of products) {
    const url = firstPhoto(product);
    if (url && !photos.includes(url)) photos.push(url);
    if (photos.length === limit) break;
  }
  return photos;
}
