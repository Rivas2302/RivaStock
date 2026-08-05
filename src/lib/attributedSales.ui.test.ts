import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pos = readFileSync(resolve(process.cwd(), 'src/pages/POS.tsx'), 'utf8');
const sales = readFileSync(resolve(process.cwd(), 'src/pages/Sales.tsx'), 'utf8');
const cart = readFileSync(resolve(process.cwd(), 'src/stores/pos-cart.ts'), 'utf8');
const helpers = readFileSync(resolve(process.cwd(), 'src/lib/attributedSales.ts'), 'utf8');

describe('owner-attributed sales UI contract', () => {
  it('persists a preferred owner per cart line and exposes a manual override', () => {
    expect(cart).toContain('preferredOwnerId');
    expect(cart).toContain('setItemPreferredOwner');
    expect(pos).toContain('cart.setItemPreferredOwner');
  });

  it('shows an allocation preview without rendering holding cost fields', () => {
    expect(pos).toContain('previewAttributedCart');
    expect(pos).toContain('Distribucion de stock');
    expect(pos).not.toContain('allocation.unitCost');
    expect(pos).not.toContain('allocation.costShare');
  });

  it('uses stable attributed command intentions and preserves the legacy rollout fallback', () => {
    expect(pos).toContain('resolveIdempotencyIntent');
    expect(pos).toContain("callRpc('register_attributed_sale'");
    expect(pos).toContain("callRpc('register_pos_sale'");
    expect(pos).toContain('holdingsEnabled');
    expect(pos.indexOf("await callRpc('register_attributed_sale'")).toBeLessThan(
      pos.indexOf('saleIntentRef.current = null'),
    );
  });

  it('loads authorized allocation snapshots, filters by owner, and uses attributed edit/refund commands', () => {
    expect(sales).toContain("db.list<SaleItemAllocation>('sale_item_allocations'");
    expect(sales).toContain('projectAttributedSales');
    expect(sales).toContain("callRpc('edit_attributed_sale'");
    expect(sales).toContain("callRpc('refund_attributed_sale'");
  });

  it('uses safe projections and a guarded idempotent status command during owner-aware rollout', () => {
    expect(sales).toContain('projectAttributedSales');
    expect(helpers).toContain("viewLabel: isComplete ? 'Ticket completo' : 'Vista parcial'");
    expect(sales).toContain("callRpc('toggle_attributed_sale_status'");
    expect(sales).toContain('statusIntentRef');
    expect(sales).toContain('resolveAttributedSaleCustomerId');
    expect(sales).toContain("callRpc('toggle_sale_status'");
    expect(sales.indexOf("callRpc('toggle_attributed_sale_status'")).toBeLessThan(
      sales.indexOf("callRpc('toggle_sale_status'"),
    );
  });

  it('forwards the free client name through attributed edit only (register RPC does not accept it)', () => {
    expect(sales).toMatch(/p_client:\s*formData\.client[\s\S]*?edit_attributed_sale/);
    const registerBlock = sales.slice(
      sales.indexOf("callRpc('register_attributed_sale'"),
      sales.indexOf("callRpc('register_attributed_sale'", sales.indexOf("callRpc('register_attributed_sale'") + 1),
    );
    expect(registerBlock).not.toContain('p_client: clientName');
  });

  it('uses readable owners only for projection and operable owners for every mutation guard', () => {
    expect(sales).toMatch(/projectAttributedSales\([\s\S]*?allowedInventoryOwnerIds/);
    const mutationGuards = [...sales.matchAll(/getSaleRefundEligibility\([\s\S]*?\n\s*\);/g)]
      .map((match) => match[0]);
    expect(mutationGuards.length).toBeGreaterThanOrEqual(1);
    expect(mutationGuards.every((guard) => guard.includes('operableInventoryOwnerIds'))).toBe(true);
    expect(mutationGuards.every((guard) => !guard.includes('allowedInventoryOwnerIds'))).toBe(true);
    expect(sales).toContain('saleMutationDenialReason');
  });

  it('omits owner-aware creation and ticket mutation controls without operable scope', () => {
    expect(sales).toContain('shouldRenderSalesMutationActions');
    expect(sales).toContain('hasFullOperableAttributedSaleScope');
    expect(sales).toContain('renderCreationActions');
    expect(sales).toContain('ticketHasFullOperableScope');
    expect(sales).toContain('Estado de solo lectura');
  });
});
