// Existing WebP may be animated; it is already compressed and stays untouched.
const RASTER_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const CONVERTIBLE_TYPES = new Set([...RASTER_TYPES, 'image/webp']);

export type ImageProcessingFailureCode = 'unsupported_format' | 'read_failed' | 'compression_failed' | 'photo_too_large';

export class ImageProcessingError extends Error {
  constructor(readonly code: ImageProcessingFailureCode) {
    const messages: Record<ImageProcessingFailureCode, string> = {
      unsupported_format: 'El teléfono no puede abrir este formato de imagen.',
      read_failed: 'No se pudo leer la foto seleccionada.',
      compression_failed: 'No se pudo comprimir la foto seleccionada.',
      photo_too_large: 'La foto sigue siendo demasiado pesada después de comprimirla.',
    };
    super(messages[code]);
    this.name = 'ImageProcessingError';
  }
}

function isHeifFile(file: File): boolean {
  return /\.(?:heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type);
}

function isSupportedUploadImage(file: File): boolean {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return false;
  return /^(?:image\/(?:jpe?g|png|webp|heic|heif|avif))$/i.test(file.type)
    || /\.(?:jpe?g|png|webp|heic|heif|avif)$/i.test(file.name);
}

async function optimizeUploadImageAsWebP(file: File, maxEdge: number, maxBytes?: number): Promise<File> {
  if (!isSupportedUploadImage(file) || file.size === 0) {
    throw new ImageProcessingError(file.size === 0 ? 'read_failed' : 'unsupported_format');
  }
  if (typeof createImageBitmap !== 'function') throw new ImageProcessingError('unsupported_format');

  if (file.type === 'image/png' && hasPngAnimation(await file.arrayBuffer())) {
    throw new ImageProcessingError('unsupported_format');
  }

  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    try {
      bitmap = await createImageBitmap(file);
    } catch (error) {
      if (isHeifFile(file) || (error instanceof DOMException && error.name === 'NotSupportedError')) {
        throw new ImageProcessingError('unsupported_format');
      }
      throw new ImageProcessingError('read_failed');
    }

    const dimensions = fitImageDimensions(bitmap.width, bitmap.height, maxEdge);
    canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new ImageProcessingError('compression_failed');
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

    const qualities = maxBytes === undefined ? [0.85] : [0.85, 0.75, 0.65, 0.55, 0.45];
    let smallest: Blob | null = null;
    for (const quality of qualities) {
      const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/webp', quality));
      if (!blob || blob.type !== 'image/webp' || blob.size === 0) {
        throw new ImageProcessingError('compression_failed');
      }
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (maxBytes === undefined || blob.size <= maxBytes) {
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, {
          type: blob.type, lastModified: file.lastModified,
        });
      }
    }

    if (smallest && maxBytes !== undefined && smallest.size <= maxBytes) {
      return new File([smallest], `${file.name.replace(/\.[^.]+$/, '')}.webp`, {
        type: smallest.type, lastModified: file.lastModified,
      });
    }
    throw new ImageProcessingError('photo_too_large');
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    throw new ImageProcessingError('compression_failed');
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export function hasPngAnimation(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return false;
  const view = new DataView(buffer);
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += length + 12;
  }
  return false;
}

export function fitImageDimensions(width: number, height: number, maxEdge = 1600) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Preserve originals on unsupported browsers/codecs; leave SVG and animated
 * formats untouched. Existing storage URL and cleanup contracts are retained.
 */
export async function optimizeUploadImage(
  file: File,
  maxEdge = 1600,
  options: { forceWebP?: boolean; maxBytes?: number } = {},
): Promise<File> {
  const { forceWebP = false, maxBytes } = options;
  if (forceWebP) return optimizeUploadImageAsWebP(file, maxEdge, maxBytes);

  if (!RASTER_TYPES.has(file.type)
    || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (!forceWebP && file.type === 'image/png' && hasPngAnimation(await file.arrayBuffer())) return file;
    bitmap = await createImageBitmap(file);
    const dimensions = fitImageDimensions(bitmap.width, bitmap.height, maxEdge);
    canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, {
      type: blob.type, lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function optimizeCatalogCover(file: File, maxBytes = 300_000): Promise<File> {
  if (file.size <= maxBytes && !CONVERTIBLE_TYPES.has(file.type)) return file;
  if (!CONVERTIBLE_TYPES.has(file.type) || typeof createImageBitmap !== 'function') {
    if (file.size <= maxBytes) return file;
    throw new Error('Este navegador no puede comprimir la portada. Probá con una imagen más liviana.');
  }
  const bitmap = await createImageBitmap(file);
  let canvas: HTMLCanvasElement | undefined;
  try {
    for (const maxEdge of [1600, 1440, 1280, 1120, 960, 800]) {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      const dimensions = fitImageDimensions(bitmap.width, bitmap.height, maxEdge);
      canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se pudo preparar la portada.');
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
      for (const quality of [0.82, 0.72, 0.62, 0.52]) {
        const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/webp', quality));
        if (blob?.type === 'image/webp' && blob.size <= maxBytes) {
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp', lastModified: file.lastModified });
        }
      }
    }
    throw new Error('La portada supera 300 KB incluso comprimida. Elegí una imagen más simple.');
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function optimizeSupplierCatalogPhoto(file: File, maxEdge = 400, maxBytes = 60_000): Promise<File> {
  if (!CONVERTIBLE_TYPES.has(file.type) || typeof createImageBitmap !== 'function') {
    throw new Error('Este navegador no puede preparar la foto WebP del proveedor.');
  }
  const bitmap = await createImageBitmap(file);
  let canvas: HTMLCanvasElement | undefined;
  try {
    for (const edge of [maxEdge, 360, 320, 280, 240, 200].filter((value, index, all) => value <= maxEdge && all.indexOf(value) === index)) {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      const dimensions = fitImageDimensions(bitmap.width, bitmap.height, edge);
      canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se pudo preparar la foto del proveedor.');
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
      for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42, 0.32]) {
        const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/webp', quality));
        if (blob?.type === 'image/webp' && blob.size > 0 && blob.size <= maxBytes) {
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp', lastModified: file.lastModified });
        }
      }
    }
    throw new Error('La foto sigue pesando más de 60 KB después de comprimirla.');
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function optimizeSupplierCatalogThumbnail(file: File, maxEdge = 200, maxBytes = 30_000): Promise<File> {
  return optimizeSupplierCatalogPhoto(file, maxEdge, maxBytes);
}

export function imageFileExtension(file: Pick<File, 'type' | 'name'>): string {
  if (file.type === 'image/jpeg' || file.type === 'image/jpg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'img';
}
