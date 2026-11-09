import type { SupplierListDraftRow } from './supplierListImport';
import { normalizeSupplierImportRow } from './supplierPrivacy';
import { facebookExtensionId } from './facebookExtensionId';

export const SUPPLIER_EXTENSION_CHUNK_SIZE = 500;
export const SUPPLIER_EXTENSION_MAX_PRODUCTS = 5_000;
const SAFE_IMAGE_QUERY_KEYS = new Set(['auto', 'bg', 'c', 'crop', 'dpr', 'fit', 'fm', 'format', 'h', 'height', 'ixlib', 'q', 'quality', 's', 'scale', 'size', 'v', 'w', 'width']);
const MAX_EXTENSION_IMAGE_BYTES = 400 * 1024;

interface ExtensionRuntime {
  lastError?: { message?: string };
  sendMessage: (extensionId: string, message: unknown, callback: (response: unknown) => void) => void;
}

function extensionMessage(message: unknown, timeoutMs = 15_000): Promise<unknown> {
  const runtime = (window as Window & { chrome?: { runtime?: ExtensionRuntime } }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error('Instalá o actualizá la extensión RivaStock en Chrome y recargá esta página.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('La extensión no respondió. Actualizala y volvé a intentar.')), timeoutMs);
    runtime.sendMessage(facebookExtensionId, message, response => {
      clearTimeout(timer);
      if (runtime.lastError || !response) reject(new Error('Instalá o actualizá la extensión RivaStock en Chrome y recargá esta página.'));
      else if (typeof response === 'object' && response !== null && 'error' in response) reject(new Error(String((response as { error: unknown }).error)));
      else resolve(response);
    });
  });
}

export interface SupplierExtensionItem {
  name: string;
  code: string | null;
  brand?: string | null;
  altCode?: string | null;
  price: number | null;
  currency: string;
  category?: string | null;
  imageUrl?: string | null;
  images?: string[];
  url?: string | null;
  needsPriceReview?: boolean;
}

export interface SupplierExtensionChunk {
  captureId: string;
  offset: number;
  nextOffset: number;
  total: number;
  done: boolean;
  items: SupplierExtensionItem[];
  origin: string;
  source: string[];
  warnings: string[];
  capturedAt: string;
}

function safeHttps(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password
      || [...url.searchParams.keys()].some(key => !SAFE_IMAGE_QUERY_KEYS.has(key.toLowerCase())) || url.hostname === 'localhost'
      || url.hostname.includes(':') || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost')
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)
      || [...url.searchParams.keys()].some(key => /(?:auth|token|session|cookie|password|credential|secret|api[_-]?key)/i.test(key))) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function safeCaptureOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/'
      && !url.search && !url.hash && url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

function isCaptureItem(value: unknown): value is SupplierExtensionItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<SupplierExtensionItem>;
  return typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 200
    && (item.code === null || item.code === undefined || (typeof item.code === 'string' && item.code.length <= 100))
    && (item.altCode === null || item.altCode === undefined || (typeof item.altCode === 'string' && item.altCode.length <= 100))
    && (item.brand === null || item.brand === undefined || (typeof item.brand === 'string' && item.brand.length <= 100))
    && (item.price === null || item.price === undefined || (Number.isFinite(item.price) && item.price > 0))
    && ['ARS', 'USD', 'EUR', 'GBP'].includes(String(item.currency))
    && (item.category === null || item.category === undefined || (typeof item.category === 'string' && item.category.length <= 120))
    && (item.imageUrl === null || item.imageUrl === undefined || safeHttps(item.imageUrl) !== null)
    && (item.url === null || item.url === undefined || safeHttps(item.url) !== null)
    && (item.images === undefined || (Array.isArray(item.images) && item.images.length <= 5 && item.images.every(image => safeHttps(image) !== null)));
}

function validateChunk(value: unknown, captureId: string, offset: number): SupplierExtensionChunk {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La extensión envió una tanda inválida.');
  const chunk = value as Partial<SupplierExtensionChunk>;
  if (chunk.captureId !== captureId || chunk.offset !== offset || !Number.isSafeInteger(chunk.total)
    || chunk.total! < 1 || chunk.total! > SUPPLIER_EXTENSION_MAX_PRODUCTS
    || !Array.isArray(chunk.items) || chunk.items.length > SUPPLIER_EXTENSION_CHUNK_SIZE
    || chunk.items.some(item => !isCaptureItem(item))
    || chunk.nextOffset !== offset + chunk.items.length || chunk.nextOffset! > chunk.total!
    || typeof chunk.done !== 'boolean' || chunk.done !== (chunk.nextOffset === chunk.total)
    || !safeCaptureOrigin(chunk.origin) || !Array.isArray(chunk.source) || !Array.isArray(chunk.warnings)
    || typeof chunk.capturedAt !== 'string' || !Number.isFinite(Date.parse(chunk.capturedAt))) {
    throw new Error('La captura de la extensión no pasó la validación.');
  }
  return chunk as SupplierExtensionChunk;
}

export function supplierExtensionItemsToRows(items: SupplierExtensionItem[]): SupplierListDraftRow[] {
  const currencies = new Set(items.map(item => item.currency));
  const mixedCurrency = currencies.size > 1;
  return items.map((item, index) => normalizeSupplierImportRow({
    sourceRow: index + 1,
    sourceCode: item.code ?? item.altCode ?? null,
    brand: typeof item.brand === 'string' ? item.brand.trim().slice(0, 100) : null,
    sourceCurrency: item.currency,
    name: item.name.trim().replace(/\s+/g, ' ').slice(0, 200),
    supplierCost: item.price && item.price > 0 ? item.price : null,
    category: typeof item.category === 'string' ? item.category.trim().slice(0, 120) : '',
    imageUrl: safeHttps(item.imageUrl) ?? item.images?.map(safeHttps).find(Boolean) ?? null,
    error: !item.price || item.price <= 0 ? 'Sin precio, revisar.'
      : mixedCurrency ? 'La captura mezcla monedas. Separá la lista por moneda antes de continuar.' : null,
  }));
}

export async function receiveSupplierExtensionCapture(
  captureId: string,
  requestChunk: (id: string, offset: number) => Promise<unknown>,
) {
  if (!/^[0-9a-f-]{36}$/i.test(captureId)) throw new Error('El enlace de captura no es válido.');
  const items: SupplierExtensionItem[] = [];
  let offset = 0;
  let total: number | null = null;
  let metadata: SupplierExtensionChunk | null = null;
  while (offset < (total ?? 1)) {
    const chunk = validateChunk(await requestChunk(captureId, offset), captureId, offset);
    if (total !== null && chunk.total !== total) throw new Error('La captura cambió mientras se recibía.');
    total = chunk.total;
    metadata ??= chunk;
    if (chunk.items.length === 0 && !chunk.done) throw new Error('La extensión no avanzó en la transferencia.');
    items.push(...chunk.items);
    offset = chunk.nextOffset;
    if (chunk.done) break;
  }
  if (!metadata || items.length !== total) throw new Error('La captura llegó incompleta. Volvé a leer la tienda.');
  const origin = safeCaptureOrigin(metadata.origin);
  if (!origin) throw new Error('La captura tiene un origen inválido.');
  return {
    items,
    rows: supplierExtensionItemsToRows(items),
    origin,
    source: metadata.source.filter(value => ['network-json', 'structured-data', 'dom-cards'].includes(value)).slice(0, 3),
    warnings: metadata.warnings.filter(value => [
      'No encontramos productos en esta página. Si requiere clave o JavaScript, iniciá sesión en el proveedor y volvé a leer desde su página.',
      'Hay productos sin precio; quedaron marcados para revisar y no se importan como costo cero.',
      'Hay precios superiores a $5.000.000 o que necesitan revisión.',
      'La página muestra precios mayoristas y minoristas; revisá cuál corresponde antes de continuar.',
    ].includes(value)).slice(0, 8),
    capturedAt: metadata.capturedAt,
  };
}

export async function requestSupplierCaptureChunk(captureId: string, offset: number): Promise<unknown> {
  return extensionMessage({ type: 'rivastock-get-capture', captureId, offset });
}

export async function acknowledgeSupplierCapture(captureId: string): Promise<unknown> {
  return extensionMessage({ type: 'rivastock-capture-received', captureId });
}

export async function fetchSupplierCaptureImage(captureId: string, imageUrl: string, timeoutMs = 15_000): Promise<File> {
  if (!/^[0-9a-f-]{36}$/i.test(captureId)) throw new Error('La captura no es válida.');
  const safeUrl = safeHttps(imageUrl);
  if (!safeUrl) throw new Error('La foto del proveedor no tiene un enlace HTTPS válido.');
  const response = await extensionMessage({ type: 'supplier-capture-read-image', captureId, imageUrl: safeUrl }, timeoutMs) as {
    mimeType?: unknown; base64?: unknown; size?: unknown;
  };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(response.mimeType))
    || typeof response.base64 !== 'string' || response.base64.length > Math.ceil(MAX_EXTENSION_IMAGE_BYTES * 4 / 3) + 8
    || !Number.isSafeInteger(response.size) || Number(response.size) < 1 || Number(response.size) > MAX_EXTENSION_IMAGE_BYTES) {
    throw new Error('La extensión devolvió una foto que no podemos usar.');
  }
  const binary = atob(response.base64);
  if (binary.length !== response.size || binary.length > MAX_EXTENSION_IMAGE_BYTES) throw new Error('La foto supera 400 KB.');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const mimeType = String(response.mimeType);
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
  return new File([bytes], `supplier-capture.${extension}`, { type: mimeType });
}
