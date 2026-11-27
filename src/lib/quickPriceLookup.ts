import type { InventoryHolding, Product } from '../types';
import { normalizeBarcode } from './barcode';

const SKU_KEYS = ['sku', 'codigo', 'código', 'code'];
const VARIANT_KEYS = ['variante', 'variant'];
const MODEL_KEYS = ['modelo', 'model'];

export interface QuickPriceLoadState {
  status: 'loading' | 'ready' | 'error';
  scopeKey: string | null;
  products: Product[];
  holdings: InventoryHolding[];
  error: string | null;
}

export type QuickPriceLoadAction =
  | { type: 'start'; scopeKey: string }
  | { type: 'success'; scopeKey: string; products: Product[]; holdings: InventoryHolding[] }
  | { type: 'failure'; scopeKey: string; error: string };

export const initialQuickPriceLoadState: QuickPriceLoadState = {
  status: 'loading',
  scopeKey: null,
  products: [],
  holdings: [],
  error: null,
};

export function quickPriceLoadReducer(
  state: QuickPriceLoadState,
  action: QuickPriceLoadAction,
): QuickPriceLoadState {
  if (action.type === 'start') {
    // Keep a usable catalog visible during focus/online refetches. Only the
    // first load (or a retry after an initial failure) is blocking.
    return state.status === 'ready' && state.scopeKey === action.scopeKey
      ? state
      : {
          status: 'loading',
          scopeKey: action.scopeKey,
          products: [],
          holdings: [],
          error: null,
        };
  }
  if (action.type === 'success') {
    if (state.scopeKey !== action.scopeKey) return state;
    return {
      status: 'ready',
      scopeKey: action.scopeKey,
      products: action.products,
      holdings: action.holdings,
      error: null,
    };
  }
  if (state.scopeKey !== action.scopeKey) return state;
  // A background refresh failure must not replace an already usable catalog.
  return state.status === 'ready'
    ? state
    : { ...state, status: 'error', error: action.error };
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .trim()
    .replace(/\s+/g, ' ');
}

function customFieldValue(
  fields: Product['customFields'],
  aliases: string[],
): string | null {
  if (!fields) return null;

  const normalizedAliases = new Set(aliases.map(normalizeText));
  for (const [key, value] of Object.entries(fields)) {
    if (!normalizedAliases.has(normalizeText(key)) || value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }

  return null;
}

export function findProductByBarcode(
  products: Product[],
  rawCode: string,
): Product | null {
  const code = normalizeBarcode(rawCode);
  if (!code) return null;
  return products.find((product) => normalizeBarcode(product.barcode ?? '') === code) ?? null;
}

interface QuickPriceCatalogOptions {
  products: Product[];
  holdings: InventoryHolding[];
  holdingsEnabled: boolean;
  allowedInventoryOwnerIds: string[];
}

export function getVisibleQuickPriceProducts({
  products,
  holdings,
  holdingsEnabled,
  allowedInventoryOwnerIds,
}: QuickPriceCatalogOptions): Product[] {
  if (!holdingsEnabled) return products;

  const allowedOwnerIds = new Set(allowedInventoryOwnerIds);
  const allowedHoldings = holdings.filter((holding) => (
    holding.active && allowedOwnerIds.has(holding.inventoryOwnerId)
  ));
  const visibleProductIds = new Set(allowedHoldings.map((holding) => holding.productId));
  return products.filter((product) => visibleProductIds.has(product.id));
}

export function resolveSelectedProduct(
  visibleProducts: Product[],
  selectedProductId: string | null,
): Product | null {
  if (!selectedProductId) return null;
  return visibleProducts.find((product) => product.id === selectedProductId) ?? null;
}

export function searchProducts(products: Product[], rawQuery: string): Product[] {
  return searchQuickPriceProducts(products, rawQuery);
}

export function buildQuickPriceProductCodes(products: Product[]): Map<string, string> {
  const skuCounts = new Map<string, number>();
  const codeOwners = new Map<string, Set<string>>();
  const reservedCodes = new Set<string>();

  for (const product of products) {
    const sku = getProductSku(product);
    const barcode = product.barcode?.trim() ?? '';
    for (const code of [sku, barcode]) {
      if (!code) continue;
      const key = normalizeText(code);
      reservedCodes.add(key);
      const owners = codeOwners.get(key) ?? new Set<string>();
      owners.add(product.id);
      codeOwners.set(key, owners);
    }
    if (sku) {
      const key = normalizeText(sku);
      skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
    }
  }

  const codes = new Map<string, string>();
  for (const product of products) {
    const sku = getProductSku(product);
    if (!sku) continue;
    const key = normalizeText(sku);
    const owners = codeOwners.get(key);
    if (skuCounts.get(key) === 1 && owners?.size === 1) {
      codes.set(product.id, sku);
      reservedCodes.add(key);
    }
  }

  for (const product of products) {
    if (codes.has(product.id)) continue;
    const compactId = product.id.replace(/[^a-z0-9]/gi, '').toUpperCase() || 'PRODUCT';
    let code = '';
    for (let length = Math.min(6, compactId.length); length <= compactId.length; length += 1) {
      const candidate = `RT-${compactId.slice(-length)}`;
      const key = normalizeText(candidate);
      if (reservedCodes.has(key)) continue;
      code = candidate;
      reservedCodes.add(key);
      break;
    }
    if (!code) {
      // A product ID is unique in the catalog; this fallback only matters if
      // an existing user SKU already happens to use the full generated code.
      code = `RT-${compactId}-ID`;
      if (reservedCodes.has(normalizeText(code))) {
        let hash = 2166136261;
        for (const character of product.id) {
          hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
        }
        code = `RT-${compactId}-${(hash >>> 0).toString(36).toUpperCase()}`;
      }
      reservedCodes.add(normalizeText(code));
    }
    codes.set(product.id, code);
  }

  return codes;
}

export function getExactQuickPriceCodeMatchIds(
  products: Product[],
  rawQuery: string,
  productCodes: ReadonlyMap<string, string>,
): Set<string> {
  const query = normalizeText(rawQuery);
  if (!query) return new Set();
  return new Set(products.flatMap((product) => {
    const codes = [productCodes.get(product.id) ?? '', product.barcode ?? ''];
    return codes.some((code) => code && normalizeText(code) === query) ? [product.id] : [];
  }));
}

export function searchQuickPriceProducts(
  products: Product[],
  rawQuery: string,
  productCodes?: ReadonlyMap<string, string>,
): Product[] {
  const query = normalizeText(rawQuery);
  if (!query) return [];
  const terms = query.split(' ');

  return products.flatMap((product, index) => {
    const customValues = Object.values(product.customFields ?? {})
      .filter((value) => value != null)
      .map((value) => String(value));
    const searchableValues = [
      product.name,
      product.category,
      product.barcode ?? '',
      getProductSku(product) ?? '',
      getProductVariantModel(product) ?? '',
      productCodes?.get(product.id) ?? '',
      ...customValues,
      ...Object.keys(product.customFields ?? {}),
    ].map(normalizeText);
    const name = normalizeText(product.name);
    const matchesEveryTerm = terms.every((term) => searchableValues.some((value) => value.includes(term)));
    if (!matchesEveryTerm) return [];

    const exactProductCode = [product.barcode ?? '', productCodes?.get(product.id) ?? '']
      .some((code) => code && normalizeText(code) === query);
    const rank = exactProductCode
      ? 0
      : name.startsWith(query)
        ? 1
      : terms.every((term) => name.includes(term))
          ? 2
          : 3;
    return [{ product, rank, index }];
  })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ product }) => product);
}

export function getProductSku(product: Product): string | null {
  return customFieldValue(product.customFields, SKU_KEYS);
}

export function getProductVariantModel(product: Product): string | null {
  const variant = customFieldValue(product.customFields, VARIANT_KEYS);
  const model = customFieldValue(product.customFields, MODEL_KEYS);
  return [variant, model].filter(Boolean).join(' · ') || null;
}

export function getProductImage(product: Product): string | null {
  const imageUrl = product.imageUrl?.trim();
  if (imageUrl) return imageUrl;
  return product.images?.find((image) => Boolean(image?.trim()))?.trim() ?? null;
}
