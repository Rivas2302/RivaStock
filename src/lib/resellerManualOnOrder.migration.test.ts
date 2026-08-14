import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0042_reseller_manual_on_order_products.sql'),
  'utf8',
);

describe('manual on-order reseller products migration', () => {
  it('initializes the reseller list with in-stock products only', () => {
    expect(migration).toContain("'in_stock'");
    expect(migration).toContain('AND p.stock > 0');
    expect(migration).not.toContain("CASE WHEN p.stock > 0 THEN 'in_stock' ELSE 'on_order' END");
  });

  it('cleans legacy automatic on-order items that have no stock', () => {
    expect(migration).toContain('DELETE FROM price_list_items pli');
    expect(migration).toContain("pli.availability = 'on_order'");
    expect(migration).toContain('p.stock <= 0');
  });

  it('keeps list initialization protected from anonymous access', () => {
    expect(migration).toContain("has_permission(auth.uid(), 'stock', 'write')");
    expect(migration).toContain('REVOKE ALL ON FUNCTION ensure_reseller_price_list(numeric) FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION ensure_reseller_price_list(numeric) TO authenticated');
  });
});
