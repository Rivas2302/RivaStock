import type { InventoryHolding, Product } from '../types';
import { normalizeBarcode } from './barcode';

const SKU_KEYS = ['sku', 'codigo', 'código', 'code'];
const VARIANT_KEYS = ['variante', 'variant'];
const MODEL_KEYS = ['modelo', 'model'];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .trim();
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
  const query = normalizeText(rawQuery);
  if (!query) return [];

  return products.filter((product) => {
    const customValues = Object.values(product.customFields ?? {})
      .filter((value) => value != null)
      .map((value) => String(value));
    const searchableValues = [
      product.name,
      product.category,
      product.barcode ?? '',
      ...customValues,
    ];

    return searchableValues.some((value) => normalizeText(value).includes(query));
  });
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
