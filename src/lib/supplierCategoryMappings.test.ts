import { beforeEach, describe, expect, it, vi } from 'vitest';

const { select, eq, inFilter, upsert } = vi.hoisted(() => ({
  select: vi.fn(), eq: vi.fn(), inFilter: vi.fn(), upsert: vi.fn(),
}));
vi.mock('./supabase', () => ({
  supabase: { from: vi.fn(() => ({ select, upsert })) },
}));
import { loadSupplierCategoryMappings, saveSupplierCategoryMappings } from './supplierCategoryMappings';

beforeEach(() => { select.mockReset(); eq.mockReset(); inFilter.mockReset(); upsert.mockReset(); });

describe('remembered supplier category mappings', () => {
  it('loads mappings scoped to the owner and requested suppliers', async () => {
    const query = { eq, in: inFilter };
    select.mockReturnValue(query);
    eq.mockReturnValue(query);
    inFilter.mockResolvedValue({ data: [{ supplier_id: 'supplier-1', source_category_key: 'electronica y accesorios', target_category_id: 'category-1' }], error: null });
    await expect(loadSupplierCategoryMappings('owner-1', ['supplier-1'])).resolves.toEqual(new Map([['supplier-1:electronica y accesorios', 'category-1']]));
    expect(eq).toHaveBeenCalledWith('user_id', 'owner-1');
    expect(inFilter).toHaveBeenCalledWith('supplier_id', ['supplier-1']);
  });

  it('saves one normalized mapping per supplier and source category', async () => {
    upsert.mockResolvedValue({ error: null });
    await saveSupplierCategoryMappings('owner-1', [
      { supplierId: 'supplier-1', sourceCategoryKey: '', sourceCategoryLabel: 'Electrónica y accesorios', targetCategoryId: 'category-1' },
      { supplierId: 'supplier-1', sourceCategoryKey: '', sourceCategoryLabel: '  ELECTRÓNICA   Y accesorios ', targetCategoryId: 'category-1' },
    ]);
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0]).toEqual([{
      user_id: 'owner-1', supplier_id: 'supplier-1', source_category_key: 'electronica y accesorios',
      source_category_label: 'ELECTRÓNICA   Y accesorios', target_category_id: 'category-1',
    }]);
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'user_id,supplier_id,source_category_key' });
  });
});
