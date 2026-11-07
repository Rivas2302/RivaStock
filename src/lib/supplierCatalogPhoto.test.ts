import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import {
  getSupplierCatalogImageUrl,
  hasProductPhoto,
  isLegacySupplierPhotoUrl,
  isSupplierManagedPhotoUrl,
  shouldReplaceWithSupplierPhoto,
  withImportedProductPhoto,
} from './supplierCatalogPhoto';

const supplierUrl = 'https://supplier.example/catalog';
const product = (patch: Partial<Product> = {}): Product => ({
  id: 'product-1', name: 'Cable', categoryId: 'cat-1', category: 'Accesorios',
  purchasePrice: 0, salePrice: 100, stock: 0, minStock: 0, showInCatalog: false,
  ownerUid: 'owner-1', createdAt: '', updatedAt: '', ...patch,
});

describe('supplier catalog photos', () => {
  it('accepts only HTTPS images from the supplier origin', () => {
    expect(getSupplierCatalogImageUrl('https://supplier.example/photo.jpg?size=small', supplierUrl))
      .toBe('https://supplier.example/photo.jpg?size=small');
    expect(getSupplierCatalogImageUrl('http://supplier.example/photo.jpg', supplierUrl)).toBeNull();
    expect(getSupplierCatalogImageUrl('https://cdn.supplier.example/photo.jpg', supplierUrl)).toBeNull();
    expect(getSupplierCatalogImageUrl('data:image/png;base64,abc', supplierUrl)).toBeNull();
  });

  it('counts selected, existing and source photos while keeping no-photo rows explicit', () => {
    expect(hasProductPhoto(product())).toBe(false);
    expect(hasProductPhoto(product({ images: ['https://assets.example/photo.webp'] }))).toBe(true);
    expect(getSupplierCatalogImageUrl('https://supplier.example/photo.webp', supplierUrl)).not.toBeNull();
  });

  it('preserves a business photo, but permits replacing a legacy provider URL', () => {
    expect(shouldReplaceWithSupplierPhoto(product({ imageUrl: 'https://assets.example/manual.webp' }), supplierUrl)).toBe(false);
    expect(shouldReplaceWithSupplierPhoto(product({ imageUrl: 'https://supplier.example/old.jpg' }), supplierUrl)).toBe(true);
    expect(isLegacySupplierPhotoUrl('https://supplier.example/old.jpg', supplierUrl)).toBe(true);
  });

  it('recognizes supplier-managed Storage photos and refreshes only those', () => {
    const supplierStorageUrl = 'https://project.supabase.co/storage/v1/object/public/assets/owner-1/products/product-1/supplier-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp';
    expect(isSupplierManagedPhotoUrl(supplierStorageUrl)).toBe(true);
    expect(isSupplierManagedPhotoUrl('https://project.supabase.co/storage/v1/object/public/assets/owner-1/products/product-1/123_manual.webp')).toBe(false);
    const current = product({ imageUrl: supplierStorageUrl });
    expect(shouldReplaceWithSupplierPhoto(current, supplierUrl)).toBe(true);
    expect(withImportedProductPhoto(current, 'https://project.supabase.co/new.webp', supplierUrl).imageUrl)
      .toBe('https://project.supabase.co/new.webp');
  });

  it('does not replace a manual primary photo when a supplier image is imported', () => {
    const current = product({ imageUrl: 'https://project.supabase.co/manual.webp' });
    expect(withImportedProductPhoto(current, 'https://project.supabase.co/supplier.webp', supplierUrl).imageUrl)
      .toBe(current.imageUrl);
  });
});
