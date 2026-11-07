import { parseSupplierListRows, type SupplierListDraftRow } from './supplierListImport';
import { supabase } from './supabase';

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_TEXT = 60_000;
const MAX_SOURCE_ROWS = 500;

export function parseSupplierListText(text: string): SupplierListDraftRow[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length > MAX_SOURCE_ROWS + 1) throw new Error('La fuente supera el máximo de 500 filas por lista.');

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

export async function extractSupplierListFileText(file: File): Promise<string> {
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) throw new Error('El archivo debe tener contenido y pesar hasta 10 MB.');
  const extension = file.name.split('.').pop()?.toLocaleLowerCase('en-US');
  if (extension === 'pdf' || file.type === 'application/pdf') {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const document = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      try {
        const result = await extractText(document, { mergePages: false });
        const pages = Array.isArray(result.text) ? result.text : [result.text];
        const text = pages.slice(0, 40).join('\n');
        if (text.replace(/\s/g, '').length < 10) throw new Error('El PDF no contiene texto seleccionable. Usá una captura legible o una planilla.');
        return text.slice(0, MAX_SOURCE_TEXT);
      } finally {
        await document.cleanup();
      }
    } catch (error) {
      if (error instanceof Error && /^(El|La|No)\s/.test(error.message)) throw error;
      throw new Error('No pudimos procesar el PDF. Revisá que esté completo y volvé a intentarlo.');
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
