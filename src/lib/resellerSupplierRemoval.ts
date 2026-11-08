import { supabase } from './supabase';

export interface SupplierImportRemovalPreview {
  products: number;
  protectedProducts: number;
  deletableProducts: number;
  photosToDelete: number;
  emptyCategoriesToDelete: number;
}

export interface SupplierImportRemovalBatch {
  processed: number;
  deleted: number;
  protected: number;
  deletedProductIds: string[];
  protectedProductIds: string[];
  storageUrls: string[];
  emptyCategoriesDeleted: number;
  deletedCategoryIds: string[];
  remaining: number;
}

export function getSupplierImportStoragePaths(urls: string[], projectUrl: string): string[] {
  let projectOrigin: string;
  try { projectOrigin = new URL(projectUrl).origin; }
  catch { return []; }
  const paths = new Set<string>();
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.origin !== projectOrigin) continue;
      const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/assets\/(.+)$/i);
      if (!match) continue;
      const path = decodeURIComponent(match[1]);
      if (!/(?:^|\/)products\/[^/]+\/supplier-[a-f0-9]{64}(?:\.thumb)?\.webp$/i.test(path)) continue;
      const originalPath = path.replace(/\.thumb(?=\.webp$)/i, '');
      paths.add(originalPath);
      paths.add(originalPath.replace(/\.webp$/i, '.thumb.webp'));
    } catch {
      // Invalid or non-project URLs are never passed to Storage removal.
    }
  }
  return [...paths];
}

function asInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function previewSupplierImportRemoval(supplierListId: string): Promise<SupplierImportRemovalPreview> {
  const { data, error } = await supabase.rpc('preview_reseller_supplier_import_removal', {
    p_supplier_list_id: supplierListId,
  });
  if (error) throw new Error(error.message || 'No se pudo revisar la importación.');
  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return {
    products: asInteger(result.products),
    protectedProducts: asInteger(result.protectedProducts),
    deletableProducts: asInteger(result.deletableProducts),
    photosToDelete: asInteger(result.photosToDelete),
    emptyCategoriesToDelete: asInteger(result.emptyCategoriesToDelete),
  };
}

export async function removeSupplierImportBatch(supplierListId: string, limit = 50): Promise<SupplierImportRemovalBatch> {
  const { data, error } = await supabase.rpc('remove_reseller_supplier_import_batch', {
    p_supplier_list_id: supplierListId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message || 'No se pudo quitar esta tanda. Podés reintentar.');
  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return {
    processed: asInteger(result.processed),
    deleted: asInteger(result.deleted),
    protected: asInteger(result.protected),
    deletedProductIds: Array.isArray(result.deletedProductIds)
      ? result.deletedProductIds.filter((id): id is string => typeof id === 'string')
      : [],
    protectedProductIds: Array.isArray(result.protectedProductIds)
      ? result.protectedProductIds.filter((id): id is string => typeof id === 'string')
      : [],
    storageUrls: Array.isArray(result.storageUrls)
      ? result.storageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
      : [],
    emptyCategoriesDeleted: asInteger(result.emptyCategoriesDeleted),
    deletedCategoryIds: Array.isArray(result.deletedCategoryIds)
      ? result.deletedCategoryIds.filter((id): id is string => typeof id === 'string')
      : [],
    remaining: asInteger(result.remaining),
  };
}
