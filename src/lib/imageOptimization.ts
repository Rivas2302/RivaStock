// Existing WebP may be animated; it is already compressed and stays untouched.
const RASTER_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

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
export async function optimizeUploadImage(file: File, maxEdge = 1600): Promise<File> {
  if (!RASTER_TYPES.has(file.type) || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (file.type === 'image/png' && hasPngAnimation(await file.arrayBuffer())) return file;
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

export function imageFileExtension(file: Pick<File, 'type' | 'name'>): string {
  if (file.type === 'image/jpeg' || file.type === 'image/jpg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'img';
}
