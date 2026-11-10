import { describe, expect, it } from 'vitest';
import { restoreMobileProductDraft, saveMobileProductDraft } from './mobileProductDraft';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function draft(ownerUid = 'business-a') {
  return {
    ownerUid,
    pathname: '/stock',
    formData: { id: 'temporary-product-id', name: 'Lámpara', images: [] },
    holdingDrafts: [],
    editingProduct: null,
    creatingProductForReseller: false,
    supplierProductCreationContext: null,
    promotingCatalogProduct: false,
    returnToResellerList: false,
  };
}

describe('mobile product draft recovery', () => {
  it('restores a new product draft once when the Android tab returns to its editor route', () => {
    const storage = createStorage();
    expect(saveMobileProductDraft(draft(), storage, 1000)).toBe(true);

    const restored = restoreMobileProductDraft('business-a', '/stock', '?nuevo=1', storage, 2000);

    expect(restored?.formData).toMatchObject({ id: 'temporary-product-id', name: 'Lámpara' });
    expect(restoreMobileProductDraft('business-a', '/stock', '?nuevo=1', storage, 2001)).toBeNull();
  });

  it('does not restore a draft for another account or route and removes expired drafts', () => {
    const storage = createStorage();
    saveMobileProductDraft(draft(), storage, 1000);

    expect(restoreMobileProductDraft('business-b', '/stock', '?nuevo=1', storage, 2000)).toBeNull();
    expect(restoreMobileProductDraft('business-a', '/catalogo', '?nuevo=1', storage, 2000)).toBeNull();
    expect(restoreMobileProductDraft('business-a', '/stock', '?nuevo=1', storage, 7_201_001)).toBeNull();
    expect(restoreMobileProductDraft('business-a', '/stock', '?nuevo=1', storage, 7_201_002)).toBeNull();
  });
});
