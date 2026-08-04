import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import type { InventoryHolding } from '../types';
import {
  allocateAttributedSaleLine,
  buildAttributedSaleCommandItems,
  filterSalesByAuthorizedOwner,
  getSaleRefundEligibility,
  hasFullOperableAttributedSaleScope,
  projectAttributedSales,
  previewAttributedCart,
  resolveAttributedSaleCustomerId,
  shouldRenderSalesMutationActions,
} from './attributedSales';
import type { CustomerTransaction, Sale, SaleItemAllocation, SaleItemSnapshot } from '../types';

function holding(overrides: Partial<InventoryHolding> = {}): InventoryHolding {
  return {
    id: 'holding-main',
    ownerUid: 'account',
    productId: 'product',
    inventoryOwnerId: 'main',
    stock: 3,
    purchaseCost: 10,
    minStock: 1,
    active: true,
    ownerSortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('attributed sale allocation', () => {
  it('splits stock by actor default and deterministic owner priority with immutable snapshots', () => {
    const result = allocateAttributedSaleLine({
      productId: 'product',
      productName: 'Mate imperial',
      quantity: 5,
      unitPrice: 20,
      lineDiscount: 2,
      adjustmentShare: 1,
      actorUid: 'seller',
      defaultOwnerId: 'mama',
      holdings: [
        holding({ id: 'mine', inventoryOwnerId: 'mine', stock: 4, purchaseCost: 9 }),
        holding({ id: 'mama', inventoryOwnerId: 'mama', stock: 2, purchaseCost: 11, ownerSortOrder: 1 }),
      ],
      ownerNames: { mine: 'Mi negocio', mama: 'Negocio de mama' },
    });

    expect(result).toEqual([
      expect.objectContaining({
        holdingId: 'mama',
        inventoryOwnerId: 'mama',
        inventoryOwnerName: 'Negocio de mama',
        productName: 'Mate imperial',
        actorUid: 'seller',
        quantity: 2,
        unitCost: 11,
        discountShare: 4,
        revenueShare: 36.4,
        costShare: 22,
        allocationSource: 'default',
      }),
      expect.objectContaining({
        holdingId: 'mine',
        inventoryOwnerId: 'mine',
        quantity: 3,
        discountShare: 6,
        revenueShare: 54.6,
        costShare: 27,
        allocationSource: 'priority',
      }),
    ]);
    expect(result.reduce((sum, allocation) => sum + allocation.revenueShare, 0)).toBe(91);
  });

  it('honors a manual owner override without spilling into another holding', () => {
    const result = allocateAttributedSaleLine({
      productId: 'product',
      productName: 'Termo',
      quantity: 2,
      unitPrice: 12.5,
      lineDiscount: 0,
      adjustmentShare: 0,
      actorUid: 'seller',
      preferredOwnerId: 'mama',
      holdings: [
        holding({ id: 'mine', inventoryOwnerId: 'mine', stock: 8 }),
        holding({ id: 'mama', inventoryOwnerId: 'mama', stock: 2, ownerSortOrder: 1 }),
      ],
      ownerNames: { mine: 'Mi negocio', mama: 'Negocio de mama' },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      inventoryOwnerId: 'mama',
      quantity: 2,
      allocationSource: 'manual_override',
    });
  });

  it('assigns the final cent remainder deterministically and rejects insufficient overrides', () => {
    const input = {
      productId: 'product',
      productName: 'Bombilla',
      quantity: 3,
      unitPrice: 10,
      lineDiscount: 0,
      adjustmentShare: 0.01,
      actorUid: 'seller',
      holdings: [
        holding({ id: 'a', inventoryOwnerId: 'a', stock: 1, ownerSortOrder: 0 }),
        holding({ id: 'b', inventoryOwnerId: 'b', stock: 1, ownerSortOrder: 1 }),
        holding({ id: 'c', inventoryOwnerId: 'c', stock: 1, ownerSortOrder: 2 }),
      ],
      ownerNames: { a: 'A', b: 'B', c: 'C' },
    };

    const result = allocateAttributedSaleLine(input);
    expect(result.map((allocation) => allocation.adjustmentShare)).toEqual([0, 0, 0.01]);
    expect(result.map((allocation) => allocation.revenueShare)).toEqual([10, 10, 10.01]);

    expect(() => allocateAttributedSaleLine({ ...input, quantity: 2, preferredOwnerId: 'a' }))
      .toThrow('Stock insuficiente');
  });

  it('reconciles rounded base revenue and cost by assigning the exact remainder to the last owner', () => {
    const result = allocateAttributedSaleLine({
      productId: 'product',
      productName: 'Small unit',
      quantity: 3,
      unitPrice: 0.335,
      lineDiscount: 0,
      adjustmentShare: 0,
      actorUid: 'seller',
      holdings: [
        holding({ id: 'a', inventoryOwnerId: 'a', stock: 1, purchaseCost: 0.335, ownerSortOrder: 0 }),
        holding({ id: 'b', inventoryOwnerId: 'b', stock: 1, purchaseCost: 0.335, ownerSortOrder: 1 }),
        holding({ id: 'c', inventoryOwnerId: 'c', stock: 1, purchaseCost: 0.335, ownerSortOrder: 2 }),
      ],
      ownerNames: { a: 'A', b: 'B', c: 'C' },
    });

    expect(result.map((allocation) => allocation.revenueShare)).toEqual([0.34, 0.34, 0.33]);
    expect(result.map((allocation) => allocation.costShare)).toEqual([0.34, 0.34, 0.33]);
    expect(result.reduce((sum, allocation) => sum + allocation.revenueShare, 0)).toBe(1.01);
    expect(result.reduce((sum, allocation) => sum + allocation.costShare, 0)).toBe(1.01);
  });
});

describe('owner-attributed POS and sales helpers', () => {
  it('previews a mixed ticket using the actor default first and owner priority for the split', () => {
    const preview = previewAttributedCart({
      actorUid: 'seller',
      allowedOwnerIds: ['mine', 'mama'],
      operableOwnerIds: ['mine', 'mama'],
      defaultOwnerId: 'mine',
      ownerNames: { mine: 'Mi negocio', mama: 'Negocio de mama' },
      holdings: [
        holding({ id: 'mine-a', productId: 'a', inventoryOwnerId: 'mine', stock: 1 }),
        holding({ id: 'mama-a', productId: 'a', inventoryOwnerId: 'mama', stock: 2, ownerSortOrder: 1 }),
        holding({ id: 'mama-b', productId: 'b', inventoryOwnerId: 'mama', stock: 3, ownerSortOrder: 1 }),
      ],
      items: [
        { productId: 'a', productName: 'Mate', quantity: 2, unitPrice: 20, lineDiscount: 0 },
        { productId: 'b', productName: 'Termo', quantity: 1, unitPrice: 30, lineDiscount: 0 },
      ],
      globalAdjustment: 0,
    });

    expect(preview.lines[0].allocations).toEqual([
      { inventoryOwnerId: 'mine', inventoryOwnerName: 'Mi negocio', quantity: 1, allocationSource: 'default' },
      { inventoryOwnerId: 'mama', inventoryOwnerName: 'Negocio de mama', quantity: 1, allocationSource: 'priority' },
    ]);
    expect(preview.ownerSummaries).toEqual([
      { inventoryOwnerId: 'mine', inventoryOwnerName: 'Mi negocio', quantity: 1 },
      { inventoryOwnerId: 'mama', inventoryOwnerName: 'Negocio de mama', quantity: 2 },
    ]);
    expect(preview.mixedOwners).toBe(true);
    expect(preview.lines[0].allocations[0]).not.toHaveProperty('unitCost');
    expect(preview.lines[0].allocations[0]).not.toHaveProperty('costShare');
  });

  it('projects an owner-filtered mixed ticket exclusively from authorized allocation slices', () => {
    const sale = {
      id: 'mixed',
      date: '2026-08-02',
      productName: 'FULL TICKET MUST NOT LEAK',
      quantity: 99,
      unitPrice: 999,
      adjustment: 0,
      total: 100,
      status: 'Pagado',
      paymentMethod: 'Efectivo',
      ownerUid: 'account',
      source: 'pos',
      items: [
        { productId: 'mate', productName: 'Mate', quantity: 2, price: 40 },
        { productId: 'termo', productName: 'Termo', quantity: 1, price: 20 },
      ],
    } as Sale;
    const allocations = [
      {
        id: 'mine-mate', saleIdSnapshot: 'mixed', saleItemId: 'line-mate',
        inventoryOwnerIdSnapshot: 'mine', inventoryOwnerNameSnapshot: 'Mi negocio',
        productIdSnapshot: 'mate', productNameSnapshot: 'Mate', quantity: 1,
        unitPrice: 40, revenueShare: 40, costShare: 20, discountShare: 0, adjustmentShare: 0,
      },
      {
        id: 'mama-mate', saleIdSnapshot: 'mixed', saleItemId: 'line-mate',
        inventoryOwnerIdSnapshot: 'mama', inventoryOwnerNameSnapshot: 'Negocio de mama',
        productIdSnapshot: 'mate', productNameSnapshot: 'Mate', quantity: 1,
        unitPrice: 40, revenueShare: 40, costShare: 25, discountShare: 0, adjustmentShare: 0,
      },
      {
        id: 'mama-termo', saleIdSnapshot: 'mixed', saleItemId: 'line-termo',
        inventoryOwnerIdSnapshot: 'mama', inventoryOwnerNameSnapshot: 'Negocio de mama',
        productIdSnapshot: 'termo', productNameSnapshot: 'Termo', quantity: 1,
        unitPrice: 20, revenueShare: 20, costShare: 12, discountShare: 0, adjustmentShare: 0,
      },
    ] as SaleItemAllocation[];
    const snapshots = [
      { id: 'line-mate', saleIdSnapshot: 'mixed', revision: 1, lineNumber: 1 },
      { id: 'line-termo', saleIdSnapshot: 'mixed', revision: 1, lineNumber: 2 },
    ] as SaleItemSnapshot[];

    const [mine] = projectAttributedSales([sale], allocations, snapshots, ['mine', 'mama'], 'mine', true);
    expect(mine).toMatchObject({
      id: 'mixed', productName: 'Mate', quantity: 1, total: 40, costTotal: 20,
      isPartial: true, viewLabel: 'Vista parcial', ownerNames: ['Mi negocio'],
    });
    expect(mine.items).toEqual([{
      saleItemId: 'line-mate', productId: 'mate', productName: 'Mate', quantity: 1,
      unitPrice: 40, revenue: 40, cost: 20, discount: 0, adjustment: 0,
    }]);
    expect(mine.productName).not.toContain('FULL TICKET');

    const [full] = projectAttributedSales([sale], allocations, snapshots, ['mine', 'mama'], 'all', true);
    expect(full).toMatchObject({
      quantity: 3, total: 100, costTotal: 57, isPartial: false,
      viewLabel: 'Ticket completo', ownerNames: ['Mi negocio', 'Negocio de mama'],
    });
    expect(full.items).toHaveLength(2);
  });

  it('marks an incomplete RLS slice partial and fails closed for empty authorization', () => {
    const sale = {
      id: 'mixed', date: '2026-08-02', total: 100, status: 'Pagado', ownerUid: 'account',
      items: [{ productId: 'mate', productName: 'Mate', quantity: 2, price: 50 }],
    } as Sale;
    const visible = [{
      id: 'mine', saleIdSnapshot: 'mixed', saleItemId: 'line',
      inventoryOwnerIdSnapshot: 'mine', inventoryOwnerNameSnapshot: 'Mi negocio',
      productIdSnapshot: 'mate', productNameSnapshot: 'Mate', quantity: 1,
      unitPrice: 50, revenueShare: 50, costShare: 30, discountShare: 0, adjustmentShare: 0,
    }] as SaleItemAllocation[];

    expect(projectAttributedSales([sale], visible, [], ['mine'], 'all', true)[0]).toMatchObject({
      quantity: 1, total: 50, costTotal: 30, isPartial: true,
    });
    expect(projectAttributedSales([sale], visible, [], [], 'all', true)).toEqual([]);
  });

  it('preserves the current account customer unless an explicit replacement is selected', () => {
    const transactions = [{
      id: 'tx', ownerUid: 'account', customerId: 'current', type: 'sale',
      amount: 10, description: 'Venta', relatedSaleId: 'sale', date: '2026-08-02', createdAt: '2026-08-02',
    }] as CustomerTransaction[];

    expect(resolveAttributedSaleCustomerId('sale', null, transactions)).toBe('current');
    expect(resolveAttributedSaleCustomerId('sale', 'replacement', transactions)).toBe('replacement');
    expect(resolveAttributedSaleCustomerId('other', null, transactions)).toBeNull();
  });

  it('honors a preferred owner and rejects unauthorized or empty owner authorization', () => {
    const base = {
      actorUid: 'seller',
      allowedOwnerIds: ['mine', 'mama'],
      operableOwnerIds: ['mine', 'mama'],
      defaultOwnerId: 'mine',
      ownerNames: { mine: 'Mi negocio', mama: 'Negocio de mama' },
      holdings: [
        holding({ id: 'mine-a', inventoryOwnerId: 'mine', stock: 4 }),
        holding({ id: 'mama-a', inventoryOwnerId: 'mama', stock: 4, ownerSortOrder: 1 }),
      ],
      items: [{
        productId: 'product', productName: 'Mate', quantity: 2, unitPrice: 20,
        lineDiscount: 0, preferredOwnerId: 'mama',
      }],
      globalAdjustment: 0,
    };

    expect(previewAttributedCart(base).lines[0].allocations).toEqual([
      { inventoryOwnerId: 'mama', inventoryOwnerName: 'Negocio de mama', quantity: 2, allocationSource: 'manual_override' },
    ]);
    expect(() => previewAttributedCart({
      ...base,
      operableOwnerIds: ['mine'],
    })).toThrow('Sin permiso para vender stock del titular seleccionado');
    expect(() => previewAttributedCart({
      ...base,
      allowedOwnerIds: [],
      operableOwnerIds: [],
    })).toThrow('No hay titulares autorizados para registrar la venta');
  });

  it('builds server command items without duplicating public prices or leaking holdings economics', () => {
    expect(buildAttributedSaleCommandItems([{
      productId: 'product',
      productName: 'Mate',
      quantity: 2,
      unitPrice: 19.99,
      lineDiscount: 1,
      preferredOwnerId: 'mama',
    }])).toEqual([{
      productId: 'product',
      quantity: 2,
      unitPrice: 19.99,
      lineDiscount: 1,
      preferredOwnerId: 'mama',
    }]);
  });

  it('filters sales by visible owner allocations and fails closed for empty authorization', () => {
    const sales = [
      { id: 'sale-mine', total: 10 },
      { id: 'sale-mama', total: 20 },
      { id: 'legacy', total: 30 },
    ] as Sale[];
    const allocations = [
      { id: 'a', saleIdSnapshot: 'sale-mine', inventoryOwnerIdSnapshot: 'mine' },
      { id: 'b', saleIdSnapshot: 'sale-mama', inventoryOwnerIdSnapshot: 'mama' },
    ] as SaleItemAllocation[];

    expect(filterSalesByAuthorizedOwner(sales, allocations, ['mine'], 'mine', true).map((sale) => sale.id))
      .toEqual(['sale-mine']);
    expect(filterSalesByAuthorizedOwner(sales, allocations, [], 'all', true)).toEqual([]);
    expect(filterSalesByAuthorizedOwner(sales, allocations, [], 'all', false)).toEqual(sales);
  });

  it('allows attributed refunds only when every active allocation is visible and blocks quote refunds', () => {
    const allocations = [
      { id: 'a', saleIdSnapshot: 'mixed', inventoryOwnerIdSnapshot: 'mine' },
      { id: 'b', saleIdSnapshot: 'mixed', inventoryOwnerIdSnapshot: 'mama' },
    ] as SaleItemAllocation[];
    const sale = { id: 'mixed', source: 'pos' } as Sale;

    expect(getSaleRefundEligibility(sale, allocations, ['mine'], true)).toEqual({
      allowed: false,
      reason: 'La devolucion requiere acceso a todos los titulares atribuidos a la venta.',
    });
    expect(getSaleRefundEligibility(sale, allocations, ['mine', 'mama'], true)).toEqual({ allowed: true });
    expect(getSaleRefundEligibility({ ...sale, source: 'quote' }, allocations, ['mine', 'mama'], true))
      .toEqual({ allowed: false, reason: 'Las ventas creadas desde presupuestos se gestionan desde el presupuesto original.' });
    expect(getSaleRefundEligibility(
      { ...sale, items: [{ productId: 'product', productName: 'Mate', quantity: 1, price: 10 }] },
      [allocations[0]],
      ['mine'],
      true,
      [],
    )).toEqual({
      allowed: false,
      reason: 'La devolucion requiere acceso a todos los titulares atribuidos a la venta.',
    });
  });

  it('keeps a fully readable mixed ticket visible but denies mutation when one owner is read-only', () => {
    const sale = {
      id: 'read-only-mixed', date: '2026-08-03', total: 100, status: 'Pagado', ownerUid: 'account',
      items: [{ productId: 'mate', productName: 'Mate', quantity: 2, price: 50 }],
    } as Sale;
    const allocations = [
      {
        id: 'mine', saleIdSnapshot: sale.id, saleItemId: 'line',
        inventoryOwnerIdSnapshot: 'mine', inventoryOwnerNameSnapshot: 'Mi negocio',
        productIdSnapshot: 'mate', productNameSnapshot: 'Mate', quantity: 1,
        unitPrice: 50, revenueShare: 50, costShare: 20, discountShare: 0, adjustmentShare: 0,
      },
      {
        id: 'mama', saleIdSnapshot: sale.id, saleItemId: 'line',
        inventoryOwnerIdSnapshot: 'mama', inventoryOwnerNameSnapshot: 'Negocio de mama',
        productIdSnapshot: 'mate', productNameSnapshot: 'Mate', quantity: 1,
        unitPrice: 50, revenueShare: 50, costShare: 20, discountShare: 0, adjustmentShare: 0,
      },
    ] as SaleItemAllocation[];
    const snapshots = [{
      id: 'line', saleIdSnapshot: sale.id, revision: 1, lineNumber: 1,
    }] as SaleItemSnapshot[];

    expect(projectAttributedSales(
      [sale], allocations, snapshots, ['mine', 'mama'], 'all', true,
    )[0]).toMatchObject({ isPartial: false, viewLabel: 'Ticket completo', total: 100 });
    expect(getSaleRefundEligibility(sale, allocations, ['mine'], true, snapshots)).toEqual({
      allowed: false,
      reason: 'La devolucion requiere acceso a todos los titulares atribuidos a la venta.',
    });
    expect(getSaleRefundEligibility(sale, allocations, ['mine', 'mama'], true, snapshots))
      .toEqual({ allowed: true });
    expect(hasFullOperableAttributedSaleScope(
      sale, allocations, ['mine'], true, snapshots,
    )).toBe(false);
    expect(hasFullOperableAttributedSaleScope(
      sale, allocations, ['mine', 'mama'], true, snapshots,
    )).toBe(true);
  });

  it('omits read-only mutation actions in holdings mode and preserves legacy actions', () => {
    expect(shouldRenderSalesMutationActions(true, false)).toBe(false);
    expect(shouldRenderSalesMutationActions(true, true)).toBe(true);
    expect(shouldRenderSalesMutationActions(false, false)).toBe(true);
  });
});
