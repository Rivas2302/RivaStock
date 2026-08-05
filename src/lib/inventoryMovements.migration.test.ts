import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0037_inventory_movements_history.sql'),
  'utf8',
);

function exactFunction(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) return '';
  const end = migration.indexOf('\n$$;', start);
  return migration.slice(start, end + 4);
}

function viewBody(): string {
  const start = migration.indexOf('CREATE OR REPLACE VIEW inventory_movements_view');
  if (start < 0) return '';
  const end = migration.indexOf(';', start);
  return migration.slice(start, end + 1);
}

describe('inventory movements history migration', () => {
  it('builds a security-invoker view over the existing stock commands', () => {
    const view = viewBody();
    expect(view).toContain('security_invoker = true');
    expect(view).toContain('FROM inventory_stock_commands');
    expect(view).toContain("'Ingreso de mercader");
    expect(view).toContain('producto y existencias');
    expect(view).toContain('(transferencia saliente)');
    expect(view).toContain('(transferencia entrante)');
  });

  it('classifies every movement_type bucket the UI needs to render', () => {
    const view = viewBody();
    const caseBlock = view.slice(
      view.indexOf('CASE'),
      view.indexOf('END AS movement_type'),
    );
    expect(caseBlock).toContain("'intake'");
    expect(caseBlock).toContain("'transfer_out'");
    expect(caseBlock).toContain("'transfer_in'");
    expect(caseBlock).toContain("'product_edit'");
    expect(caseBlock).toContain("'adjustment'");
  });

  it('exposes a paired transfer_key so the UI can group both halves of a move', () => {
    const view = viewBody();
    expect(view).toContain(":out'");
    expect(view).toContain(":in'");
  });

  it('adds a paginated RPC that enforces owner scope and stock.read permission', () => {
    const fn = exactFunction('list_inventory_movements');
    expect(fn).toContain('RETURNS TABLE');
    expect(fn).toContain('movement_type');
    expect(fn).toContain('transfer_key');
    expect(fn).toContain('total_count');
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('get_owner_uid(auth.uid())');
    expect(fn).toContain("has_permission(auth.uid(), 'stock', 'read')");
    expect(fn).toContain('LIMIT p_limit OFFSET p_offset');
    expect(fn).toContain('p_limit > 200');
  });

  it('rejects unauthenticated callers and locks the RPC to authenticated', () => {
    const fn = exactFunction('list_inventory_movements');
    expect(fn).toContain("RAISE EXCEPTION 'Autenticacion requerida'");
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION list_inventory_movements(');
    expect(migration).toContain('REVOKE ALL ON FUNCTION list_inventory_movements(');
  });

  it('indexes the time-range scan so pagination stays cheap on large tenants', () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS inventory_stock_commands_created_at_idx');
    expect(migration).toContain('ON inventory_stock_commands (user_id, created_at DESC)');
  });
});
