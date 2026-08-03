import type { InventoryHolding } from '../types';
import { allocateHoldingStock } from './inventoryHoldings';

export type SaleAllocationSource = 'manual_override' | 'default' | 'priority';

export interface AttributedSaleAllocation {
  holdingId: string;
  inventoryOwnerId: string;
  inventoryOwnerName: string;
  productId: string;
  productName: string;
  actorUid: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  discountShare: number;
  adjustmentShare: number;
  revenueShare: number;
  costShare: number;
  allocationSource: SaleAllocationSource;
}

export interface AttributedSaleLineInput {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  adjustmentShare: number;
  actorUid: string;
  holdings: InventoryHolding[];
  ownerNames: Record<string, string>;
  defaultOwnerId?: string;
  preferredOwnerId?: string;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function allocateAttributedSaleLine(
  input: AttributedSaleLineInput,
): AttributedSaleAllocation[] {
  const stockAllocations = allocateHoldingStock(input.holdings, input.quantity, {
    defaultOwnerId: input.defaultOwnerId,
    preferredOwnerId: input.preferredOwnerId,
  });
  let remainingAdjustment = roundMoney(input.adjustmentShare);
  let remainingDiscount = roundMoney(input.lineDiscount * input.quantity);
  let remainingRevenue = roundMoney(
    input.quantity * (input.unitPrice - input.lineDiscount) + input.adjustmentShare,
  );
  let remainingCost = roundMoney(stockAllocations.reduce((total, allocation) => {
    const holding = input.holdings.find((candidate) => candidate.id === allocation.holdingId);
    if (!holding) throw new Error('La existencia asignada ya no esta disponible');
    return total + allocation.quantity * holding.purchaseCost;
  }, 0));

  return stockAllocations.map((allocation, index) => {
    const holding = input.holdings.find((candidate) => candidate.id === allocation.holdingId);
    if (!holding) throw new Error('La existencia asignada ya no esta disponible');

    const isLast = index === stockAllocations.length - 1;
    const adjustmentShare = isLast
      ? remainingAdjustment
      : roundMoney(input.adjustmentShare * allocation.quantity / input.quantity);
    remainingAdjustment = roundMoney(remainingAdjustment - adjustmentShare);

    const discountShare = isLast
      ? remainingDiscount
      : roundMoney(input.lineDiscount * allocation.quantity);
    const revenueShare = isLast
      ? remainingRevenue
      : roundMoney(allocation.quantity * (input.unitPrice - input.lineDiscount) + adjustmentShare);
    const costShare = isLast
      ? remainingCost
      : roundMoney(allocation.quantity * holding.purchaseCost);
    remainingDiscount = roundMoney(remainingDiscount - discountShare);
    remainingRevenue = roundMoney(remainingRevenue - revenueShare);
    remainingCost = roundMoney(remainingCost - costShare);

    const allocationSource: SaleAllocationSource = input.preferredOwnerId
      ? 'manual_override'
      : allocation.inventoryOwnerId === input.defaultOwnerId
        ? 'default'
        : 'priority';

    return {
      holdingId: allocation.holdingId,
      inventoryOwnerId: allocation.inventoryOwnerId,
      inventoryOwnerName: input.ownerNames[allocation.inventoryOwnerId] ?? 'Titular',
      productId: input.productId,
      productName: input.productName,
      actorUid: input.actorUid,
      quantity: allocation.quantity,
      unitPrice: input.unitPrice,
      unitCost: holding.purchaseCost,
      discountShare,
      adjustmentShare,
      revenueShare,
      costShare,
      allocationSource,
    };
  });
}
