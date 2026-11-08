import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { rpc } }));

import {
  getSupplierImportStoragePaths,
  previewSupplierImportRemoval,
  removeSupplierImportBatch,
} from './resellerSupplierRemoval';

const projectUrl = 'https://project.supabase.co';
const original = `${projectUrl}/storage/v1/object/public/assets/owner/products/item/supplier-${'a'.repeat(64)}.webp`;

describe('supplier import removal', () => {
  afterEach(() => rpc.mockReset());

  it('previews exact product, protected product, photo, and empty category counts', async () => {
    rpc.mockResolvedValue({ data: {
      products: 12, protectedProducts: 2, deletableProducts: 10,
      photosToDelete: 8, emptyCategoriesToDelete: 3,
    }, error: null });

    await expect(previewSupplierImportRemoval('supplier-list')).resolves.toEqual({
      products: 12, protectedProducts: 2, deletableProducts: 10,
      photosToDelete: 8, emptyCategoriesToDelete: 3,
    });
    expect(rpc).toHaveBeenCalledWith('preview_reseller_supplier_import_removal', {
      p_supplier_list_id: 'supplier-list',
    });
  });

  it('returns a retryable batch result', async () => {
    rpc.mockResolvedValue({ data: {
      processed: 50, deleted: 48, protected: 2, storageUrls: [original],
      deletedProductIds: ['removed'], protectedProductIds: ['protected'],
      emptyCategoriesDeleted: 1, deletedCategoryIds: ['category'], remaining: 17,
    }, error: null });

    await expect(removeSupplierImportBatch('supplier-list', 50)).resolves.toEqual({
      processed: 50, deleted: 48, protected: 2, deletedProductIds: ['removed'], protectedProductIds: ['protected'], storageUrls: [original],
      emptyCategoriesDeleted: 1, deletedCategoryIds: ['category'], remaining: 17,
    });
    expect(rpc).toHaveBeenCalledWith('remove_reseller_supplier_import_batch', {
      p_supplier_list_id: 'supplier-list', p_limit: 50,
    });
  });

  it('removes only provider photo pairs stored in this project assets bucket', () => {
    const thumbnail = original.replace('.webp', '.thumb.webp');
    const otherProject = original.replace('project.supabase.co', 'other.supabase.co');
    const manual = original.replace(`supplier-${'a'.repeat(64)}`, 'manual-photo');
    expect(getSupplierImportStoragePaths([
      original, thumbnail, otherProject, manual, 'https://mrtecno.com.ar/photo.jpg',
    ], projectUrl)).toEqual([
      `owner/products/item/supplier-${'a'.repeat(64)}.webp`,
      `owner/products/item/supplier-${'a'.repeat(64)}.thumb.webp`,
    ]);
  });

  it('does not leak a raw RPC error or mark a failed batch as successful', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network issue' } });
    await expect(removeSupplierImportBatch('supplier-list')).rejects.toThrow('network issue');
  });
});
