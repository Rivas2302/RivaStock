import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RESELLER_BUYING_POLICY } from './resellerBuyingPolicy';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261109001310_reseller_catalog_buying_policy.sql'),
  'utf8',
);

describe('reseller buying policy migration', () => {
  it('adds an optional bounded field without backfilling or changing existing business data', () => {
    expect(migration).toContain('ADD COLUMN buying_policy text');
    expect(migration).toContain('char_length(buying_policy) <= 5000');
    expect(migration).not.toMatch(/\b(UPDATE|INSERT|DELETE|TRUNCATE|DROP)\b/i);
  });

  it('returns the initial terms only to a valid catalog or active round code', () => {
    expect(migration).toContain('public.get_public_reseller_buying_policy');
    expect(migration).toContain('catalog.enabled');
    expect(migration).toContain('price_list.public_enabled');
    expect(migration).toContain('price_list.access_code_hash');
    expect(migration).toContain('round.audience_code_hash');
    expect(migration).toContain("round.status = 'open'");
    expect(migration).toContain('round.closes_at > now()');
    for (const line of DEFAULT_RESELLER_BUYING_POLICY.split('\n')) expect(migration).toContain(line);
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_public_reseller_buying_policy(text, text) FROM PUBLIC');
    expect(migration).toContain('TO anon, authenticated');
  });
});
