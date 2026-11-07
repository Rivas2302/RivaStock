import { deleteFromStorage, uploadToStorage } from './db';
import { assertStorageUploadAllowed } from './platformStorage';
import { imageFileExtension, optimizeSupplierCatalogPhoto, optimizeSupplierCatalogThumbnail, optimizeUploadImage } from './imageOptimization';
import { getProductThumbnailPath, PRODUCT_PHOTO_CACHE_CONTROL } from './productPhotos';

export async function uploadSupplierListProductPhoto(file: File, ownerUid: string, productId: string): Promise<string> {
  if (!file.type.startsWith('image/') || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('La foto debe ser una imagen de hasta 10 MB.');
  }
  const original = await optimizeUploadImage(file, 1600, { forceWebP: true });
  const thumbnail = await optimizeUploadImage(original, 480, { forceWebP: true });
  if (original.type !== 'image/webp' || thumbnail.type !== 'image/webp') {
    throw new Error('Este navegador no pudo preparar la foto WebP.');
  }
  await assertStorageUploadAllowed('assets', original.size + thumbnail.size);
  const path = `${ownerUid}/products/${productId}/${Date.now()}_${crypto.randomUUID()}.${imageFileExtension(original)}`;
  const thumbnailPath = getProductThumbnailPath(path);
  let originalUploaded = false;
  try {
    const url = await uploadToStorage(path, original, original.type, PRODUCT_PHOTO_CACHE_CONTROL);
    originalUploaded = true;
    await uploadToStorage(thumbnailPath, thumbnail, thumbnail.type, PRODUCT_PHOTO_CACHE_CONTROL);
    return url;
  } catch (error) {
    if (originalUploaded) await Promise.allSettled([deleteFromStorage(path), deleteFromStorage(thumbnailPath)]);
    throw error;
  }
}

export interface PreparedSupplierCatalogPhoto {
  original: File;
  thumbnail: File;
}

export async function prepareSupplierCatalogPhoto(file: File): Promise<PreparedSupplierCatalogPhoto> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
    throw new Error('La foto debe ser JPEG, PNG o WebP y pesar hasta 5 MB.');
  }
  const original = await optimizeSupplierCatalogPhoto(file);
  const thumbnail = await optimizeSupplierCatalogThumbnail(original);
  return { original, thumbnail };
}

async function supplierSourceKey(sourceUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceUrl));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Upload an already compressed supplier photo. Provider URLs get a stable,
 * source-specific path so reimports can update provider-managed images while
 * leaving photos uploaded by the business untouched.
 */
export async function uploadPreparedSupplierCatalogPhoto(
  prepared: PreparedSupplierCatalogPhoto,
  ownerUid: string,
  productId: string,
  sourceUrl?: string,
): Promise<string> {
  const sourceKey = sourceUrl ? await supplierSourceKey(sourceUrl) : null;
  const fileBase = sourceKey ? `supplier-${sourceKey}` : `supplier-manual-${crypto.randomUUID()}`;
  const path = `${ownerUid}/products/${productId}/${fileBase}.webp`;
  const thumbnailPath = getProductThumbnailPath(path);
  let originalUploaded = false;
  try {
    const url = await uploadToStorage(path, prepared.original, prepared.original.type, PRODUCT_PHOTO_CACHE_CONTROL);
    originalUploaded = true;
    await uploadToStorage(thumbnailPath, prepared.thumbnail, prepared.thumbnail.type, PRODUCT_PHOTO_CACHE_CONTROL);
    return url;
  } catch (error) {
    // Provider paths can already be referenced by the product. Keep them
    // intact if replacing the thumbnail fails; a later import can retry.
    if (originalUploaded && !sourceKey) await Promise.allSettled([deleteFromStorage(path), deleteFromStorage(thumbnailPath)]);
    throw error;
  }
}
