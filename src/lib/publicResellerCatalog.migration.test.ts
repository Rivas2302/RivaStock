import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0040_public_reseller_catalog.sql'),
  'utf8',
);
const hardening = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0041_harden_public_catalog_access.sql'),
  'utf8',
);

function exactFunction(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) return '';
  const end = migration.indexOf('\n$$;', start);
  return migration.slice(start, end + 4);
}

describe('public reseller catalog migrations', () => {
  it('stores private access and every supported commercial rule', () => {
    expect(migration).toContain('access_code_hash text');
    expect(migration).toContain("minimum_rule IN ('none', 'amount', 'quantity', 'both')");
    expect(migration).toContain("extensions.digest(v_code, 'sha256')");
    expect(migration).not.toContain('access_code text');
  });

  it('never returns purchase cost in either public catalog projection', () => {
    const retail = exactFunction('get_public_catalog_products');
    const reseller = exactFunction('unlock_reseller_catalog');
    expect(retail).not.toContain('purchase_price');
    expect(reseller).not.toContain('purchase_price');
    expect(retail).toContain("'salePrice'");
    expect(reseller).toContain("'salePrice'");
  });

  it('recalculates order prices and minimums on the server', () => {
    const order = exactFunction('create_public_catalog_order');
    expect(order).toContain('v_product.sale_price');
    expect(order).toContain('v_list_item.fixed_price');
    expect(order).toContain("v_list.minimum_rule IN ('amount', 'both')");
    expect(order).toContain("v_list.minimum_rule IN ('quantity', 'both')");
    expect(order).not.toContain("v_input->>'price'");
    expect(order).not.toContain("p_customer->>'total'");
  });

  it('allows on-order items without immediate stock but protects in-stock items', () => {
    const order = exactFunction('create_public_catalog_order');
    expect(order).toContain("v_list_item.availability = 'in_stock'");
    expect(order).toContain('v_quantity > v_product.stock');
  });

  it('only exposes safe public RPCs and removes legacy direct access', () => {
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION get_public_catalog_products(text) TO anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION create_public_catalog_order(text, text, text, jsonb, jsonb) TO anon, authenticated');
    expect(migration).not.toContain('GRANT EXECUTE ON FUNCTION configure_reseller_price_list(uuid, boolean, text, text, numeric, integer) TO anon');
    expect(hardening).toContain('DROP POLICY IF EXISTS "products_catalog_public"');
    expect(hardening).toContain('DROP POLICY IF EXISTS "orders_public_insert"');
    expect(hardening).toContain('REVOKE SELECT ON products FROM anon');
    expect(hardening).toContain('REVOKE INSERT ON orders FROM anon');
  });
});
