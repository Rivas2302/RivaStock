import { describe, expect, it } from 'vitest';
import { getSupplierAssetStoragePath } from './supplierPhotoStorage';

describe('supplier asset storage path', () => {
  const projectUrl = 'https://project.supabase.co';

  it('extracts only public assets paths for the current project', () => {
    expect(getSupplierAssetStoragePath(
      'https://project.supabase.co/storage/v1/object/public/assets/owner/products/item/image.thumb.webp',
      projectUrl,
    )).toBe('owner/products/item/image.thumb.webp');
    expect(getSupplierAssetStoragePath(
      'https://project.supabase.co/storage/v1/object/public/assets/owner/products/a%20b.webp',
      projectUrl,
    )).toBe('owner/products/a b.webp');
  });

  it('rejects other projects, buckets, protocols and traversal segments', () => {
    expect(getSupplierAssetStoragePath('https://other.supabase.co/storage/v1/object/public/assets/a.webp', projectUrl)).toBeNull();
    expect(getSupplierAssetStoragePath('https://project.supabase.co/storage/v1/object/public/knowledge/a.webp', projectUrl)).toBeNull();
    expect(getSupplierAssetStoragePath('http://project.supabase.co/storage/v1/object/public/assets/a.webp', projectUrl)).toBeNull();
    expect(getSupplierAssetStoragePath('https://project.supabase.co/storage/v1/object/public/assets/a/%2e%2e/b.webp', projectUrl)).toBeNull();
  });
});
