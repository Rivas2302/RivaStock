import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0039_reseller_price_lists.sql'),
  'utf8',
);

function exactFunction(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) return '';
  const end = migration.indexOf('\n$$;', start);
  return migration.slice(start, end + 4);
}

describe('reseller price lists migration', () => {
  it('stores list prices separately from products and keeps one item per product', () => {
    expect(migration).toContain('CREATE TABLE price_lists');
    expect(migration).toContain('CREATE TABLE price_list_items');
    expect(migration).toContain('REFERENCES products(id) ON DELETE CASCADE');
    expect(migration).toContain('UNIQUE (price_list_id, product_id)');
  });

  it('supports automatic, custom-discount and fixed pricing', () => {
    expect(migration).toContain("pricing_mode IN ('default', 'discount', 'fixed')");
    expect(migration).toContain("pricing_mode = 'discount'");
    expect(migration).toContain("pricing_mode = 'fixed'");
  });

  it('models immediate and on-order availability independently of stock', () => {
    expect(migration).toContain("availability IN ('in_stock', 'on_order')");
    expect(migration).toContain("CASE WHEN p.stock > 0 THEN 'in_stock' ELSE 'on_order' END");
  });

  it('initializes the reseller list with all existing products', () => {
    const fn = exactFunction('ensure_reseller_price_list');
    expect(fn).toContain("VALUES (v_uid, 'Revendedores', 'reseller', p_default_discount)");
    expect(fn).toContain('FROM products p');
    expect(fn).toContain('ON CONFLICT (price_list_id, product_id) DO NOTHING');
  });

  it('saves the complete list atomically and validates account-owned products', () => {
    const fn = exactFunction('save_reseller_price_list');
    expect(fn).toContain("has_permission(auth.uid(), 'stock', 'write')");
    expect(fn).toContain('DELETE FROM price_list_items');
    expect(fn).toContain('jsonb_array_elements');
    expect(fn).toContain('p.user_id = v_uid');
  });

  it('does not expose mutation RPCs to anonymous users', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION ensure_reseller_price_list(numeric) FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION ensure_reseller_price_list(numeric) TO authenticated');
    expect(migration).not.toContain('TO anon');
  });
});
