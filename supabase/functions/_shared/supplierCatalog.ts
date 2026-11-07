import {
  assertPublicDns,
  extractVisibleSupplierText,
  readLimitedResponseText,
  validateSupplierPageUrl,
  type DnsResolver,
} from './supplierUrlProxy.ts';

export type SupplierCatalogSource = 'woocommerce' | 'shopify' | 'jsonld' | 'text';

export interface SupplierCatalogItem {
  code: string | null;
  name: string;
  price: number | null;
  category: string;
  imageUrl: string | null;
  url: string | null;
}

export interface SupplierCatalogResult {
  source: SupplierCatalogSource;
  currency: string | null;
  items: SupplierCatalogItem[];
  text?: string;
}

export class UnsafeSupplierRedirectError extends Error {
  constructor() {
    super('El sitio redirigió a una dirección que no es pública.');
    this.name = 'UnsafeSupplierRedirectError';
  }
}

const MAX_REDIRECTS = 3;
const API_MAX_PAGES = 30;
const MAX_ITEMS = 3_000;
const REQUEST_TIMEOUT_MS = 10_000;

function decodeEntities(value: unknown): string {
  const text = String(value ?? '');
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    ntilde: 'ñ', Ntilde: 'Ñ', ccedil: 'ç', euro: '€',
  };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x')) {
      const point = Number.parseInt(entity.slice(2), 16);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    }
    if (entity.startsWith('#')) {
      const point = Number.parseInt(entity.slice(1), 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    }
    return named[entity] ?? match;
  }).replace(/\s+/g, ' ').trim();
}

function toOptionalUrl(value: unknown, baseUrl: string): string | null {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) return null;
  try {
    const url = new URL(candidate, baseUrl);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function normalizeItems(items: SupplierCatalogItem[]): SupplierCatalogItem[] {
  const seen = new Set<string>();
  return items.flatMap(item => {
    const name = decodeEntities(item.name).slice(0, 240);
    if (!name) return [];
    const code = item.code ? decodeEntities(item.code).slice(0, 100) : null;
    const key = code ? `code:${code.toLocaleLowerCase('en-US')}` : `name:${name.toLocaleLowerCase('es-AR')}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...item, code, name, category: decodeEntities(item.category).slice(0, 100) }];
  }).slice(0, MAX_ITEMS);
}

function parseWooProducts(payload: unknown, baseUrl: string): { currency: string | null; items: SupplierCatalogItem[] } {
  if (!Array.isArray(payload)) return { currency: null, items: [] };
  const currencies = new Set<string>();
  const items = payload.flatMap((value): SupplierCatalogItem[] => {
    if (!value || typeof value !== 'object') return [];
    const product = value as Record<string, unknown>;
    const prices = product.prices && typeof product.prices === 'object' ? product.prices as Record<string, unknown> : {};
    const currency = String(prices.currency_code ?? '').trim().toUpperCase();
    if (currency) currencies.add(currency);
    const minorUnit = Number(prices.currency_minor_unit ?? 2);
    const rawPrice = String(prices.price ?? '').trim();
    const minorPrice = /^\d+$/.test(rawPrice) ? Number(rawPrice) : Number.NaN;
    const price = Number.isFinite(minorPrice) && minorUnit >= 0 && minorUnit <= 4
      ? minorPrice / (10 ** minorUnit) : null;
    const categories = Array.isArray(product.categories) ? product.categories : [];
    const category = categories.flatMap(category => {
      if (!category || typeof category !== 'object') return [];
      const name = decodeEntities((category as Record<string, unknown>).name);
      return name ? [name] : [];
    }).join(' / ');
    const images = Array.isArray(product.images) ? product.images : [];
    const firstImage = images.find(image => image && typeof image === 'object') as Record<string, unknown> | undefined;
    const name = decodeEntities(product.name);
    if (!name) return [];
    return [{
      code: decodeEntities(product.sku) || null,
      name,
      price,
      category,
      imageUrl: toOptionalUrl(firstImage?.src, baseUrl),
      url: toOptionalUrl(product.permalink, baseUrl),
    }];
  });
  return { currency: currencies.size === 1 ? [...currencies][0] : null, items: normalizeItems(items) };
}

function parseShopifyProducts(payload: unknown, baseUrl: string): { currency: string | null; items: SupplierCatalogItem[] } {
  if (!payload || typeof payload !== 'object') return { currency: null, items: [] };
  const record = payload as Record<string, unknown>;
  const products = Array.isArray(record.products) ? record.products : [];
  const currencies = new Set<string>();
  const items = products.flatMap((value): SupplierCatalogItem[] => {
    if (!value || typeof value !== 'object') return [];
    const product = value as Record<string, unknown>;
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const variant = variants.find(item => item && typeof item === 'object') as Record<string, unknown> | undefined;
    const currency = String(product.currency_code ?? record.currency_code ?? '').trim().toUpperCase();
    if (currency) currencies.add(currency);
    const rawPrice = String(variant?.price ?? '').trim();
    const price = /^\d+(?:\.\d{1,4})?$/.test(rawPrice) ? Number(rawPrice) : null;
    const image = product.image && typeof product.image === 'object' ? product.image as Record<string, unknown> : {};
    const name = decodeEntities(product.title);
    if (!name) return [];
    return [{
      code: decodeEntities(variant?.sku) || null,
      name,
      price,
      category: decodeEntities(product.product_type),
      imageUrl: toOptionalUrl(image.src, baseUrl),
      url: toOptionalUrl(product.handle ? `/products/${String(product.handle)}` : null, baseUrl),
    }];
  });
  return { currency: currencies.size === 1 ? [...currencies][0] : null, items: normalizeItems(items) };
}

function jsonLdNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const own = [record];
  if (Array.isArray(record['@graph'])) own.push(...jsonLdNodes(record['@graph']));
  return own;
}

function parseOffer(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.map(parseOffer).find(Boolean) ?? null;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.price !== undefined || record.lowPrice !== undefined) return record;
  if (record.offers) return parseOffer(record.offers);
  return null;
}

function parseJsonLdProducts(html: string, baseUrl: string): { currency: string | null; items: SupplierCatalogItem[] } {
  const scripts = Array.from(html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi));
  const nodes = scripts.flatMap(match => {
    try { return jsonLdNodes(JSON.parse(match[1].replace(/&quot;/g, '"'))); } catch { return []; }
  });
  const items: SupplierCatalogItem[] = [];
  const currencies = new Set<string>();
  const appendProduct = (product: Record<string, unknown>) => {
    const offer = parseOffer(product.offers);
    const rawPrice = offer?.price ?? offer?.lowPrice ?? product.price;
    const parsedPrice = typeof rawPrice === 'number' ? rawPrice : Number(String(rawPrice ?? '').replace(',', '.'));
    const currency = String(offer?.priceCurrency ?? product.priceCurrency ?? '').trim().toUpperCase();
    if (currency) currencies.add(currency);
    const category = Array.isArray(product.category) ? product.category.map(decodeEntities).join(' / ') : decodeEntities(product.category);
    const image = Array.isArray(product.image) ? product.image[0] : product.image;
    const imageUrl = image && typeof image === 'object' ? (image as Record<string, unknown>).url : image;
    const name = decodeEntities(product.name);
    if (!name) return;
    items.push({
      code: decodeEntities(product.sku || product.mpn) || null,
      name,
      price: Number.isFinite(parsedPrice) ? parsedPrice : null,
      category,
      imageUrl: toOptionalUrl(imageUrl, baseUrl),
      url: toOptionalUrl(product.url, baseUrl),
    });
  };

  for (const node of nodes) {
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    const hasType = (expected: string) => types.some(type => typeof type === 'string'
      && (type === expected || type.endsWith(`/${expected}`) || type.endsWith(`#${expected}`)));
    if (hasType('Product')) appendProduct(node);
    if (hasType('ItemList') && Array.isArray(node.itemListElement)) {
      for (const listItem of node.itemListElement) {
        if (!listItem || typeof listItem !== 'object') continue;
        const item = (listItem as Record<string, unknown>).item;
        if (item && typeof item === 'object') appendProduct(item as Record<string, unknown>);
      }
    }
    if (hasType('Offer') && (node.itemOffered || node.name)) {
      const offered = node.itemOffered && typeof node.itemOffered === 'object'
        ? node.itemOffered as Record<string, unknown>
        : {};
      appendProduct({ ...offered, name: offered.name ?? node.name, offers: node });
    }
  }
  return { currency: currencies.size === 1 ? [...currencies][0] : null, items: normalizeItems(items) };
}

export function isSupplierBotChallenge(text: string): boolean {
  return /one moment, please|checking your browser|verify you are human|captcha|cloudflare|anti[- ]?bot|unusual traffic/i.test(text);
}

export function parseWooCommerceCatalogPage(payload: unknown, baseUrl: string) {
  return parseWooProducts(payload, baseUrl);
}

export function parseShopifyCatalogPage(payload: unknown, baseUrl: string) {
  return parseShopifyProducts(payload, baseUrl);
}

export function parseJsonLdCatalog(html: string, baseUrl: string) {
  return parseJsonLdProducts(html, baseUrl);
}

async function fetchValidated(
  rawUrl: string,
  resolveDns: DnsResolver,
  fetcher: typeof fetch,
): Promise<{ response: Response; url: URL }> {
  let url = validateSupplierPageUrl(rawUrl);
  for (let redirectCount = 0; ; redirectCount++) {
    await assertPublicDns(url.hostname, resolveDns);
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json,text/html,text/plain,text/csv;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    if (response.status < 300 || response.status >= 400) return { response, url };
    await response.body?.cancel();
    if (redirectCount >= MAX_REDIRECTS) throw new Error('El sitio redirige demasiadas veces.');
    const location = response.headers.get('location');
    if (!location) throw new Error('El sitio devolvió una redirección sin destino.');
    try { url = validateSupplierPageUrl(new URL(location, url).href); }
    catch { throw new UnsafeSupplierRedirectError(); }
  }
}

async function fetchJsonPage(
  rawUrl: string,
  expectedOrigin: string,
  resolveDns: DnsResolver,
  fetcher: typeof fetch,
): Promise<unknown | null> {
  const { response, url } = await fetchValidated(rawUrl, resolveDns, fetcher);
  if (url.origin !== expectedOrigin) throw new Error('La API redirigió a otro dominio.');
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/(?:[a-z.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    await response.body?.cancel();
    return null;
  }
  const source = await readLimitedResponseText(response);
  try { return JSON.parse(source); } catch { return null; }
}

function withPage(url: URL, page: number, perPage: number): URL {
  const next = new URL(url);
  next.searchParams.set('per_page', String(perPage));
  next.searchParams.set('page', String(page));
  return next;
}

async function readWooCommerce(
  origin: string,
  resolveDns: DnsResolver,
  fetcher: typeof fetch,
): Promise<{ currency: string | null; items: SupplierCatalogItem[] } | null> {
  const endpoint = new URL('/wp-json/wc/store/v1/products', origin);
  const items: SupplierCatalogItem[] = [];
  let currency: string | null = null;
  for (let page = 1; page <= API_MAX_PAGES; page++) {
    const payload = await fetchJsonPage(withPage(endpoint, page, 100).href, origin, resolveDns, fetcher);
    if (!Array.isArray(payload)) return page === 1 ? null : { currency, items: normalizeItems(items) };
    if (payload.length === 0) break;
    const parsed = parseWooProducts(payload, origin);
    if (parsed.currency && currency && currency !== parsed.currency) return null;
    currency = parsed.currency ?? currency;
    items.push(...parsed.items);
    if (payload.length < 100 || items.length >= MAX_ITEMS) break;
  }
  return items.length ? { currency, items: normalizeItems(items) } : null;
}

async function readShopify(
  origin: string,
  resolveDns: DnsResolver,
  fetcher: typeof fetch,
): Promise<{ currency: string | null; items: SupplierCatalogItem[] } | null> {
  const endpoint = new URL('/products.json', origin);
  const items: SupplierCatalogItem[] = [];
  let currency: string | null = null;
  for (let page = 1; page <= 12; page++) {
    const next = new URL(endpoint);
    next.searchParams.set('limit', '250');
    next.searchParams.set('page', String(page));
    const payload = await fetchJsonPage(next.href, origin, resolveDns, fetcher);
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as Record<string, unknown>).products)) {
      return page === 1 ? null : { currency, items: normalizeItems(items) };
    }
    const products = (payload as { products: unknown[] }).products;
    if (!products.length) break;
    const parsed = parseShopifyProducts(payload, origin);
    if (parsed.currency && currency && currency !== parsed.currency) return null;
    currency = parsed.currency ?? currency;
    items.push(...parsed.items);
    if (products.length < 250 || items.length >= MAX_ITEMS) break;
  }
  return items.length ? { currency, items: normalizeItems(items) } : null;
}

export async function readSupplierCatalog(
  rawUrl: string,
  resolveDns: DnsResolver,
  fetcher: typeof fetch = fetch,
): Promise<SupplierCatalogResult> {
  const sourceUrl = validateSupplierPageUrl(rawUrl);
  const origin = sourceUrl.origin;
  for (const [source, read] of [
    ['woocommerce', readWooCommerce],
    ['shopify', readShopify],
  ] as const) {
    try {
      const catalog = await read(origin, resolveDns, fetcher);
      if (catalog?.items.length) return { source, currency: catalog.currency, items: catalog.items };
    } catch (error) {
      if (error instanceof UnsafeSupplierRedirectError) throw error;
      // Unavailable API endpoints fall through to the next supported source.
    }
  }

  const { response } = await fetchValidated(sourceUrl.href, resolveDns, fetcher);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('El sitio no permitió la lectura de su catálogo.');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^(text\/html|text\/plain|text\/csv)(?:\s*;|$)/i.test(contentType)) {
    await response.body?.cancel();
    throw new Error('El enlace no devolvió una página compatible.');
  }
  const html = await readLimitedResponseText(response);
  if (isSupplierBotChallenge(html)) throw new Error('El sitio activó una protección anti-bots. Probá con una planilla o un enlace directo al catálogo.');
  if (/text\/html/i.test(contentType)) {
    const jsonLd = parseJsonLdProducts(html, sourceUrl.href);
    if (jsonLd.items.length) return { source: 'jsonld', currency: jsonLd.currency, items: jsonLd.items };
  }
  const text = extractVisibleSupplierText(html, contentType);
  if (text.replace(/\s/g, '').length < 2) throw new Error('No encontramos texto para revisar en esa página.');
  return { source: 'text', currency: null, items: [], text };
}
