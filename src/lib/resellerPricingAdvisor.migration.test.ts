import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0043_reseller_pricing_advisor.sql'),
  'utf8',
);

describe('reseller pricing advisor migration', () => {
  it('persists conservative default targets', () => {
    expect(migration).toContain('minimum_profit_margin_percent numeric NOT NULL DEFAULT 25');
    expect(migration).toContain('target_reseller_discount_percent numeric NOT NULL DEFAULT 15');
  });

  it('restricts target changes to stock writers', () => {
    expect(migration).toContain("has_permission(auth.uid(), 'stock', 'write')");
    expect(migration).toContain('REVOKE ALL ON FUNCTION configure_reseller_pricing_advisor');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION configure_reseller_pricing_advisor(uuid, numeric, numeric) TO authenticated');
    expect(migration).not.toContain('TO anon');
  });
});
