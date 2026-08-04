import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0035_sales_attribution_ui.sql'),
  'utf8',
);

function exactFunction(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) return '';
  const end = migration.indexOf('\n$$;', start);
  return migration.slice(start, end + 4);
}

describe('sales attribution UI hardening migration', () => {
  it('keeps the rollout disabled by default', () => {
    expect(migration).toContain('SET holdings_enabled = false');
  });

  it('adds a single idempotent attributed status command without redefining register/edit', () => {
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION register_attributed_sale');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION edit_attributed_sale');

    const status = exactFunction('toggle_attributed_sale_status');
    expect(status).toContain("has_permission(auth.uid(), 'ventas', 'write')");
    expect(status).toContain('lock_inventory_commands');
    expect(status).toContain('request_fingerprint');
    expect(status).toContain('La clave de idempotencia ya fue usada con otros datos');
    expect(status).toContain('assert_attributed_sale_access');
    expect(status).toContain('holdings_enabled');
    expect(status).toContain("v_sale.source = 'quote'");
    expect(status).toContain('toggle_sale_status_unlocked');
    expect(status).toContain("'edit'");
  });

  it('locks the new status command to authenticated callers only', () => {
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION toggle_attributed_sale_status');
    expect(migration).toContain('REVOKE ALL ON FUNCTION toggle_attributed_sale_status');
  });
});
