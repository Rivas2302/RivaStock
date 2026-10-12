import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc } }));
import { getPublicCatalogProduct } from './publicCatalog';

beforeEach(() => rpc.mockReset());
describe('bounded public detail', () => {
  it('requests one product and normalizes only the safe public fields', async () => {
    rpc.mockResolvedValue({ data: { id: 'product', name: 'Mate', salePrice: '123', purchasePrice: 999 }, error: null });
    expect(await getPublicCatalogProduct('shop', 'product')).toMatchObject({ id: 'product', salePrice: 123, purchasePrice: 0 });
    expect(rpc).toHaveBeenCalledWith('get_public_catalog_product', { p_slug: 'shop', p_product_id: 'product' });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('returns null for hidden or unknown products without fetching the entire catalog', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getPublicCatalogProduct('shop', 'missing')).toBeNull();
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('supports deployments without the new migration', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing' } });
    rpc.mockResolvedValueOnce({ data: [{ id: 'product', name: 'Mate' }], error: null });
    expect(await getPublicCatalogProduct('shop', 'product')).toMatchObject({ id: 'product' });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('does not hide permission or network errors with a legacy fallback', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(getPublicCatalogProduct('shop', 'product')).rejects.toThrow('denied');
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('retains retail security and omits private fields in the SQL projection', () => {
    const sql = readFileSync('supabase/migrations/0046_public_catalog_product_detail.sql', 'utf8');
    for (const guard of ['p.id = p_product_id', 'p.user_id = cc.user_id', 'cc.enabled', 'p.show_in_catalog', 'NOT p.catalog_only', 'cc.show_out_of_stock OR p.stock > 0', 'SET search_path = public']) expect(sql).toContain(guard);
    expect(sql).not.toContain('purchase_price');
    expect(sql).not.toContain('GRANT SELECT');
    expect(sql).toContain('FROM PUBLIC');
  });
});
