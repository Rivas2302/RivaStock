import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0044_reseller_supplier_order_lists.sql'),
  'utf8',
);

function exactFunction(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) return '';
  const end = migration.indexOf('\n$$;', start);
  return migration.slice(start, end + 4);
}

describe('reseller supplier order lists migration', () => {
  it('persists reusable supplier groups independently from their public state', () => {
    expect(migration).toContain('CREATE TABLE reseller_supplier_lists');
    expect(migration).toContain('CREATE TABLE reseller_supplier_list_items');
    expect(migration).toContain('enabled       boolean NOT NULL DEFAULT false');
    expect(migration).toContain('UNIQUE (price_list_id, supplier_id)');
    expect(migration).toContain('UNIQUE (user_id, product_id)');
    expect(migration).toContain('REFERENCES reseller_supplier_lists(id) ON DELETE CASCADE');
  });

  it('publishes or removes every supplier product atomically', () => {
    const toggle = exactFunction('toggle_reseller_supplier_list');
    expect(toggle).toContain("'on_order'");
    expect(toggle).toContain('ON CONFLICT (price_list_id, product_id) DO UPDATE');
    expect(toggle).toContain('DELETE FROM price_list_items');
    expect(toggle).toContain('WHERE supplier_list_id = v_supplier_list.id');
  });

  it('hides exhausted immediate items from the public reseller response', () => {
    const status = exactFunction('get_reseller_catalog_status');
    const unlock = exactFunction('unlock_reseller_catalog');
    expect(status).toContain("pli.availability = 'on_order' OR p.stock > 0");
    expect(unlock).toContain("pli.availability = 'on_order' OR p.stock > 0");
  });

  it('protects supplier list mutations with stock write permission', () => {
    expect(migration).toContain("has_permission(auth.uid(), 'stock', 'write')");
    expect(migration).toContain('REVOKE ALL ON FUNCTION save_reseller_supplier_list(uuid, uuid, uuid[]) FROM PUBLIC');
    expect(migration).toContain('REVOKE ALL ON FUNCTION toggle_reseller_supplier_list(uuid, boolean) FROM PUBLIC');
  });
});
