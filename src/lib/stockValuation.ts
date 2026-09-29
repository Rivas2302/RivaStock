import type { InventoryHolding, InventoryOwner, Product } from '../types';
import { roundPrice } from './utils';

export function selectStockValuationOwner(
  owners: InventoryOwner[],
  selectedOwnerId: string | null,
  defaultOwnerId: string | null,
): InventoryOwner | null {
  return owners.find(owner => owner.id === selectedOwnerId)
    ?? owners.find(owner => owner.id === defaultOwnerId)
    ?? owners.find(owner => owner.isPrimary)
    ?? owners.find(owner => !owner.archivedAt)
    ?? owners[0]
    ?? null;
}

/** Owners passed here must already be restricted to the actor's memberships. */
export function getStockValuation(
  products: Product[],
  holdings: InventoryHolding[],
  owners: InventoryOwner[],
  ownerId: string | null,
  holdingsEnabled: boolean,
) {
  let stockValue = 0;
  let totalInvested = 0;
  const categories = new Map<string, number>();
  const owner = owners.find(item => item.id === ownerId);
  const productById = new Map(products.map(product => [product.id, product]));

  const add = (product: Product, stock: number, purchaseCost: number) => {
    const value = roundPrice(product.salePrice) * stock;
    stockValue += value;
    totalInvested += purchaseCost * stock;
    categories.set(product.category, (categories.get(product.category) ?? 0) + value);
  };

  if (owner && holdingsEnabled) {
    for (const holding of holdings) {
      if (!holding.active || holding.inventoryOwnerId !== owner.id) continue;
      const product = productById.get(holding.productId);
      if (product) add(product, holding.stock, holding.purchaseCost);
    }
  } else if (owner) {
    for (const product of products) {
      // Unassigned legacy stock belongs only to the actual primary owner.
      if (product.inventoryOwnerId === owner.id || (!product.inventoryOwnerId && owner.isPrimary)) {
        add(product, product.stock, product.purchasePrice);
      }
    }
  }

  return {
    stockValue,
    totalInvested,
    potentialProfit: stockValue - totalInvested,
    stockByCategory: [...categories].map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value),
  };
}
