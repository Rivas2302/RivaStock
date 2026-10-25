import { signedUrl } from './storage';
import type { KnowledgePdfImage } from './pdfExport';

/** Loads a private image and converts it to the JPEG data URL supported by jsPDF. */
export async function loadKnowledgePdfImage(assetPath: string): Promise<KnowledgePdfImage | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    const url = await signedUrl(assetPath, 300);
    const response = await fetch(url);
    if (!response.ok) return null;
    bitmap = await createImageBitmap(await response.blob());
    const canvas = window.document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      width: bitmap.width,
      height: bitmap.height,
    };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

export function downloadKnowledgePdf(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noreferrer';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
