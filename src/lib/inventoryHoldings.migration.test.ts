import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0032_inventory_holdings.sql'),
  'utf8',
);

function sqlBlock(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe('inventory holdings migration contract', () => {
  it('creates tenant-safe holdings and memberships with one holding per owner and product', () => {
    expect(migration).toContain('CREATE TABLE inventory_holdings');
    expect(migration).toContain('UNIQUE (user_id, product_id, inventory_owner_id)');
    expect(migration).toContain('FOREIGN KEY (user_id, product_id)');
    expect(migration).toContain('FOREIGN KEY (user_id, inventory_owner_id)');
    expect(migration).toContain('CREATE TABLE inventory_owner_memberships');
    expect(migration).toContain('UNIQUE (user_id, actor_uid, inventory_owner_id)');
    expect(migration).toContain('ALTER TABLE inventory_holdings ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE inventory_owner_memberships ENABLE ROW LEVEL SECURITY');
  });

  it('backfills each 0031 product exactly once and leaves duplicate products separate', () => {
    const backfill = sqlBlock(
      'INSERT INTO inventory_holdings',
      '-- Membership backfill',
    );

    expect(backfill).toContain('p.inventory_owner_id');
    expect(backfill).toContain('p.stock');
    expect(backfill).toContain('p.purchase_price');
    expect(backfill).toContain('p.min_stock');
    expect(backfill).toContain('ON CONFLICT (user_id, product_id, inventory_owner_id) DO NOTHING');
    expect(backfill).not.toMatch(/GROUP BY\s+p\.name/i);
  });

  it('ships disabled feature flags and reversible legacy product mirrors', () => {
    expect(migration).toContain('CREATE TABLE inventory_operation_settings');
    expect(migration).toMatch(/holdings_enabled\s+boolean NOT NULL DEFAULT false/i);
    expect(migration).toContain('CREATE TRIGGER products_sync_inventory_holding');
    expect(migration).toContain('CREATE TRIGGER inventory_holdings_sync_product');
    expect(migration).toContain("current_setting('app.inventory_holding_sync', true)");
    expect(migration).not.toMatch(/DROP COLUMN\s+(stock|purchase_price|min_stock|inventory_owner_id)/i);
  });

  it('makes stock commands atomic, auditable, idempotent and priority ordered', () => {
    expect(migration).toContain('CREATE TABLE inventory_stock_commands');
    expect(migration).toContain('UNIQUE (user_id, idempotency_key)');
    const mutate = sqlBlock(
      'CREATE OR REPLACE FUNCTION mutate_inventory_holding_stock',
      'CREATE OR REPLACE FUNCTION transfer_inventory_holding_stock',
    );
    expect(mutate).toContain('FOR UPDATE');
    expect(mutate).toContain('Stock insuficiente');
    expect(mutate).toContain('ON CONFLICT (user_id, idempotency_key) DO NOTHING');
    expect(mutate).toContain('has_permission(auth.uid(), \'stock\', \'write\')');
    expect(migration).toContain('ORDER BY membership.is_default DESC, io.sort_order, h.id');
  });

  it('does not expose direct holding mutations to clients', () => {
    expect(migration).not.toMatch(
      /CREATE POLICY[^;]+ON inventory_holdings\s+FOR (INSERT|UPDATE|DELETE)/i,
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION mutate_inventory_holding_stock(uuid, uuid, integer, text, text) TO authenticated',
    );
    expect(migration).not.toContain(
      'GRANT EXECUTE ON FUNCTION mutate_inventory_holding_stock(uuid, uuid, integer, text, text) TO anon',
    );
  });

});
