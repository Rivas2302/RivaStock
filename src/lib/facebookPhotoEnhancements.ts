export type FacebookPhotoCrop = 'square' | 'four_three';

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 2048;
const MAX_SOURCE_PIXELS = 40_000_000;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface EnhancedFacebookPhoto {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  whiteBackgroundApplied: boolean;
}

export function centeredCrop(width: number, height: number, crop: FacebookPhotoCrop) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('La imagen tiene dimensiones inválidas.');
  }
  const aspect = crop === 'square' ? 1 : 4 / 3;
  const currentAspect = width / height;
  if (currentAspect > aspect) {
    const cropWidth = height * aspect;
    return { sx: (width - cropWidth) / 2, sy: 0, sw: cropWidth, sh: height };
  }
  const cropHeight = width / aspect;
  return { sx: 0, sy: (height - cropHeight) / 2, sw: width, sh: cropHeight };
}

export async function loadProductPhotoBlob(
  photoUrl: string,
  projectUrl: string,
  ownerUid: string,
  productId: string,
): Promise<Blob> {
  const project = new URL(projectUrl);
  let source: URL;
  try { source = new URL(photoUrl); }
  catch { throw new Error('La foto no tiene una URL válida.'); }

  if (source.protocol === 'data:') {
    if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(photoUrl)) {
      throw new Error('La foto debe ser JPEG, PNG o WebP.');
    }
  } else {
    const expectedPath = `/storage/v1/object/public/assets/${ownerUid}/products/${productId}/`;
    const secureProtocol = source.protocol === 'https:' || (project.protocol === 'http:' && source.protocol === 'http:');
    if (!secureProtocol || source.origin !== project.origin || !source.pathname.startsWith(expectedPath)
      || source.username || source.password || source.search || source.hash) {
      throw new Error('Solo se pueden mejorar fotos guardadas en el almacenamiento de este producto.');
    }
  }

  const response = await fetch(photoUrl, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('No se pudo descargar la foto del producto.');
  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (declaredSize > MAX_SOURCE_BYTES) throw new Error('La foto supera el límite de 10 MB.');
  const blob = await response.blob();
  if (!SUPPORTED_IMAGE_TYPES.has(blob.type.toLowerCase()) || blob.size < 1 || blob.size > MAX_SOURCE_BYTES) {
    throw new Error('La foto debe ser JPEG, PNG o WebP y pesar hasta 10 MB.');
  }
  return blob;
}

export async function enhanceFacebookPhoto(
  source: Blob,
  crop: FacebookPhotoCrop,
): Promise<EnhancedFacebookPhoto> {
  const sourceType = source.type.toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES.has(sourceType) || source.size < 1 || source.size > MAX_SOURCE_BYTES) {
    throw new Error('La foto debe ser JPEG, PNG o WebP y pesar hasta 10 MB.');
  }
  const sourceBytes = await source.arrayBuffer();
  if ((sourceType === 'image/png' && isAnimatedPng(sourceBytes))
    || (sourceType === 'image/webp' && isAnimatedWebP(sourceBytes))) {
    throw new Error('No se pueden mejorar imágenes animadas; se conserva el original.');
  }

  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    bitmap = await createImageBitmap(source);
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) {
      throw new Error('La resolución de la foto supera el límite seguro de procesamiento.');
    }
    const sourceCrop = centeredCrop(bitmap.width, bitmap.height, crop);
    const scale = Math.min(1, MAX_EDGE / Math.max(sourceCrop.sw, sourceCrop.sh));
    const width = Math.max(1, Math.round(sourceCrop.sw * scale));
    const height = Math.max(1, Math.round(sourceCrop.sh * scale));
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('El navegador no permite procesar la foto.');
    context.drawImage(bitmap, sourceCrop.sx, sourceCrop.sy, sourceCrop.sw, sourceCrop.sh, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const whiteBackgroundApplied = sourceType === 'image/png' && compositeTransparentPixelsOverWhite(pixels.data);
    autoEnhancePixels(pixels.data);
    context.putImageData(pixels, 0, 0);

    const outputType = whiteBackgroundApplied ? 'image/jpeg' : sourceType;
    const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(
      value => resolve(value), outputType, outputType === 'image/jpeg' ? 0.92 : 0.9,
    ));
    if (!blob || !SUPPORTED_IMAGE_TYPES.has(blob.type) || blob.size < 1 || blob.size > MAX_OUTPUT_BYTES) {
      throw new Error('No se pudo crear una copia mejorada de tamaño válido.');
    }
    return { blob, mimeType: blob.type, width, height, whiteBackgroundApplied };
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export function autoEnhancePixels(pixels: Uint8ClampedArray): void {
  const histogram = new Uint32Array(256);
  let visiblePixels = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 16) continue;
    const luminance = Math.max(0, Math.min(255, Math.round(
      0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2],
    )));
    histogram[luminance] += 1;
    visiblePixels += 1;
  }
  if (visiblePixels < 2) return;
  const low = percentile(histogram, visiblePixels, 0.02);
  const high = percentile(histogram, visiblePixels, 0.98);
  if (high - low < 8) return;

  const scale = 255 / (high - low);
  let adjustedLuminance = 0;
  let adjustedCount = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 16) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[index + channel] = clamp((pixels[index + channel] - low) * scale);
    }
    adjustedLuminance += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
    adjustedCount += 1;
  }
  if (!adjustedCount) return;

  // Keep the automatic exposure correction small so the contrast stretch does
  // not wash out product colors or turn a white cutout background gray.
  const brightnessOffset = Math.max(-12, Math.min(12, 128 - adjustedLuminance / adjustedCount));
  if (Math.abs(brightnessOffset) < 1) return;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 16) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[index + channel] = clamp(pixels[index + channel] + brightnessOffset);
    }
  }
}

function compositeTransparentPixelsOverWhite(pixels: Uint8ClampedArray): boolean {
  let transparent = false;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (alpha >= 1) continue;
    transparent = true;
    pixels[index] = pixels[index] * alpha + 255 * (1 - alpha);
    pixels[index + 1] = pixels[index + 1] * alpha + 255 * (1 - alpha);
    pixels[index + 2] = pixels[index + 2] * alpha + 255 * (1 - alpha);
    pixels[index + 3] = 255;
  }
  return transparent;
}

function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  const target = Math.max(1, Math.ceil(total * fraction));
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= target) return value;
  }
  return 255;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function isAnimatedPng(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) return false;
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const length = new DataView(buffer).getUint32(offset);
    if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'acTL') return true;
    if (length > bytes.length || offset + length + 12 > bytes.length) return false;
    offset += length + 12;
  }
  return false;
}

function isAnimatedWebP(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF'
    || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (kind === 'ANIM' || kind === 'ANMF') return true;
    const length = new DataView(buffer).getUint32(offset + 4, true);
    if (length > bytes.length || offset + length + 8 > bytes.length) return false;
    offset += 8 + length + (length % 2);
  }
  return false;
}
