import { parseSupplierListRows, type SupplierListDraftRow } from './supplierListImport';
import { supabase } from './supabase';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_SOURCE_TEXT = 60_000;
export const MAX_SOURCE_ROWS = 3000;
const MAX_PDF_PAGES = 300;
const MAX_OCR_PAGES = 30;

export type SupplierFileProgress = (page: number, total: number, warning?: string) => void;

export interface SupplierCatalogSourceResult {
  source: 'woocommerce' | 'shopify' | 'jsonld' | 'text';
  currency: string | null;
  items: Array<{
    code: string | null;
    name: string;
    price: number | null;
    category: string;
    imageUrl: string | null;
    url: string | null;
  }>;
  text?: string;
}

export function parseSupplierListText(text: string): SupplierListDraftRow[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length > MAX_SOURCE_ROWS + 1) throw new Error('La fuente supera el máximo de 3000 filas por lista.');

  const matrix = lines.map(line => line.includes('\t') ? line.split('\t')
    : line.includes('|') ? line.split('|')
      : line.split(/\s{2,}/));
  if (matrix[0].length > 1 && matrix[0].some(cell => /producto|nombre|art[ií]culo|costo|precio|categor[ií]a|foto|imagen/i.test(cell))) {
    return parseSupplierListRows(matrix);
  }

  return lines.map((line, index) => ({
    sourceRow: index + 1,
    name: line.slice(0, 240),
    supplierCost: null,
    category: '',
    imageUrl: null,
    error: 'La IA debe revisar el costo de esta fila.',
  }));
}

async function renderPdfPageToCanvas(documentProxy: PDFDocumentProxy, pageNumber: number): Promise<HTMLCanvasElement> {
  const page = await documentProxy.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 2400 / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Este navegador no permite leer páginas escaneadas.');
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

export async function extractSupplierListFileText(file: File, onProgress?: SupplierFileProgress): Promise<string> {
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) throw new Error('El archivo debe tener contenido y pesar hasta 50 MB.');
  const extension = file.name.split('.').pop()?.toLocaleLowerCase('en-US');
  if (extension === 'pdf' || file.type === 'application/pdf') {
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | undefined;
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
      const documentProxy = await loadingTask.promise;
      if (documentProxy.numPages > MAX_PDF_PAGES) {
        throw new Error('El PDF supera el máximo de 300 páginas. Dividilo en archivos más chicos.');
      }
      const pages: string[] = [];
      let ocrWorker: { recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | undefined;
      let ocrPages = 0;
      let skippedScannedPages = false;
      try {
        for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber++) {
          const page = await documentProxy.getPage(pageNumber);
          const content = await page.getTextContent();
          const pageText = content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ').trim();
          if (pageText.length >= 3) {
            pages.push(pageText);
          } else if (ocrPages < MAX_OCR_PAGES) {
            ocrWorker ??= await (await import('tesseract.js')).createWorker('spa', 1);
            const canvas = await renderPdfPageToCanvas(documentProxy, pageNumber);
            try {
              const result = await ocrWorker.recognize(canvas);
              pages.push(result.data.text.trim());
            } finally {
              canvas.width = 0;
              canvas.height = 0;
            }
            ocrPages++;
          } else {
            skippedScannedPages = true;
          }
          const warning = skippedScannedPages ? 'El PDF tiene más de 30 páginas escaneadas; se omitieron las páginas que superan el límite de OCR.' : undefined;
          onProgress?.(pageNumber, documentProxy.numPages, warning);
        }
      } finally {
        await ocrWorker?.terminate();
      }
      const text = pages.join('\n').trim();
      if (text.replace(/\s/g, '').length < 10) throw new Error('El PDF no contiene texto legible. Usá una captura o una planilla.');
      if (skippedScannedPages) onProgress?.(documentProxy.numPages, documentProxy.numPages, 'El PDF tiene más de 30 páginas escaneadas; se omitieron las páginas que superan el límite de OCR.');
      return text.slice(0, MAX_SOURCE_TEXT);
    } catch (error) {
      if (error instanceof Error && /^(El|La|No)\s/.test(error.message)) throw error;
      throw new Error('No pudimos procesar el PDF. Revisá que esté completo y volvé a intentarlo.');
    } finally {
      await loadingTask?.destroy();
    }
  }

  if (file.type.startsWith('image/') || /\.(?:jpe?g|png|webp)$/i.test(file.name)) {
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('spa', 1);
      try {
        const result = await worker.recognize(file);
        const text = result.data.text.trim();
        if (text.replace(/\s/g, '').length < 10) throw new Error('No pudimos leer texto suficiente en la imagen. Probá con una foto más nítida.');
        return text.slice(0, MAX_SOURCE_TEXT);
      } finally {
        await worker.terminate();
      }
    } catch (error) {
      if (error instanceof Error && /^(El|La|No)\s/.test(error.message)) throw error;
      throw new Error('No pudimos procesar la imagen. Probá con una captura más nítida.');
    }
  }
  throw new Error('Usá una planilla, un PDF o una imagen JPG, PNG o WebP.');
}

function validateSupplierPageUrl(rawUrl: string): URL {
  let url: URL;
  try { url = new URL(rawUrl.trim()); }
  catch { throw new Error('Ingresá un enlace HTTPS válido.'); }
  const hostname = url.hostname.toLocaleLowerCase('en-US').replace(/^\[|\]$/g, '');
  const localSuffixes = ['.localhost', '.local', '.internal', '.test', '.invalid', '.example'];
  const numericHost = hostname.includes(':') || /^\d+(?:\.\d+){0,3}$/.test(hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || hostname === 'localhost' || localSuffixes.some(suffix => hostname.endsWith(suffix))
    || numericHost || !hostname.includes('.')) {
    throw new Error('El enlace debe ser HTTPS y apuntar a un sitio público.');
  }
  return url;
}

export async function extractSupplierListPageText(rawUrl: string): Promise<string> {
  const url = validateSupplierPageUrl(rawUrl);
  let data: { text?: unknown; error?: unknown } | null;
  let error: Error | null;
  try {
    ({ data, error } = await supabase.functions.invoke('fetch-url', { body: { url: url.href } }));
  } catch {
    throw new Error('No pudimos leer el enlace. Probá de nuevo o subí una captura o planilla.');
  }
  if (error) {
    const message = typeof data?.error === 'string' ? data.error : '';
    if (message) throw new Error(message);
    if (error.message.includes('429')) throw new Error('Llegaste al límite de consultas. Probá de nuevo en un minuto.');
    throw new Error('No pudimos leer ese sitio. Podés subir una captura o planilla.');
  }
  if (typeof data?.text !== 'string') throw new Error('No encontramos texto para revisar en esa página.');
  return data.text.slice(0, MAX_SOURCE_TEXT);
}

export async function extractSupplierListCatalog(rawUrl: string): Promise<SupplierCatalogSourceResult> {
  const url = validateSupplierPageUrl(rawUrl);
  let data: SupplierCatalogSourceResult & { error?: unknown } | null;
  let error: Error | null;
  try {
    ({ data, error } = await supabase.functions.invoke('fetch-url', { body: { url: url.href, mode: 'catalog' } }));
  } catch {
    throw new Error('No pudimos leer el catálogo. Probá de nuevo o subí una planilla.');
  }
  if (error) {
    const message = typeof data?.error === 'string' ? data.error : '';
    if (message) throw new Error(message);
    if (error.message.includes('429')) throw new Error('Llegaste al límite de consultas. Probá de nuevo en un minuto.');
    throw new Error('No pudimos leer ese catálogo. Podés subir una planilla o una captura.');
  }
  if (!data || !['woocommerce', 'shopify', 'jsonld', 'text'].includes(data.source)) {
    throw new Error('No encontramos productos en ese catálogo.');
  }
  return data;
}
