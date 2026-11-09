import type { Category, Product, PublicCatalogProduct } from '../types';

export interface ResellerCatalogCategory {
  id: string;
  name: string;
  count: number;
  photoUrl: string | null;
}

export function normalizeSupplierCategoryKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR').replace(/[^a-z\d]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 120);
}

export function getResellerProductCategoryKey(product: PublicCatalogProduct, categories: Category[]): string {
  const ownerCategory = categories.find(category => category.id === product.categoryId);
  if (ownerCategory) return `owner:${ownerCategory.id}`;
  return `source:${normalizeSupplierCategoryKey(product.category || 'General') || 'general'}`;
}

export function buildResellerCatalogCategories(
  products: PublicCatalogProduct[],
  categories: Category[],
): ResellerCatalogCategory[] {
  const byId = new Map<string, ResellerCatalogCategory>();
  for (const product of products) {
    const ownerCategory = categories.find(category => category.id === product.categoryId);
    const name = ownerCategory?.name ?? product.category?.trim() ?? '';
    const normalizedName = name || 'General';
    const id = ownerCategory ? `owner:${ownerCategory.id}` : `source:${normalizeSupplierCategoryKey(normalizedName) || 'general'}`;
    const current = byId.get(id);
    if (current) {
      current.count += 1;
      current.photoUrl ??= product.images?.find(Boolean) ?? product.imageUrl ?? null;
    } else {
      byId.set(id, {
        id,
        name: normalizedName,
        count: 1,
        photoUrl: product.images?.find(Boolean) ?? product.imageUrl ?? null,
      });
    }
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, 'es-AR'));
}

export function suggestSupplierCategoryId(
  productName: string,
  supplierCategory: string,
  categories: Category[],
  rememberedCategoryId?: string | null,
): string | null {
  if (rememberedCategoryId && categories.some(category => category.id === rememberedCategoryId)) return rememberedCategoryId;
  if (categories.length === 0) return null;
  if (categories.length === 1) return categories[0].id;

  const sourceKey = normalizeSupplierCategoryKey(supplierCategory);
  const productKey = normalizeSupplierCategoryKey(productName);
  const exact = categories.find(category => normalizeSupplierCategoryKey(category.name) === sourceKey);
  if (exact && sourceKey) return exact.id;

  let best: { id: string; score: number } | null = null;
  for (const category of categories) {
    const categoryKey = normalizeSupplierCategoryKey(category.name);
    if (!categoryKey) continue;
    let score = 0;
    if (productKey.includes(categoryKey)) score = 1;
    else if (sourceKey.includes(categoryKey)) score = 0.96;
    else {
      const tokens = categoryKey.split(' ').filter(token => token.length > 2);
      const context = new Set(`${sourceKey} ${productKey}`.split(' ').filter(token => token.length > 2));
      const overlap = tokens.filter(token => context.has(token)).length;
      score = tokens.length > 0 ? overlap / tokens.length : 0;
    }
    if (!best || score > best.score) best = { id: category.id, score };
  }
  return best && best.score >= 0.75 ? best.id : null;
}

export interface SupplierCategoryReviewGroup {
  key: string;
  supplierId: string;
  supplierName: string;
  sourceCategory: string;
  productIds: string[];
  productCount: number;
  suggestedCategoryId: string | null;
}

export function buildSupplierCategoryReviewGroups(
  products: Product[],
  supplierLists: Array<{ supplierId: string; productIds: string[] }>,
  suppliers: Array<{ id: string; name: string }>,
  categories: Category[],
  rememberedMappings: Map<string, string>,
): SupplierCategoryReviewGroup[] {
  const productById = new Map(products.map(product => [product.id, product]));
  const groups = new Map<string, SupplierCategoryReviewGroup>();
  for (const list of supplierLists) {
    const supplierName = suppliers.find(supplier => supplier.id === list.supplierId)?.name ?? 'Proveedor';
    for (const productId of list.productIds) {
      const product = productById.get(productId);
      if (!product) continue;
      const sourceCategory = String(product.customFields?.supplierImportSourceCategory ?? product.category ?? 'General').trim() || 'General';
      const sourceKey = normalizeSupplierCategoryKey(sourceCategory) || 'general';
      const key = `${list.supplierId}:${sourceKey}`;
      const current = groups.get(key);
      if (current) {
        current.productIds.push(product.id);
        current.productCount += 1;
        if (!current.suggestedCategoryId) {
          current.suggestedCategoryId = suggestSupplierCategoryId(
            product.name,
            sourceCategory,
            categories,
            rememberedMappings.get(key),
          );
        }
        continue;
      }
      groups.set(key, {
        key,
        supplierId: list.supplierId,
        supplierName,
        sourceCategory,
        productIds: [product.id],
        productCount: 1,
        suggestedCategoryId: suggestSupplierCategoryId(product.name, sourceCategory, categories, rememberedMappings.get(key)),
      });
    }
  }
  return [...groups.values()].sort((left, right) => left.supplierName.localeCompare(right.supplierName, 'es-AR')
    || left.sourceCategory.localeCompare(right.sourceCategory, 'es-AR'));
}

export interface SupplierCategoryMapping {
  supplierId: string;
  sourceCategoryKey: string;
  sourceCategoryLabel: string;
  targetCategoryId: string | null;
}

export function buildSupplierCategorySuggestionPrompt(
  rows: Array<{ sourceRow: number; name: string; category: string }>,
  categories: Category[],
): string {
  const groups = new Map<string, { label: string; examples: string[] }>();
  for (const row of rows) {
    const key = normalizeSupplierCategoryKey(row.category);
    if (!key) continue;
    const group = groups.get(key) ?? { label: row.category.trim(), examples: [] };
    if (group.examples.length < 5 && !group.examples.includes(row.name.trim())) group.examples.push(row.name.trim());
    groups.set(key, group);
  }
  return [
    'Proponé una categoría propia para cada categoría de proveedor. Elegí únicamente entre las categorías permitidas; no inventes IDs.',
    'Respondé solo JSON con esta forma: {"mappings":[{"sourceCategoryKey":"...","categoryId":"..."}]}.',
    `Categorías permitidas: ${JSON.stringify(categories.map(category => ({ id: category.id, name: category.name })))}`,
    `Categorías del proveedor y ejemplos de productos: ${JSON.stringify([...groups.entries()].map(([sourceCategoryKey, group]) => ({ sourceCategoryKey, sourceCategory: group.label, examples: group.examples })))}`,
  ].join('\n');
}

export function parseSupplierCategoryAiOutput(output: string, categories: Category[]): Record<string, string> {
  const allowedIds = new Set(categories.map(category => category.id));
  const json = output.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return {};
  try {
    const value = JSON.parse(json) as { mappings?: Array<{ sourceCategoryKey?: unknown; categoryId?: unknown }> };
    return Object.fromEntries((value.mappings ?? []).flatMap(mapping => {
      const key = typeof mapping.sourceCategoryKey === 'string' ? normalizeSupplierCategoryKey(mapping.sourceCategoryKey) : '';
      const id = typeof mapping.categoryId === 'string' ? mapping.categoryId : '';
      return key && allowedIds.has(id) ? [[key, id]] : [];
    }));
  } catch {
    return {};
  }
}
