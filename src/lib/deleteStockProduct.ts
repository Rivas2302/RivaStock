import { db, deleteFromStorage } from './db';
import { failedStorageCleanupPaths } from './storageCleanup';
import { getProductPhotoStorageUrls } from './productPhotos';
import type { Product } from '../types';

export async function deleteStockProduct(product: Product, onDeleted: () => void): Promise<string[]> {
  await db.delete('products', product.id);
  onDeleted();
  const storageUrls = getProductPhotoStorageUrls(product);
  const results = await Promise.allSettled(storageUrls.map((url) => deleteFromStorage(url)));
  return failedStorageCleanupPaths(storageUrls, results);
}
