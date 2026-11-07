import { deleteFromStorage, uploadToStorage } from './db';
import { assertStorageUploadAllowed } from './platformStorage';
import { imageFileExtension, optimizeUploadImage } from './imageOptimization';
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
