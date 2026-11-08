import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261108202943_i41_shipping_amounts.sql'),
  'utf8',
);

function functionBody(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) return '';
  const end = migration.indexOf('\n$$;', start);
  return migration.slice(start, end + 4);
}

describe('I41 shipping migration contract', () => {
  it('adds a separate non-negative shipping amount without rewriting existing sale totals', () => {
    expect(migration).toMatch(/ALTER TABLE public\.sales[\s\S]*ADD COLUMN IF NOT EXISTS shipping_amount numeric NOT NULL DEFAULT 0[\s\S]*CHECK \(shipping_amount >= 0\)/);
    expect(migration).toMatch(/ALTER TABLE public\.quotes[\s\S]*ADD COLUMN IF NOT EXISTS shipping_amount numeric NOT NULL DEFAULT 0[\s\S]*CHECK \(shipping_amount >= 0\)/);
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('keeps shipping separate while reconciling paid cash and pending customer balance', () => {
    const apply = functionBody('app_private.apply_sale_shipping');
    expect(apply).toContain("has_permission(v_caller, 'ventas', 'write')");
    expect(apply).toContain('get_owner_uid(v_caller)');
    expect(apply).toContain('SET shipping_amount = p_shipping_amount, total = v_total');
    expect(apply).toContain('UPDATE public.cash_flow SET amount = amount + v_delta');
    expect(apply).toContain('current_balance = current_balance + v_delta');
    expect(apply).toContain("incluye envío $");
  });

  it('excludes shipping from attributed product revenue and prorates product costs by product payments', () => {
    const refresh = functionBody('public.refresh_sale_cash_flow_allocations');
    expect(refresh).toContain('v_product_total := GREATEST(v_sale.total - v_sale.shipping_amount, 0)');
    expect(refresh).toContain('flow.amount * v_product_total / v_sale.total');
    expect(refresh).toContain('v_total_cash / NULLIF(v_product_total, 0)');
    expect(refresh).toContain('v_share.cost * v_product_cash_amount / v_product_total');
  });

  it('scopes authenticated mutations to the owner and hides the idempotency table', () => {
    expect(migration).toContain('REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('REVOKE ALL ON app_private.sale_shipping_commands FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.register_sale_with_shipping');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.edit_sale_with_shipping');
    expect(functionBody('public.register_attributed_sale_with_shipping')).toContain("has_permission(v_caller, 'ventas', 'write')");
    expect(functionBody('public.edit_attributed_sale_with_shipping')).toContain("has_permission(v_caller, 'ventas', 'write')");
  });

  it('reports only collected shipping for the authenticated owner and requested date range', () => {
    const report = functionBody('public.get_collected_shipping_report');
    expect(report).toContain("has_permission(v_caller, 'ventas', 'read')");
    expect(report).toContain('get_owner_uid(v_caller)');
    expect(report).toContain("flow.status = 'Pagado'");
    expect(report).toContain('flow.date BETWEEN p_from AND p_to');
    expect(report).toContain('sale.shipping_amount * LEAST(paid.paid_amount, sale.total) / sale.total');
  });
});
