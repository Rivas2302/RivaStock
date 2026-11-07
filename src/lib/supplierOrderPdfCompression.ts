/// <reference types="vite/client" />
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

export const SUPPLIER_ORDER_PDF_COMPRESSION_THRESHOLD = 10 * 1024 * 1024;
export const SUPPLIER_ORDER_PDF_MAX_BYTES = 50 * 1024 * 1024;

export type PdfCompressionProgress = (page: number, pageCount: number) => void;

interface RenderProfile {
  maxScale: number;
  maxDimension: number;
  quality: number;
}

const RENDER_PROFILES: RenderProfile[] = [
  { maxScale: 1.25, maxDimension: 1800, quality: 0.72 },
  { maxScale: 1, maxDimension: 1400, quality: 0.58 },
];

function toPdfPoints(cssPixels: number): number {
  return cssPixels * 0.75;
}

async function renderCompressedPdf(
  documentProxy: PDFDocumentProxy,
  profile: RenderProfile,
  onProgress?: PdfCompressionProgress,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', compress: true, putOnlyUsedFonts: true });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Este navegador no permite comprimir el PDF.');

  try {
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber++) {
      const page = await documentProxy.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(profile.maxScale, profile.maxDimension / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      await page.render({ canvasContext: context, viewport }).promise;

      const pageWidth = toPdfPoints(viewport.width);
      const pageHeight = toPdfPoints(viewport.height);
      if (pageNumber > 1) pdf.addPage([pageWidth, pageHeight]);
      pdf.addImage(canvas.toDataURL('image/jpeg', profile.quality), 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      canvas.width = 0;
      canvas.height = 0;
      onProgress?.(pageNumber, documentProxy.numPages);
    }
    return pdf.output('blob');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function compressSupplierOrderPdf(
  file: File,
  onProgress?: PdfCompressionProgress,
): Promise<File> {
  if (file.size <= SUPPLIER_ORDER_PDF_COMPRESSION_THRESHOLD) return file;
  if (file.size > SUPPLIER_ORDER_PDF_MAX_BYTES) {
    throw new Error('El PDF original supera el máximo de 50 MB.');
  }
  if (!file.name.toLowerCase().endsWith('.pdf') || await file.slice(0, 5).text() !== '%PDF-') {
    throw new Error('El archivo no es un PDF válido.');
  }

  const source = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjs.getDocument({ data: source });
  try {
    const documentProxy = await loadingTask.promise;
    let compressed: Blob | null = null;
    for (const profile of RENDER_PROFILES) {
      compressed = await renderCompressedPdf(documentProxy, profile, onProgress);
      if (compressed.size < file.size) break;
    }
    if (!compressed || compressed.size >= file.size) {
      throw new Error('No pudimos reducir el tamaño del PDF. Guardalo con menor resolución y volvé a subirlo.');
    }
    if (compressed.size > SUPPLIER_ORDER_PDF_MAX_BYTES) {
      throw new Error('El PDF supera el máximo de 50 MB incluso después de comprimirlo.');
    }

    return new File([compressed], file.name, { type: 'application/pdf', lastModified: file.lastModified });
  } finally {
    await loadingTask.destroy();
  }
}
