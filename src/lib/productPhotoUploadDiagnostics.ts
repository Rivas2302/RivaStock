import { supabase } from './supabase';

export type ProductPhotoUploadStage =
  | 'validate'
  | 'compress_original'
  | 'compress_thumbnail'
  | 'check_storage'
  | 'upload_original'
  | 'upload_thumbnail';

export type ProductPhotoUploadReason =
  | 'no_permission'
  | 'no_space'
  | 'suspended'
  | 'unsupported_format'
  | 'no_connection'
  | 'photo_too_large'
  | 'read_failed'
  | 'compression_failed'
  | 'processing_timeout'
  | 'product_id_missing'
  | 'server_error';

export interface ProductPhotoUploadDiagnostic {
  stage: ProductPhotoUploadStage;
  reason: ProductPhotoUploadReason;
  imageType: 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'other';
  sizeBytes: number;
  online: boolean;
}

const PHOTO_UPLOAD_MESSAGES: Record<ProductPhotoUploadReason, string> = {
  no_permission: 'Sin permiso: no se pudo guardar la foto en Stock. Revisá el acceso del negocio.',
  no_space: 'Sin espacio en la nube de RivaStock. Avisá a RivaTech.',
  suspended: 'La cuenta del negocio está suspendida y no puede subir fotos.',
  unsupported_format: 'Formato no soportado. Guardá la foto como JPG o PNG y volvé a probar.',
  no_connection: 'Sin conexión. Revisá Internet e intentá subir la foto de nuevo.',
  photo_too_large: 'La foto sigue siendo demasiado pesada después de comprimirla. Probá con otra imagen.',
  read_failed: 'No se pudo leer la foto. Elegí el archivo otra vez o probá con una copia JPG.',
  compression_failed: 'No se pudo comprimir la foto. Probá con una imagen más liviana.',
  processing_timeout: 'El teléfono tardó más de 20 segundos en preparar la foto. Probá con otra imagen.',
  product_id_missing: 'No se pudo identificar el producto para guardar la foto. Cerrá y volvé a abrir el formulario.',
  server_error: 'No pudimos guardar la foto. Intentá de nuevo; si sigue pasando, avisá a RivaTech.',
};

export function getProductPhotoImageType(file: Pick<File, 'type' | 'name'>): ProductPhotoUploadDiagnostic['imageType'] {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg') || /\.(?:jpe?g)$/.test(name)) return 'jpeg';
  if (mime.includes('png') || name.endsWith('.png')) return 'png';
  if (mime.includes('webp') || name.endsWith('.webp')) return 'webp';
  if (mime.includes('heic') || mime.includes('heif') || /\.hei[cf]$/.test(name)) return 'heic';
  if (mime.includes('avif') || name.endsWith('.avif')) return 'avif';
  return 'other';
}

export function productPhotoUploadError(
  error: unknown,
  options: { online: boolean; denialMessage?: string | null },
): { reason: ProductPhotoUploadReason; message: string } {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const normalized = rawMessage.toLowerCase();
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  let reason: ProductPhotoUploadReason = 'server_error';

  if (options.denialMessage) {
    reason = /espacio/i.test(options.denialMessage) ? 'no_space' : 'suspended';
  } else if (code === 'unsupported_format') reason = 'unsupported_format';
  else if (code === 'read_failed') reason = 'read_failed';
  else if (code === 'compression_failed') reason = 'compression_failed';
  else if (code === 'processing_timeout') reason = 'processing_timeout';
  else if (code === 'product_id_missing') reason = 'product_id_missing';
  else if (code === 'photo_too_large') reason = 'photo_too_large';
  else if (/project_storage_full|storage.*full|quota.*exceed|sin espacio/.test(normalized)) reason = 'no_space';
  else if (/suspendid/.test(normalized)) reason = 'suspended';
  else if (!options.online || /failed to fetch|networkerror|network request failed|load failed|offline|internet disconnected/.test(normalized)) reason = 'no_connection';
  else if (/row-level security|permission denied|not authorized|unauthorized|\b403\b|\b401\b|jwt/.test(normalized)) reason = 'no_permission';
  else if (/payload too large|file size limit|maximum allowed|\b413\b/.test(normalized)) reason = 'photo_too_large';
  else if (/unsupported.*format|format.*unsupported|not supported.*image|image.*not supported/.test(normalized)) reason = 'unsupported_format';

  return { reason, message: PHOTO_UPLOAD_MESSAGES[reason] };
}

export function makeProductPhotoUploadDiagnostic(
  stage: ProductPhotoUploadStage,
  reason: ProductPhotoUploadReason,
  file: Pick<File, 'type' | 'name' | 'size'>,
  online: boolean,
): ProductPhotoUploadDiagnostic {
  return {
    stage,
    reason,
    imageType: getProductPhotoImageType(file),
    sizeBytes: Math.max(0, Math.floor(file.size)),
    online,
  };
}

/** Send only coarse, non-identifying upload failure metadata to the authenticated Edge Function. */
export function reportProductPhotoUploadFailure(diagnostic: ProductPhotoUploadDiagnostic): void {
  console.error('[product-photo-upload]', diagnostic);
  if (!diagnostic.online) return;

  void supabase.functions.invoke('product-upload-diagnostics', { body: diagnostic }).then(({ error }) => {
    if (error) console.warn('[product-photo-upload] No se pudo registrar el diagnóstico remoto.');
  }).catch(() => {
    console.warn('[product-photo-upload] No se pudo registrar el diagnóstico remoto.');
  });
}
