import { parseSupplierListRows, type SupplierListDraftRow } from './supplierListImport';

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
  const host = url.hostname.toLocaleLowerCase('en-US');
  const localHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host === '::1' || host === '127.0.0.1' || host.startsWith('10.') || host.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (url.protocol !== 'https:' || url.username || url.password || localHost) {
    throw new Error('El enlace debe ser HTTPS y apuntar a un sitio público.');
  }
  return url;
}

export async function extractSupplierListPageText(rawUrl: string): Promise<string> {
  const url = validateSupplierPageUrl(rawUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'omit',
      mode: 'cors',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'text/html,text/plain;q=0.9' },
    });
  } catch {
    throw new Error('No pudimos leer el enlace. El sitio debe permitir lectura desde el navegador (CORS).');
  }
  if (!response.ok) throw new Error(`El sitio respondió ${response.status}.`);
  if (response.url) validateSupplierPageUrl(response.url);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 2 * 1024 * 1024) throw new Error('La página supera el límite de 2 MB.');
  const source = await readLimitedResponseText(response, 2 * 1024 * 1024);
  if (/text\/html/i.test(response.headers.get('content-type') ?? '')) {
    const document = new DOMParser().parseFromString(source, 'text/html');
    document.querySelectorAll('script,style,nav,header,footer,form,iframe,svg').forEach(element => element.remove());
    const tables = Array.from(document.querySelectorAll('table')).flatMap(table => Array.from(table.querySelectorAll('tr'))
      .map(row => Array.from(row.querySelectorAll('th,td')).map(cell => cell.textContent?.trim() ?? '').join('\t')));
    const pageText = tables.length > 1 ? tables.join('\n') : (document.body.innerText || document.body.textContent || '');
    return pageText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n').slice(0, MAX_SOURCE_TEXT);
  }
  return source.trim().slice(0, MAX_SOURCE_TEXT);
}

async function readLimitedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, maximumBytes);
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maximumBytes) {
        await reader.cancel();
        throw new Error('La página supera el límite de 2 MB.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
