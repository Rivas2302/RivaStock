import { describe, expect, it } from 'vitest';
import type { Category, Product, PublicCatalogProduct } from '../types';
import { buildResellerCatalogCategories, buildSupplierCategoryReviewGroups, buildSupplierCategorySuggestionPrompt, getResellerProductCategoryKey, isUncategorizedCategoryName, normalizeSupplierCategoryKey, parseSupplierCategoryAiOutput, suggestSupplierCategoryId } from './resellerCatalogCategories';

const categories: Category[] = [
  { id: 'cat-perfumes', name: 'Perfumes', ownerUid: 'owner' },
  { id: 'cat-joystick', name: 'Joystick', ownerUid: 'owner' },
  { id: 'cat-chargers', name: 'Cargadores', ownerUid: 'owner' },
];
const product = (id: string, categoryId: string, category: string, imageUrl?: string): PublicCatalogProduct => ({
  id, name: id, categoryId, category, purchasePrice: 0, salePrice: 100, stock: 0, minStock: 0,
  imageUrl, images: [], showInCatalog: true, ownerUid: '', createdAt: '', updatedAt: '', availability: 'on_order',
});

describe('reseller catalog categories', () => {
  it('groups the reseller list categories and selects an automatic product photo', () => {
    expect(buildResellerCatalogCategories([
      product('perfume-a', '', 'Perfumes', 'https://img.test/perfume.webp'),
      product('perfume-b', '', 'Perfumes'),
      product('joystick-a', '', 'Electrónica y accesorios', 'https://img.test/joystick.webp'),
    ], categories)).toEqual([
      { id: 'source:electronica y accesorios', name: 'Electrónica y accesorios', count: 1, photoUrl: 'https://img.test/joystick.webp' },
      { id: 'source:perfumes', name: 'Perfumes', count: 2, photoUrl: 'https://img.test/perfume.webp' },
    ]);
  });

  it('does not expose the uncategorized bucket as a public filter', () => {
    expect(isUncategorizedCategoryName('Sin categoría')).toBe(true);
    expect(isUncategorizedCategoryName('General')).toBe(false);
    expect(buildResellerCatalogCategories([
      product('uncategorized', '', 'Sin categoría'),
      product('categorized', '', 'Perfumes'),
    ], categories).map(category => category.name)).toEqual(['Perfumes']);
  });

  it('uses owner category IDs when imported products have been mapped', () => {
    const mapped = product('perfume-a', 'cat-perfumes', 'Perfumes');
    expect(getResellerProductCategoryKey(mapped, categories)).toBe('owner:cat-perfumes');
    expect(buildResellerCatalogCategories([mapped], categories)[0]).toMatchObject({ id: 'owner:cat-perfumes', name: 'Perfumes', count: 1 });
  });

  it('suggests exact and clear product-name matches, while leaving unclear names for AI', () => {
    expect(normalizeSupplierCategoryKey('Electrónica y accesorios')).toBe('electronica y accesorios');
    expect(suggestSupplierCategoryId('Perfumes importados', 'Perfumería', categories)).toBe('cat-perfumes');
    expect(suggestSupplierCategoryId('Joystick inalámbrico', 'Electrónica y accesorios', categories)).toBe('cat-joystick');
    expect(suggestSupplierCategoryId('Artículo variado', 'General', categories)).toBeNull();
    expect(suggestSupplierCategoryId('Artículo variado', 'General', categories, 'cat-chargers')).toBe('cat-chargers');
    expect(suggestSupplierCategoryId('Artículo variado', 'General', [categories[0]])).toBe('cat-perfumes');
  });

  it('asks AI for a remembered supplier-category mapping and accepts only known category IDs', () => {
    const prompt = buildSupplierCategorySuggestionPrompt([
      { sourceRow: 4, name: 'Joystick inalámbrico', category: 'Electrónica y accesorios' },
    ], categories);
    expect(prompt).toContain('sourceCategoryKey');
    expect(prompt).toContain('Joystick inalámbrico');
    expect(parseSupplierCategoryAiOutput('{"mappings":[{"sourceCategoryKey":"Electrónica y accesorios","categoryId":"cat-joystick"},{"sourceCategoryKey":"Otra","categoryId":"foreign"}]}', categories)).toEqual({ 'electronica y accesorios': 'cat-joystick' });
  });

  it('builds existing-product review groups per supplier and source category, using saved mappings', () => {
    const products: Product[] = [
      { id: 'one', name: 'Joystick inalámbrico', categoryId: '', category: 'Electrónica y accesorios', purchasePrice: 100, salePrice: 150, stock: 0, minStock: 0, showInCatalog: true, ownerUid: 'owner', createdAt: '', updatedAt: '', customFields: { supplierImportSourceCategory: 'Electrónica y accesorios' } },
      { id: 'two', name: 'Joystick USB', categoryId: '', category: 'Electrónica y accesorios', purchasePrice: 100, salePrice: 150, stock: 0, minStock: 0, showInCatalog: true, ownerUid: 'owner', createdAt: '', updatedAt: '' },
      { id: 'three', name: 'Perfume floral', categoryId: '', category: 'Perfumes', purchasePrice: 100, salePrice: 150, stock: 0, minStock: 0, showInCatalog: true, ownerUid: 'owner', createdAt: '', updatedAt: '' },
    ];
    const groups = buildSupplierCategoryReviewGroups(products, [
      { supplierId: 'supplier-a', productIds: ['one', 'two'] },
      { supplierId: 'supplier-b', productIds: ['three'] },
    ], [{ id: 'supplier-a', name: 'Braja' }, { id: 'supplier-b', name: 'Omega' }], categories,
    new Map([['supplier-a:electronica y accesorios', 'cat-chargers']]));
    expect(groups).toMatchObject([
      { supplierId: 'supplier-a', supplierName: 'Braja', sourceCategory: 'Electrónica y accesorios', productIds: ['one', 'two'], productCount: 2, suggestedCategoryId: 'cat-chargers' },
      { supplierId: 'supplier-b', supplierName: 'Omega', sourceCategory: 'Perfumes', productIds: ['three'], productCount: 1, suggestedCategoryId: 'cat-perfumes' },
    ]);
  });
});
