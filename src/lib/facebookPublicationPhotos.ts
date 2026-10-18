import type { Product } from '../types';
import { deleteFromStorage, uploadToStorage } from './db';
import { supabase } from './supabase';

const MAX_PHOTO_BYTES = 10_000_000;
const DATA_IMAGE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;

function getImageExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'webp';
}

async function uploadEmbeddedPhoto(dataUrl: string, ownerUid: string, productId: string, index: number): Promise<string> {
  const match = DATA_IMAGE.exec(dataUrl);
  if (!match) throw new Error(`La foto ${index + 1} está guardada en un formato no compatible. Volvé a cargarla desde el editor del producto.`);

  const mimeType = match[1].toLowerCase();
  const payload = match[2];
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  if (Math.floor(payload.length * 3 / 4) - padding > MAX_PHOTO_BYTES) {
    throw new Error(`La foto ${index + 1} supera 10 MB. Volvé a cargar una imagen más chica.`);
  }

  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`No se pudo leer la foto ${index + 1}.`);
  const blob = await response.blob();
  if (blob.size === 0 || blob.size > MAX_PHOTO_BYTES || blob.type.toLowerCase() !== mimeType) {
    throw new Error(`La foto ${index + 1} está vacía, supera 10 MB o tiene un formato inválido.`);
  }

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  const fingerprint = Array.from(digest.slice(0, 12), byte => byte.toString(16).padStart(2, '0')).join('');
  const path = `${ownerUid}/products/${productId}/facebook-${fingerprint}.${getImageExtension(mimeType)}`;
  return uploadToStorage(path, blob, mimeType);
}

export async function preparePublicationPhotos(product: Product, ownerUid: string): Promise<{
  product: Product;
  replacements: Map<string, string>;
}> {
  const embeddedPhotos = [...new Set([...(product.images ?? []), product.imageUrl]
    .filter((photo): photo is string => Boolean(photo) && photo!.toLowerCase().startsWith('data:')))];
  if (!embeddedPhotos.length) return { product, replacements: new Map() };
  if (!ownerUid) throw new Error('No se pudo verificar la cuenta para preparar las fotos. Volvé a iniciar sesión.');

  const replacements = new Map<string, string>();
  const uploadedUrls: string[] = [];
  try {
    const allPhotos = [...new Set([...(product.images ?? []), product.imageUrl].filter(Boolean) as string[])];
    for (const photo of embeddedPhotos) {
      const index = allPhotos.indexOf(photo);
      const url = await uploadEmbeddedPhoto(photo, ownerUid, product.id, index < 0 ? 0 : index);
      replacements.set(photo, url);
      uploadedUrls.push(url);
    }
  } catch (error) {
    await Promise.allSettled(uploadedUrls.map(deleteFromStorage));
    throw error;
  }

  const { error } = await supabase.rpc('replace_facebook_product_data_photos', {
    p_product: product.id,
    p_replacements: Object.fromEntries(replacements),
  });
  if (error) throw new Error(`No se pudieron guardar las fotos del producto en HTTPS: ${error.message}`);

  const replace = (photo: string) => replacements.get(photo) ?? photo;
  return {
    product: {
      ...product,
      imageUrl: product.imageUrl ? replace(product.imageUrl) : product.imageUrl,
      images: product.images?.map(replace),
    },
    replacements,
  };
}
