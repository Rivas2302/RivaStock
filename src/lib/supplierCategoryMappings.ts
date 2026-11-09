import { supabase } from './supabase';
import { normalizeSupplierCategoryKey, type SupplierCategoryMapping } from './resellerCatalogCategories';

export function supplierCategoryMappingKey(supplierId: string, sourceCategory: string): string {
  return `${supplierId}:${normalizeSupplierCategoryKey(sourceCategory)}`;
}

export async function loadSupplierCategoryMappings(ownerUid: string, supplierIds?: string[]): Promise<Map<string, string>> {
  let query = supabase.from('reseller_supplier_category_mappings')
    .select('supplier_id,source_category_key,target_category_id')
    .eq('user_id', ownerUid);
  if (supplierIds?.length) query = query.in('supplier_id', supplierIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return new Map((data ?? []).flatMap(row => typeof row.target_category_id === 'string'
    ? [[`${row.supplier_id}:${row.source_category_key}`, row.target_category_id]]
    : []));
}

export async function saveSupplierCategoryMappings(ownerUid: string, mappings: SupplierCategoryMapping[]): Promise<void> {
  const rows = [...new Map(mappings.flatMap(mapping => {
    const sourceCategoryKey = normalizeSupplierCategoryKey(mapping.sourceCategoryLabel);
    return mapping.targetCategoryId && sourceCategoryKey
      ? [[`${mapping.supplierId}:${sourceCategoryKey}`, {
        user_id: ownerUid,
        supplier_id: mapping.supplierId,
        source_category_key: sourceCategoryKey,
        source_category_label: mapping.sourceCategoryLabel.trim().slice(0, 120),
        target_category_id: mapping.targetCategoryId,
      }] as const]
      : [];
  })).values()];
  if (rows.length === 0) return;
  const { error } = await supabase.from('reseller_supplier_category_mappings')
    .upsert(rows, { onConflict: 'user_id,supplier_id,source_category_key' });
  if (error) throw new Error(error.message);
}
