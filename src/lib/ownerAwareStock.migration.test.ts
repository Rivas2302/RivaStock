import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0033_owner_aware_stock.sql'),
  'utf8',
);

function functionBody(name: string, nextName?: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  const end = nextName
    ? migration.indexOf(`CREATE OR REPLACE FUNCTION ${nextName}`, start + 1)
    : migration.length;
  return migration.slice(start, end);
}

describe('owner-aware stock migration contract', () => {
  it('saves one product and multiple holdings atomically behind the feature flag', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION save_product_with_holdings');
    expect(migration).toContain("jsonb_array_elements(p_holdings)");
    expect(migration).toContain('INSERT INTO products');
    expect(migration).toContain('INSERT INTO inventory_holdings');
    expect(migration).toContain('holdings_enabled');
    expect(migration).toContain('FOR UPDATE');
  });

  it('records receive and edit deltas with owner and actor snapshots and idempotency', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION receive_inventory_holding_stock');
    expect(migration).toContain('inventory_owner_name');
    expect(migration).toContain('actor_uid');
    expect(migration).toContain('idempotency_key');
    expect(migration).toContain('UNIQUE (user_id, idempotency_key)');
    expect(migration).toContain('INSERT INTO inventory_stock_commands');
  });

  it('serializes idempotent product saves, receipts and stock mutations and rejects payload changes', () => {
    expect(migration.match(/pg_advisory_xact_lock\(hashtextextended\(v_uid::text \|\| ':' \|\| p_idempotency_key, 0\)\)/g))
      .toHaveLength(3);
    expect(migration).toContain("p_product - 'updatedAt' - 'createdAt'");
    expect(migration).toContain('v_intake.product_id IS DISTINCT FROM p_product_id');
    expect(migration).toContain('v_intake.quantity IS DISTINCT FROM p_quantity');
    expect(migration).toContain('La clave de idempotencia ya fue usada con otros datos');
  });

  it('uses the migrated UUID type for stock intake product references', () => {
    expect(migration).toContain('p.id = intake.product_id');
    expect(migration).not.toContain('p.id::text = intake.product_id');
    expect(migration).toMatch(/COALESCE\(p_date, CURRENT_DATE\), p_product_id, v_product_name/);
  });

  it('requires module and owner membership permissions and rejects archived owners', () => {
    expect(migration).toContain("has_permission(auth.uid(), 'stock', 'write')");
    expect(migration).toContain("has_permission(auth.uid(), 'ingresos', 'write')");
    expect(migration).toContain('membership.can_operate');
    expect(migration).toContain('io.archived_at IS NULL');
  });

  it('scopes intake history to the owners assigned to the current actor', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "stock_intakes_select"');
    expect(migration).toContain('membership.inventory_owner_id = stock_intakes.inventory_owner_id');
    expect(migration).toContain("has_permission(auth.uid(), 'ingresos', 'read')");
  });

  it('keeps unattributed legacy intake history readable regardless of the holdings flag', () => {
    const policy = migration.slice(
      migration.indexOf('CREATE POLICY "stock_intakes_select"'),
      migration.indexOf('DROP POLICY IF EXISTS "inventory_stock_commands_select"'),
    );
    expect(policy).toContain('OR stock_intakes.inventory_owner_id IS NULL');
    expect(policy).not.toContain('holdings_enabled');
  });

  it('scopes both command ledgers to assigned inventory owners', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "inventory_stock_commands_select"');
    expect(migration).toContain('membership.inventory_owner_id = inventory_stock_commands.inventory_owner_id');
    expect(migration).toContain("jsonb_array_elements(COALESCE(inventory_product_commands.payload->'holdings', '[]'::jsonb))");
    expect(migration).toContain("requested.value->>'inventoryOwnerId'");
  });

  it('retains audit snapshots without product delete restrictions', () => {
    expect(migration).toContain('DROP CONSTRAINT inventory_stock_commands_product_tenant_fk');
    expect(migration).not.toContain('CONSTRAINT inventory_product_commands_product_tenant_fk');
    expect(migration).not.toContain('REFERENCES products (user_id, id) ON DELETE RESTRICT');
  });

  it('blocks new feature activation until legacy sales and returns are adapted', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION set_inventory_holdings_enabled');
    expect(migration).toMatch(/UPDATE inventory_operation_settings[\s\S]*SET holdings_enabled = false/);
    expect(functionBody('set_inventory_holdings_enabled')).toMatch(/IF p_enabled THEN[\s\S]*RAISE EXCEPTION/);
    expect(migration).toContain('La activación de stock compartido está pausada');
  });

  it('revalidates current owner operation access before every idempotent replay', () => {
    const save = functionBody('save_product_with_holdings', 'receive_inventory_holding_stock');
    const intake = functionBody('receive_inventory_holding_stock', 'mutate_inventory_holding_stock');
    const mutation = functionBody('mutate_inventory_holding_stock', 'transfer_inventory_holding_stock');

    expect(save.indexOf('membership.can_operate')).toBeGreaterThan(-1);
    expect(save.indexOf('membership.can_operate')).toBeLessThan(save.indexOf('FROM inventory_product_commands'));
    expect(intake.indexOf('membership.can_operate')).toBeGreaterThan(-1);
    expect(intake.indexOf('membership.can_operate')).toBeLessThan(intake.indexOf('FROM stock_intakes'));
    expect(mutation.indexOf('membership.can_operate')).toBeGreaterThan(-1);
    expect(mutation.indexOf('membership.can_operate')).toBeLessThan(mutation.indexOf('FROM inventory_stock_commands'));
  });

  it('filters every product-save response to holdings visible to the current actor', () => {
    const save = functionBody('save_product_with_holdings', 'receive_inventory_holding_stock');
    expect(save.match(/membership\.inventory_owner_id = h\.inventory_owner_id/g)).toHaveLength(2);
    expect(save.match(/auth\.uid\(\) = v_uid/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('returns an explicit shared product projection without owner mirror economics', () => {
    const projection = functionBody('inventory_shared_product_projection', 'save_product_with_holdings');
    const save = functionBody('save_product_with_holdings', 'receive_inventory_holding_stock');

    expect(projection).toContain("'sale_price', p_product.sale_price");
    expect(projection).toContain("'stock', p_product.stock");
    expect(projection).not.toContain("'purchase_price'");
    expect(projection).not.toContain("'min_stock'");
    expect(projection).not.toContain("'inventory_owner_id'");
    expect(save.match(/inventory_shared_product_projection\(v_product\)/g)).toHaveLength(2);
    expect(migration).toContain('Legacy direct products SELECT remains compatibility-only');
  });

  it('serializes every holding mirror recalculation by tenant and product before aggregation', () => {
    const sync = functionBody('sync_inventory_holdings_to_product', 'inventory_shared_product_projection');
    const lock = "pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_product_id::text, 0))";
    expect(sync).toContain(lock);
    expect(sync.indexOf(lock)).toBeLessThan(sync.indexOf('SELECT COALESCE(sum(stock), 0)::integer'));
    expect(sync).toContain('UPDATE products');
    expect(sync).toContain('SET stock = v_stock');
  });

  it('uses the complete holding UUID in stock command idempotency keys', () => {
    expect(migration).toContain("p_idempotency_key || ':' || v_owner_id::text");
    expect(migration).not.toContain('left(v_owner_id::text, 8)');
  });

  it('keeps public price on the product and combined stock in the legacy mirror', () => {
    expect(migration).toContain("p_product->>'salePrice'");
    expect(migration).not.toMatch(/sale_price\s+[^,\n]+inventory_holdings/i);
    expect(migration).toContain('sum(stock)');
  });
});
