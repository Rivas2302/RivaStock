import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import type { InventoryHolding } from '../types';
import { allocateAttributedSaleLine } from './attributedSales';

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
