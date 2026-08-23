import type { InventoryHolding, Product } from '../types';

export interface ResellerProductEconomics {
  purchaseCost: number | null;
  purchaseCostRange: [number, number] | null;
  hasMixedPurchaseCosts: boolean;
  costBasis: 'catalog' | 'current_stock' | 'last_known' | 'legacy' | 'missing';
}

function summarizeCosts(
  costs: number[],
  costBasis: ResellerProductEconomics['costBasis'],
): ResellerProductEconomics {
  if (costs.length === 0 || costs.some((cost) => !Number.isFinite(cost) || cost <= 0)) {
    return {
      purchaseCost: null,
      purchaseCostRange: null,
      hasMixedPurchaseCosts: false,
      costBasis: 'missing',
    };
  }

  const minimumCost = Math.min(...costs);
  const maximumCost = Math.max(...costs);
  return {
    purchaseCost: maximumCost,
    purchaseCostRange: [minimumCost, maximumCost],
    hasMixedPurchaseCosts: minimumCost !== maximumCost,
    costBasis,
  };
}

export function getResellerProductEconomics(
  product: Product,
  holdings: InventoryHolding[],
  holdingsEnabled: boolean,
): ResellerProductEconomics {
  if (product.catalogOnly) {
    return summarizeCosts([Number(product.catalogCost ?? 0)], 'catalog');
  }
  if (!holdingsEnabled) {
    return summarizeCosts([product.purchasePrice], 'legacy');
  }

  const productHoldings = holdings.filter((holding) => (
    holding.active && holding.productId === product.id
  ));
  const currentStockHoldings = productHoldings.filter((holding) => holding.stock > 0);
  if (currentStockHoldings.length > 0) {
    return summarizeCosts(
      currentStockHoldings.map((holding) => holding.purchaseCost),
      'current_stock',
    );
  }

  const lastKnownCosts = productHoldings
    .map((holding) => holding.purchaseCost)
    .filter((cost) => Number.isFinite(cost) && cost > 0);
  return summarizeCosts(lastKnownCosts, lastKnownCosts.length > 0 ? 'last_known' : 'missing');
}
