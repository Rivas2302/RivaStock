import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0045_reseller_catalog_only_products.sql'),
  'utf8',
);

function exactFunction(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) return '';
  const end = migration.indexOf('\n$$;', start);
  return migration.slice(start, end + 4);
}

describe('catalog-only reseller products migration', () => {
  it('separates supplier catalog products from inventory', () => {
    expect(migration).toContain('catalog_only boolean NOT NULL DEFAULT false');
    expect(migration).toContain('catalog_cost numeric');
  });

  it('promotes only products with real stock and detaches supplier-list control', () => {
    const promotion = exactFunction('promote_reseller_catalog_product');
    expect(promotion).toContain('v_product.stock <= 0');
    expect(promotion).toContain('DELETE FROM reseller_supplier_list_items');
    expect(promotion).toContain('supplier_list_id = NULL');
    expect(promotion).toContain("availability = 'in_stock'");
    expect(promotion).toContain('INSERT INTO price_list_items');
    expect(promotion).toContain('v_price_list_id IS NOT NULL');
    expect(promotion).toContain('catalog_only = false');
  });

  it('keeps catalog-only products out of the retail catalog projection', () => {
    expect(exactFunction('get_public_catalog_products')).toContain('AND NOT p.catalog_only');
  });

  it('protects promotion from anonymous callers', () => {
    expect(migration).toContain("has_permission(auth.uid(), 'stock', 'write')");
    expect(migration).toContain('REVOKE ALL ON FUNCTION promote_reseller_catalog_product(uuid) FROM PUBLIC, anon');
  });
});
