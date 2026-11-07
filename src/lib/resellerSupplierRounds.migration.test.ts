import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261106221500_reseller_supplier_order_rounds.sql'),
  'utf8',
);
const codeFix = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261107121255_fix_supplier_round_audience_order_code.sql'),
  'utf8',
);

const roundOrderCodeFix = codeFix.match(
  /CREATE OR REPLACE FUNCTION public\.create_public_reseller_supplier_round_order\([\s\S]*?\n\$\$;/,
)?.[0] ?? '';

describe('reseller supplier order rounds migration', () => {
  it('keeps rounds and order snapshots scoped to the business owner', () => {
    expect(migration).toContain('CREATE TABLE reseller_supplier_order_rounds');
    expect(migration).toContain('CREATE TABLE reseller_supplier_round_orders');
    expect(migration).toContain('ALTER TABLE reseller_supplier_order_rounds ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE reseller_supplier_round_orders ENABLE ROW LEVEL SECURITY');
    expect(migration.match(/SELECT get_owner_uid\(\(SELECT auth\.uid\(\)\)\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("has_permission(auth.uid(), 'stock', 'write')");
    expect(migration).toContain('GRANT SELECT ON reseller_supplier_round_orders TO authenticated');
    expect(migration).not.toContain('GRANT INSERT, UPDATE ON reseller_supplier_round_orders');
  });

  it('validates open round times, supplier membership, and paid-order snapshots server-side', () => {
    expect(migration).toContain('set_reseller_supplier_order_round_status');
    expect(migration).toContain('create_public_reseller_supplier_round_order');
    expect(migration).toContain('v_round.closes_at <= now()');
    expect(migration).toContain('supplier_item.supplier_list_id = v_supplier_list.id');
    expect(migration).toContain("'supplierUnitCost'");
    expect(migration).toContain('v_order_row.total - v_supplier_total');
    expect(migration).toContain("p_status = 'paid'");
    expect(migration).toContain('audience_code_hash');
    expect(migration).toContain('round.audience_code_hash = encode');
    expect(migration).toContain('v_round.audience_code_hash = encode');
  });

  it('stores margin and rounding per supplier product and applies fixed prices atomically', () => {
    expect(migration).toContain('CREATE TABLE reseller_supplier_list_pricing');
    expect(migration).toContain('sync_reseller_supplier_list_item_price');
    expect(migration).toContain('CREATE TRIGGER reseller_supplier_list_item_fixed_price');
    expect(migration).toContain('REVOKE ALL ON FUNCTION sync_reseller_supplier_list_item_price() FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('save_reseller_supplier_list_with_pricing');
    expect(migration).toContain('PERFORM save_reseller_supplier_list_pricing');
    expect(migration).toContain('round(v_price / v_rounding) * v_rounding');
  });

  it('exposes only active rounds through the access-code-protected public RPC and does not store payment aliases', () => {
    expect(migration).toContain('get_public_reseller_supplier_rounds');
    expect(migration).toContain('price_list.access_code_hash');
    expect(migration).toContain("round.status = 'open'");
    expect(migration).toContain('round.closes_at > now()');
    expect(migration).toContain("NULLIF(btrim(catalog.whatsapp_number), '') IS NOT NULL");
    expect(migration.toLocaleLowerCase()).not.toContain('alias');
    expect(migration.toLocaleLowerCase()).not.toContain('cbu');
  });

  it('accepts a round audience code only for the explicitly requested round order', () => {
    expect(roundOrderCodeFix).not.toBe('');
    expect(roundOrderCodeFix).toMatch(/WHERE id = p_round_id AND user_id = v_catalog_owner/);
    expect(roundOrderCodeFix).toContain('v_round.audience_code_hash = v_code_hash');
    expect(roundOrderCodeFix).toContain('v_round_code_matches := v_round.audience_code_hash IS NOT NULL');
    expect(roundOrderCodeFix).toContain('AND supplier_list_id = v_supplier_list.id');
    expect(roundOrderCodeFix).toContain('AND price_list_id = v_list.id');
    expect(roundOrderCodeFix).toContain("INSERT INTO reseller_supplier_round_orders (");
    expect(roundOrderCodeFix).not.toContain('create_public_catalog_order(');
  });

  it('rejects wrong and other-round codes without widening general reseller access', () => {
    expect(roundOrderCodeFix).toContain('IF NOT v_list_code_matches AND NOT v_round_code_matches THEN');
    expect(roundOrderCodeFix).toMatch(/v_round_code_matches := v_round\.audience_code_hash IS NOT NULL\s+AND v_round\.audience_code_hash = v_code_hash/);
    expect(roundOrderCodeFix).toMatch(/WHERE id = p_round_id AND user_id = v_catalog_owner[\s\S]*?IF v_round\.id IS NULL OR v_round\.status <> 'open'/);
    expect(roundOrderCodeFix).not.toContain('OR EXISTS (SELECT 1 FROM reseller_supplier_order_rounds');
    expect(codeFix).toMatch(/^\s*--[\s\S]*CREATE OR REPLACE FUNCTION/);
    expect(codeFix).not.toMatch(/^\s*(?:CREATE TABLE|ALTER TABLE|DROP (?:TABLE|FUNCTION)|DELETE FROM)\b/im);
    expect(codeFix).not.toContain('public.create_public_catalog_order(');
  });
});
