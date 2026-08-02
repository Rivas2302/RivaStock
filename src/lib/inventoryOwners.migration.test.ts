import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0031_inventory_owners.sql'),
  'utf8',
);

function sqlBlock(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe('inventory owners migration contract', () => {
  it('lets authenticated active tenant members read labels without granting table mutations', () => {
    const selectPolicy = sqlBlock(
      'CREATE POLICY "inventory_owners_select"',
      '-- Management is RPC-only.',
    );

    expect(selectPolicy).toContain('auth.uid() IS NOT NULL');
    expect(selectPolicy).toContain('user_id = get_owner_uid(auth.uid())');
    expect(selectPolicy).not.toContain('has_permission');
    expect(migration).not.toMatch(
      /CREATE POLICY[^;]+ON inventory_owners\s+FOR (INSERT|UPDATE|DELETE)/i,
    );
  });

  it('keeps management RPCs behind config read and write permissions', () => {
    const managementGuard = sqlBlock(
      'CREATE OR REPLACE FUNCTION can_manage_inventory_owners',
      'REVOKE ALL ON FUNCTION can_manage_inventory_owners',
    );

    expect(managementGuard).toContain("has_permission(v_uid, 'config', 'read')");
    expect(managementGuard).toContain("has_permission(v_uid, 'config', 'write')");
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION create_inventory_owner(text) TO authenticated',
    );
    expect(migration).not.toContain(
      'GRANT EXECUTE ON FUNCTION create_inventory_owner(text) TO anon',
    );
  });

  it('stores only the owner reference on products and protects assignment invariants', () => {
    expect(migration).toContain('ADD COLUMN inventory_owner_id uuid');
    expect(migration).toContain('FOREIGN KEY (user_id, inventory_owner_id)');
    expect(migration).toContain('No se pueden asignar titulares archivados');
    expect(migration).not.toMatch(/ADD COLUMN inventory_owner_name/i);
  });

  it('exposes public labels only for enabled catalogs and visible products', () => {
    const publicLabelsRpc = sqlBlock(
      'CREATE OR REPLACE FUNCTION get_public_inventory_owner_labels',
      'REVOKE ALL ON FUNCTION get_public_inventory_owner_labels',
    );

    expect(publicLabelsRpc).toContain('config.enabled = true');
    expect(publicLabelsRpc).toContain('p.show_in_catalog = true');
    expect(publicLabelsRpc).toContain('(p_product_id IS NULL OR p.id = p_product_id)');
    expect(publicLabelsRpc).toContain('JOIN inventory_owners io');
  });
});
